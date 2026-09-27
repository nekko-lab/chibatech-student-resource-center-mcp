import { PortalError, type DocumentCategory } from "@chibatech-src/portal";
import { describe, expect, it } from "vitest";
import { MAX_OUTPUT_CHARS, collectCorpus, searchDocuments } from "../src/macros/search.ts";
import type { Outcome } from "../src/respond.ts";
import { DocumentIndex } from "../src/search/indexer.ts";
import { BASE, LM, MANUALS, fakeEnv } from "./helpers/ports.ts";

const LIFE = `${BASE}fic/common_2099/life.pdf`;
const XENG = `${BASE}fic/xeng_2099.pdf`;
const OFFICE = `${BASE}fic/common_2099/office.pdf`;
const CAL = `${BASE}whole/gakubu/calendar.pdf`;
const BUS = `${BASE}whole/gakubu/bus.pdf`;
const ADVISERS = `${BASE}whole/gakubu/advisers.pdf`;
const MAN_A = `${BASE}whole/web_manual/a.pdf`;
const MAN_B = `${BASE}whole/web_manual/b.pdf`;
const MAN_LOGIN = `${BASE}whole/web_manual/login_only.pdf`;
const MAN_XLSX = `${BASE}whole/web_manual/form.xlsx`;
const MAN_DOC = `${BASE}whole/web_manual/form.doc`;

/** 文書一覧（各種申請書・マニュアル）に、索引に入れない形の項目を足したもの（すべて架空） */
const MANUALS_MIXED: DocumentCategory[] = [
  ...MANUALS,
  {
    category: "架空の様式",
    items: [
      { title: "架空の申請様式（Excel）", url: MAN_XLSX, ext: "xlsx", requiresLogin: false },
      { title: "架空の申請様式（Word）", url: MAN_DOC, ext: "doc", requiresLogin: false },
      { title: "架空の学内限定手引き", url: MAN_LOGIN, ext: "pdf", requiresLogin: true },
      { title: "架空の共有フォルダの手引き", url: "https://drive.example.com/file/x.pdf", ext: "pdf", requiresLogin: false },
    ],
  },
];

const filler = (n: number) => `架空の本文${n}。`.repeat(5);

function setup(profile: Parameters<typeof fakeEnv>[0] = { studentType: "undergrad", admissionYear: 2099, department: "X1" }, o: { secondsPerDoc?: number } = {}) {
  const { env, portal, docs } = fakeEnv(profile);
  const documents = portal.documents.bind(portal);
  portal.documents = async (kind) => {
    const l = await documents(kind);
    return kind === "manual" ? { ...l, items: MANUALS_MIXED } : l;
  };
  const life = Array.from({ length: 25 }, (_, i) => filler(i + 1));
  life[19] = "架空の奨学制度の案内。ＧＰＡが架空の基準に満たない場合は継続できません。";
  life[13] = "架空の通学案内。架空の学割証は窓口で発行します。";
  docs.texts.set(LIFE, life);
  const xeng = Array.from({ length: 10 }, (_, i) => filler(i + 1));
  xeng[6] = "架空の再履修の規程。再履修科目は架空の手続きで登録します。";
  xeng[7] = "追試の申請は架空の窓口へ。再履修とは別の扱いです。";
  docs.texts.set(XENG, xeng);
  docs.texts.set(OFFICE, ["架空の教員室一覧"]);
  docs.texts.set(CAL, ["架空の学年暦。架空の追試期間を設けます。"]);
  docs.texts.set(BUS, ["架空のバスダイヤ。架空駅と架空大学の間。"]);
  docs.texts.set(ADVISERS, ["架空の担任 追試 GPA 再履修 学割"]);
  docs.texts.set(MAN_A, ["架空の学びの手引き。GPA の架空の計算方法。"]);
  docs.texts.set(MAN_B, ["架空の保険のしおり。"]);
  docs.texts.set(MAN_LOGIN, ["架空の学内限定 GPA"]);
  let t = 0;
  docs.beforeReadAll = () => {
    t += (o.secondsPerDoc ?? 0) * 1000;
  };
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const logs: string[] = [];
  const index = new DocumentIndex({ clock: clock.now, log: (m) => logs.push(m) });
  return { env, portal, docs, index, clock, logs };
}

type Hit = { title: string; url: string; page: number; lastModified: string | null; matchedTerms: string[]; excerpts: string[]; score: number; document?: string };

function body(o: Outcome): Record<string, unknown> {
  if (o.status === "needs_clarification") throw new Error(`聞き返しになった: ${JSON.stringify(o)}`);
  return { status: o.status, ...o.data, sources: o.sources };
}

describe("collectCorpus", () => {
  it("学科ページの PDF（重複を除く）・クイックリンクの PDF・申請書・マニュアルの PDF を集める", async () => {
    const { env } = setup();
    const page = await env.portal.departmentPage("undergrad", 2099, "X1");
    const c = await collectCorpus(env, page);
    expect(c.docs.map((d) => d.url)).toEqual([LIFE, XENG, OFFICE, CAL, BUS, MAN_A, MAN_B]);
    expect(c.docs.find((d) => d.url === LIFE)!.parts!.map((p) => p.title)).toEqual([
      "架空の年間行事",
      "架空の学生証",
      "架空のクラス担任",
      "架空の通学案内",
      "架空の奨学制度",
    ]);
  });

  it("学科長・クラス担任表は個人名の一覧なので入れない（バスダイヤは入れる）", async () => {
    const { env } = setup();
    const c = await collectCorpus(env, undefined);
    expect(c.docs.map((d) => d.url)).not.toContain(ADVISERS);
    expect(c.docs.map((d) => d.url)).toContain(BUS);
    expect(c.excluded).toContainEqual(expect.objectContaining({ url: ADVISERS, reason: expect.stringMatching(/個人名/) }));
  });

  it("doc / xlsx・要ログイン・ポータル外（Google Drive など）は入れない", async () => {
    const { env } = setup();
    const c = await collectCorpus(env, undefined);
    const urls = c.docs.map((d) => d.url);
    for (const u of [MAN_XLSX, MAN_DOC, MAN_LOGIN, "https://drive.example.com/file/x.pdf", "https://drive.example.com/vpn"]) {
      expect(urls).not.toContain(u);
    }
    expect(c.excluded.map((e) => e.url)).toEqual(expect.arrayContaining([MAN_XLSX, MAN_DOC, MAN_LOGIN]));
  });
});

describe("searchDocuments", () => {
  it("PDF の本文を横断して探し、資料名・URL・ページ・Last-Modified・一致した語・短い抜粋・score を返す", async () => {
    const { env, docs, index } = setup();
    const b = body(await searchDocuments(env, index, { query: "GPA" }));
    expect(b.status).toBe("ok");
    expect(b.scope).toBe("department");
    expect(b.department).toEqual({ code: "X1", name: "架空機械学科" });
    const hits = b.hits as Hit[];
    // 同点なら学科ページ → クイックリンク → マニュアルの順
    expect(hits.map((h) => `${h.url}#${h.page}`)).toEqual([`${LIFE}#20`, `${MAN_A}#1`]);
    const life = hits.find((h) => h.url === LIFE)!;
    expect(life).toMatchObject({ title: "架空の奨学制度", document: "life.pdf", page: 20, lastModified: LM, matchedTerms: ["GPA"] });
    expect(life.excerpts[0]).toContain("ＧＰＡ");
    expect(typeof life.score).toBe("number");
    expect(String(b.howToRead)).toMatch(/document_read_text/);
    expect(b.index).toMatchObject({ indexed: 7, total: 7, complete: true });
    // 担任表は取得もしない
    expect(docs.calls.some((c) => c.includes("advisers"))).toBe(false);
    expect(b.sources).toEqual(
      expect.arrayContaining([{ title: "life.pdf", url: LIFE, pages: [20], lastModified: LM }]),
    );
  });

  it("同義語で展開し、空白区切りの語は AND で探す", async () => {
    const { env, index } = setup();
    const both = body(await searchDocuments(env, index, { query: "再履修 追試" }));
    expect((both.hits as Hit[]).map((h) => `${h.url}#${h.page}`)).toEqual([`${XENG}#8`]);
    expect(both.matchMode).toBe("all");
    const syn = body(await searchDocuments(env, index, { query: "奨学金" }));
    expect((syn.hits as Hit[]).map((h) => `${h.url}#${h.page}`)).toEqual([`${LIFE}#20`]);
    expect((syn.hits as Hit[])[0]!.matchedTerms).toEqual(["奨学金（同義語「奨学制度」）"]);
    // 資料名は、そのページを含む学科ページの項目（同じページの項目が複数なら後のもの）
    const discount = body(await searchDocuments(env, index, { query: "学割" }));
    expect((discount.hits as Hit[]).map((h) => [h.page, h.title])).toEqual([[14, "架空の通学案内"]]);
  });

  it("当たりが無ければ語を変えるよう案内する", async () => {
    const { env, index } = setup();
    const b = body(await searchDocuments(env, index, { query: "存在しない架空語" }));
    expect(b.hits).toEqual([]);
    expect(b.matchMode).toBe("none");
    expect(String(b.note)).toMatch(/見つかりません/);
  });

  it("区分・年度・学科が分からなければ共通の PDF だけを検索し、その旨を返す", async () => {
    const { env, portal, docs, index } = setup({});
    const b = body(await searchDocuments(env, index, { query: "追試" }));
    expect(b.scope).toBe("common");
    expect(String(b.note)).toMatch(/共通/);
    expect(portal.calls.some((c) => c.startsWith("departmentPage"))).toBe(false);
    expect(docs.calls.some((c) => c.includes(XENG))).toBe(false);
    expect((b.hits as Hit[]).map((h) => h.url)).toEqual([CAL]);
  });

  it("指定した学科が曖昧なら聞き返す", async () => {
    const { env, index } = setup({ studentType: "graduate", admissionYear: 2099 });
    const o = await searchDocuments(env, index, { query: "追試", department: "架空工学専攻" });
    expect(o.status).toBe("needs_clarification");
  });

  it("空の検索語は VALIDATION", async () => {
    const { env, index } = setup();
    await expect(searchDocuments(env, index, { query: "  　" })).rejects.toBeInstanceOf(PortalError);
  });

  it("時間の上限に達したら、それまでの分で検索した結果に status partial と進み具合を付け、次の呼び出しで続きから作る", async () => {
    const { env, docs, index } = setup(undefined, { secondsPerDoc: 10 });
    const first = body(await searchDocuments(env, index, { query: "GPA" }));
    expect(first.status).toBe("partial");
    expect(first.progress).toEqual({ indexed: 3, total: 7 });
    expect(String(first.hint)).toMatch(/もう一度/);
    expect((first.hits as Hit[]).map((h) => h.url)).toEqual([LIFE]);

    const second = body(await searchDocuments(env, index, { query: "GPA" }));
    expect(second.status).toBe("partial");
    expect(second.progress).toEqual({ indexed: 6, total: 7 });

    const third = body(await searchDocuments(env, index, { query: "GPA" }));
    expect(third.status).toBe("ok");
    expect((third.hits as Hit[]).map((h) => h.url)).toEqual([LIFE, MAN_A]);
    expect(new Set(docs.extractions).size).toBe(docs.extractions.length); // 同じ PDF を 2 度作らない
  });

  it("Last-Modified が同じなら、確かめ直しても本文を取り出し直さない", async () => {
    const { env, docs, index, clock } = setup();
    await searchDocuments(env, index, { query: "GPA" });
    const n = docs.extractions.length;
    clock.advance(13 * 3600_000);
    await searchDocuments(env, index, { query: "GPA" });
    expect(docs.calls.filter((c) => c === `all ${LIFE}`)).toHaveLength(2);
    expect(docs.extractions.length).toBe(n);
  });

  it("件数は既定 8・上限 20。全体の出力は 6,000 文字以内に収める", async () => {
    const { env, docs, index } = setup();
    docs.texts.set(
      LIFE,
      Array.from({ length: 25 }, (_, i) => `${"架空の長い前置き。".repeat(20)}追試${"架空の長い後書き。".repeat(20)}追試${"架空の続き。".repeat(30)}${i}`),
    );
    const d = body(await searchDocuments(env, index, { query: "追試" }));
    expect((d.hits as Hit[]).length).toBe(8);
    const big = body(await searchDocuments(env, index, { query: "追試", limit: 50 }));
    const text = JSON.stringify(big, null, 2);
    expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect((big.hits as Hit[]).length).toBeLessThan(20);
    expect(big.omittedHits).toBeGreaterThan(0);
    for (const h of big.hits as Hit[]) {
      expect(h.excerpts.length).toBeLessThanOrEqual(2);
      for (const e of h.excerpts) expect(e.length).toBeLessThanOrEqual(160);
    }
  });

  it("取得できなかった PDF は failed として返し、ほかの PDF の結果は返す", async () => {
    const { env, docs, index } = setup();
    docs.texts.delete(OFFICE);
    const b = body(await searchDocuments(env, index, { query: "GPA" }));
    expect(b.status).toBe("ok");
    expect((b.index as { failed: { url: string }[] }).failed.map((f) => f.url)).toEqual([OFFICE]);
  });
});
