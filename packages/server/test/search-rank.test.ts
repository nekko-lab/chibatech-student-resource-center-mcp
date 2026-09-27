import { describe, expect, it } from "vitest";
import { BigramIndex, type SourceDoc } from "../src/search/bigram.ts";
import { EXCERPT_MAX_CHARS, makeExcerpts } from "../src/search/excerpt.ts";
import { parseQuery } from "../src/search/query.ts";
import { searchPages } from "../src/search/rank.ts";

/** 架空の本文だけで作る索引 */
function index(docs: Record<string, string[]>): BigramIndex {
  const list: SourceDoc[] = Object.entries(docs).map(([url, pages]) => ({ url, pages: pages.map((text, i) => ({ page: i + 1, text })) }));
  return BigramIndex.build(list);
}

const run = (idx: BigramIndex, q: string, limit = 8) => searchPages(idx, parseQuery(q), { limit });
const where = (r: ReturnType<typeof run>) => r.hits.map((h) => `${h.ref.url}#${h.ref.page}`);

describe("BigramIndex", () => {
  it("語の 2-gram をすべて含むページを候補にする（部分一致の確認はしない）", () => {
    const idx = index({ a: ["あいうえお", "あいXいう", "かきくけこ"] });
    expect(idx.candidates("あいう").map((p) => p.page)).toEqual([1, 2]);
    expect(idx.candidates("かき").map((p) => p.page)).toEqual([3]);
    expect(idx.candidates("存在").map((p) => p.page)).toEqual([]);
  });

  it("1 文字の語は 2-gram で絞れないので、その文字を含むページを返す", () => {
    const idx = index({ a: ["あいう", "かきく"] });
    expect(idx.candidates("き").map((p) => p.page)).toEqual([2]);
  });

  it("本文を正規化して持つ（全角英字・カタカナの揺れを吸収する）", () => {
    const idx = index({ a: ["ＧＰＡの算出", "プログラム"] });
    expect(idx.candidates("gpa").map((p) => p.page)).toEqual([1]);
    expect(idx.candidates("ぷろぐらむ").map((p) => p.page)).toEqual([2]);
  });
});

describe("searchPages", () => {
  it("2-gram の候補のうち、正規化後の部分一致で確かめたページだけを返す", () => {
    const idx = index({ a: ["あいうえお", "あいXいう"] });
    expect(where(run(idx, "あいう"))).toEqual(["a#1"]);
  });

  it("空白区切りの語は AND（すべて含むページだけ）", () => {
    const idx = index({ a: ["架空の再履修の手続き", "架空の追試の手続き", "再履修と追試の架空規程"] });
    const r = run(idx, "再履修 追試");
    expect(r.mode).toBe("all");
    expect(where(r)).toEqual(["a#3"]);
  });

  it("すべての語を含むページが無ければ、一致した語の多いページから返し mode を some にする", () => {
    const idx = index({ a: ["架空の再履修の手続き", "架空の再履修と追試の架空規程", "無関係の架空ページ"] });
    const r = run(idx, "再履修 追試 学割");
    expect(r.mode).toBe("some");
    expect(where(r)).toEqual(["a#2", "a#1"]);
    expect(r.hits[0]!.terms.map((t) => t.term)).toEqual(["再履修", "追試"]);
  });

  it("同義語でも当たるが、語そのものに当たったページが上に来る", () => {
    const idx = index({ a: ["架空の奨学制度の案内"], b: ["架空の奨学金の案内"] });
    const r = run(idx, "奨学金");
    expect(where(r)).toEqual(["b#1", "a#1"]);
    expect(r.hits[1]!.terms[0]).toMatchObject({ term: "奨学金", needle: "奨学制度", synonym: true });
    expect(r.hits[0]!.score).toBeGreaterThan(r.hits[1]!.score);
  });

  it("語どうしが近いページほど上に来る", () => {
    const far = `再履修${"あ".repeat(400)}追試`;
    const near = `架空の再履修と追試${"い".repeat(400)}`;
    const idx = index({ far: [far], near: [near] });
    expect(where(run(idx, "再履修 追試"))).toEqual(["near#1", "far#1"]);
  });

  it("limit で件数を切る。当たりが無ければ mode は none", () => {
    const idx = index({ a: Array.from({ length: 12 }, (_, i) => `架空の追試 ${i}`) });
    expect(run(idx, "追試", 5).hits).toHaveLength(5);
    expect(run(idx, "学割").mode).toBe("none");
    expect(run(idx, "学割").hits).toEqual([]);
  });

  it("filter で対象の資料を絞る", () => {
    const idx = index({ a: ["架空の追試"], b: ["架空の追試"] });
    const r = searchPages(idx, parseQuery("追試"), { limit: 8, filter: (url) => url === "b" });
    expect(where(r)).toEqual(["b#1"]);
  });
});

describe("makeExcerpts", () => {
  it("一致箇所の前後を合わせて 160 文字までの抜粋を、1 ページ 2 か所まで返す", () => {
    const text = `${"前".repeat(300)}再履修の架空規程${"中".repeat(600)}再履修の架空の注意${"後".repeat(300)}再履修の三つ目`;
    const idx = index({ a: [text] });
    const [hit] = run(idx, "再履修").hits;
    const ex = makeExcerpts(hit!);
    expect(ex).toHaveLength(2);
    for (const e of ex) {
      expect(e.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
      expect(e).toContain("再履修");
    }
    expect(ex[0]).toContain("架空規程");
    expect(ex[1]).toContain("架空の注意");
  });

  it("抜粋は元の表記（カタカナ・全角）のまま。改行や連続する空白は 1 つの空白にする", () => {
    const idx = index({ a: ["架空の\n\nＧＰＡ   算出方法"] });
    const [hit] = run(idx, "gpa").hits;
    expect(makeExcerpts(hit!)).toEqual(["架空の ＧＰＡ 算出方法"]);
  });

  it("近くにある複数の語は 1 つの抜粋にまとめる", () => {
    const idx = index({ a: [`${"あ".repeat(200)}再履修と追試の架空規程${"い".repeat(200)}`] });
    const [hit] = run(idx, "再履修 追試").hits;
    const ex = makeExcerpts(hit!);
    expect(ex[0]).toContain("再履修と追試");
    expect(ex[0]!.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
  });

  it("切ったところには … を付ける", () => {
    const idx = index({ a: [`${"あ".repeat(200)}追試${"い".repeat(200)}`] });
    const [e] = makeExcerpts(run(idx, "追試").hits[0]!);
    expect(e!.startsWith("…")).toBe(true);
    expect(e!.endsWith("…")).toBe(true);
    expect(e!.length).toBe(EXCERPT_MAX_CHARS);
  });
});
