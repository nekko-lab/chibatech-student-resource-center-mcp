import { normalizeJa } from "@chibatech-src/match";
import { describe, expect, it } from "vitest";
import { bigramsOf, normalizeText, normalizeWithMap } from "../src/search/text.ts";

describe("normalizeText / normalizeWithMap", () => {
  const samples = [
    "架空の ＧＰＡ 制度について\n再履修は　所定の手続きで",
    "ｶﾞｸﾜﾘ（学割）の申請 ―― 架空窓口",
    "プログラム〜演習（２単位）",
    "",
    "   ",
  ];

  it.each(samples)("normalizeJa と同じ結果になる: %j", (s) => {
    expect(normalizeText(s)).toBe(normalizeJa(s));
    expect(normalizeWithMap(s).norm).toBe(normalizeJa(s));
  });

  it("正規化後の各文字から元の文字位置を引ける（空白は落ち、半角カナの濁点は 1 文字にまとまる）", () => {
    const src = "ｶﾞｸ 割";
    const { norm, start, end } = normalizeWithMap(src);
    expect(norm).toBe("がく割");
    expect([...start]).toEqual([0, 2, 4]);
    expect([...end]).toEqual([2, 3, 5]);
  });

  it("NFKC で伸びる文字は、伸びた全ての文字が元の同じ位置を指す", () => {
    const { norm, start, end } = normalizeWithMap("第①回");
    expect(norm).toBe("第1回");
    expect(src(norm, start, end, "第①回", 1)).toBe("①");
  });
});

function src(_norm: string, start: Uint32Array, end: Uint32Array, text: string, i: number): string {
  return text.slice(start[i]!, end[i]!);
}

describe("bigramsOf", () => {
  it("重複を除いた 2-gram を返す。1 文字以下なら空", () => {
    expect(bigramsOf("あいあい")).toEqual(["あい", "いあ"]);
    expect(bigramsOf("あ")).toEqual([]);
    expect(bigramsOf("")).toEqual([]);
  });
});
