import { describe, expect, it } from "vitest";
import { pageRangeForItem } from "../src/index.ts";

const LIFE = "https://portal.example.test/portal/common_2026/life.pdf";
const RULE = "https://portal.example.test/portal/common_2026/rule.pdf";

describe("pageRangeForItem", () => {
  it("次の項目のページの直前ページまでを範囲にする", () => {
    const items = [
      { url: LIFE, page: 3 },
      { url: LIFE, page: 7 },
    ];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 3, to: 6 });
  });

  it("最後の項目は to を持たない", () => {
    const items = [
      { url: LIFE, page: 3 },
      { url: LIFE, page: 7 },
    ];
    const r = pageRangeForItem(items, 1);
    expect(r).toEqual({ from: 7 });
    expect(r.to).toBeUndefined();
  });

  it("同じページを共有する項目が連続するときは、ページが大きくなる項目まで読み進める", () => {
    const items = [
      { url: LIFE, page: 13 },
      { url: LIFE, page: 13 },
      { url: LIFE, page: 16 },
    ];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 13, to: 15 });
    expect(pageRangeForItem(items, 1)).toEqual({ from: 13, to: 15 });
    expect(pageRangeForItem(items, 2)).toEqual({ from: 16 });
  });

  it("次の項目が隣のページなら 1 ページだけの範囲になる", () => {
    const items = [
      { url: LIFE, page: 4 },
      { url: LIFE, page: 5 },
    ];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 4, to: 4 });
  });

  it("別の PDF の項目は飛ばして、同じ PDF の次の項目で区切る", () => {
    const items = [
      { url: LIFE, page: 2 },
      { url: RULE, page: 1 },
      { url: RULE, page: 9 },
      { url: LIFE, page: 10 },
    ];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 2, to: 9 });
    expect(pageRangeForItem(items, 1)).toEqual({ from: 1, to: 8 });
    expect(pageRangeForItem(items, 2)).toEqual({ from: 9 });
  });

  it("後続にページ番号が小さい項目（並びの乱れ）があっても、大きくなる項目で区切る", () => {
    const items = [
      { url: LIFE, page: 10 },
      { url: LIFE, page: 2 },
      { url: LIFE, page: 12 },
    ];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 10, to: 11 });
  });

  it("後続のページ無し項目は区切りに使わない", () => {
    const items = [{ url: LIFE, page: 5 }, { url: LIFE }, { url: LIFE, page: 8 }];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 5, to: 7 });
  });

  it("page 無しの項目は from=1 で to を持たない", () => {
    const items = [{ url: LIFE }, { url: LIFE, page: 4 }];
    expect(pageRangeForItem(items, 0)).toEqual({ from: 1 });
  });

  it("範囲外の index は RangeError", () => {
    expect(() => pageRangeForItem([{ url: LIFE, page: 1 }], 1)).toThrow(RangeError);
    expect(() => pageRangeForItem([{ url: LIFE, page: 1 }], -1)).toThrow(RangeError);
  });
});
