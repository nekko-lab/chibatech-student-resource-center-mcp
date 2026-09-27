import { describe, expect, it } from "vitest";
import { MAX_TERMS, parseQuery } from "../src/search/query.ts";

describe("parseQuery", () => {
  it("空白（半角・全角）で語に分け、正規化する", () => {
    const q = parseQuery("ＧＰＡ　再履修  ");
    expect(q.map((t) => t.raw)).toEqual(["ＧＰＡ", "再履修"]);
    expect(q.map((t) => t.norm)).toEqual(["gpa", "再履修"]);
  });

  it("語そのものは重み 1、同義語は低い重みで展開する", () => {
    const [t] = parseQuery("奨学金");
    const byText = new Map(t!.needles.map((n) => [n.text, n]));
    expect(byText.get("奨学金")).toMatchObject({ weight: 1, synonym: false });
    expect(byText.get("奨学制度")).toMatchObject({ synonym: true });
    expect(byText.get("奨学制度")!.weight).toBeLessThan(1);
  });

  it("語に含まれる辞書の語と、その同義語も探す（重みは語そのものより低い）", () => {
    const [t] = parseQuery("給付型奨学金");
    const byText = new Map(t!.needles.map((n) => [n.text, n]));
    expect(byText.get("給付型奨学金")!.weight).toBe(1);
    expect(byText.get("奨学金")!.weight).toBeLessThan(1);
    expect(byText.get("奨学制度")!.weight).toBeLessThan(byText.get("奨学金")!.weight);
  });

  it("末尾の「について」などを落とした形も語そのものとして探す", () => {
    const [t] = parseQuery("追試について");
    expect(t!.needles.find((n) => n.text === "追試")).toMatchObject({ weight: 1, synonym: false });
  });

  it("同じ語は 1 つにまとめ、語の数に上限を設ける", () => {
    expect(parseQuery("追試 追試 ＧＰＡ gpa").map((t) => t.norm)).toEqual(["追試", "gpa"]);
    const many = Array.from({ length: MAX_TERMS + 3 }, (_, i) => `語${i}`).join(" ");
    expect(parseQuery(many).length).toBe(MAX_TERMS);
    expect(parseQuery("   ")).toEqual([]);
  });
});
