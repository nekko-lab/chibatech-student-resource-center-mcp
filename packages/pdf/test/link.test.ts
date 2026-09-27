import { describe, expect, it } from "vitest";
import { parsePdfLink } from "../src/index.ts";

// 実サイトの URL は使わず、構造だけ同じ架空のホストで確かめる
const BASE = "https://portal.example.test/portal/dept/index.html";

describe("parsePdfLink", () => {
  it("相対パスを base から絶対 URL に解決する", () => {
    expect(parsePdfLink("../common_2026/life.pdf", BASE)).toEqual({
      url: "https://portal.example.test/portal/common_2026/life.pdf",
    });
  });

  it("#page=N をページ番号として取り出し、fragment を URL から除く", () => {
    expect(parsePdfLink("../common_2026/life.pdf#page=13", BASE)).toEqual({
      url: "https://portal.example.test/portal/common_2026/life.pdf",
      page: 13,
    });
  });

  it("クエリは URL に残し、fragment だけを除く", () => {
    expect(parsePdfLink("files/schedule.pdf?20260611_01#page=2", BASE)).toEqual({
      url: "https://portal.example.test/portal/dept/files/schedule.pdf?20260611_01",
      page: 2,
    });
  });

  it("クエリだけでページ指定が無ければ page を持たない", () => {
    const r = parsePdfLink("files/schedule.pdf?20260611_01", BASE);
    expect(r).toEqual({ url: "https://portal.example.test/portal/dept/files/schedule.pdf?20260611_01" });
    expect("page" in r).toBe(false);
  });

  it("page 以外のパラメータが並んでいても page を読む", () => {
    expect(parsePdfLink("a.pdf#zoom=100&page=7", BASE).page).toBe(7);
    expect(parsePdfLink("a.pdf#page=7&zoom=100", BASE).page).toBe(7);
    expect(parsePdfLink("a.pdf#PAGE=4", BASE).page).toBe(4);
  });

  it("絶対 URL はそのまま扱う", () => {
    expect(parsePdfLink("https://other.example.test/x.pdf#page=3", BASE)).toEqual({
      url: "https://other.example.test/x.pdf",
      page: 3,
    });
  });

  it("ルート相対パスに対応する", () => {
    expect(parsePdfLink("/portal/common_2026/life.pdf#page=1", BASE).url).toBe(
      "https://portal.example.test/portal/common_2026/life.pdf",
    );
  });

  it("不正なページ番号（0・負・数値でない）は無視する", () => {
    expect(parsePdfLink("a.pdf#page=0", BASE).page).toBeUndefined();
    expect(parsePdfLink("a.pdf#page=-2", BASE).page).toBeUndefined();
    expect(parsePdfLink("a.pdf#page=abc", BASE).page).toBeUndefined();
    expect(parsePdfLink("a.pdf#page=", BASE).page).toBeUndefined();
  });

  it("前後の空白を許す", () => {
    expect(parsePdfLink("  a.pdf#page=5 ", BASE)).toEqual({
      url: "https://portal.example.test/portal/dept/a.pdf",
      page: 5,
    });
  });

  it("日本語を含むパスはパーセントエンコードされた URL になる", () => {
    const r = parsePdfLink("資料/便覧.pdf#page=2", BASE);
    expect(r.url).toBe(`https://portal.example.test/portal/dept/${encodeURI("資料/便覧.pdf")}`);
    expect(r.page).toBe(2);
  });
});
