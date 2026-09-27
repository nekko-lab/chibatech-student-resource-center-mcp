import { describe, expect, it } from "vitest";
import { normalizeJa } from "../src/index";

describe("normalizeJa", () => {
  it("全角英数を半角にし、英字を小文字にする", () => {
    expect(normalizeJa("ＡＢＣ１２３")).toBe("abc123");
    expect(normalizeJa("G1")).toBe("g1");
  });

  it("カタカナ（半角カナを含む）をひらがなにする", () => {
    expect(normalizeJa("ジョウホウ")).toBe("じょうほう");
    expect(normalizeJa("ｼﾞｮｳﾎｳ")).toBe("じょうほう");
    expect(normalizeJa("ヴァ")).toBe("ゔぁ");
  });

  it("長音・ハイフン類の揺れを統一する", () => {
    const canonical = normalizeJa("コンピューター");
    expect(canonical).toBe("こんぴゅ-た-");
    expect(normalizeJa("コンピュ－タ―")).toBe(canonical);
    expect(normalizeJa("コンピュ‐タ—")).toBe(canonical);
    expect(normalizeJa("Wi‐Fi")).toBe("wi-fi");
    expect(normalizeJa("Ｗｉ－Ｆｉ")).toBe("wi-fi");
    expect(normalizeJa("wi−fi")).toBe("wi-fi");
  });

  it("波ダッシュ（〜 ～ ~）の揺れを統一する", () => {
    const canonical = normalizeJa("2024年度入学~");
    expect(normalizeJa("2024年度入学〜")).toBe(canonical);
    expect(normalizeJa("2024年度入学～")).toBe(canonical);
    expect(canonical).toBe("2024年度入学~");
  });

  it("空白（全角空白・改行を含む）を除去する", () => {
    expect(normalizeJa(" 情報 工学　科\n")).toBe("情報工学科");
  });

  it("全角括弧やコロンは NFKC で半角になる", () => {
    expect(normalizeJa("G1：情報工学科（2024年度入学～）")).toBe("g1:情報工学科(2024年度入学~)");
  });

  it("冪等である", () => {
    for (const s of ["ＡＢＣ", "コンピューター", "情報 工学科（～2023年度入学）", "ｼﾞｮｳﾎｳ"]) {
      expect(normalizeJa(normalizeJa(s))).toBe(normalizeJa(s));
    }
  });

  it("空文字は空文字", () => {
    expect(normalizeJa("")).toBe("");
  });
});
