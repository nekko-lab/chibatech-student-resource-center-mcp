import { describe, expect, it } from "vitest";
import { resolveYear } from "../src/index";

const SEP = new Date(2026, 8, 27); // 2026-09-27（2026 年度）
const FEB = new Date(2026, 1, 10); // 2026-02-10（2025 年度）
const APR1 = new Date(2026, 3, 1); // 2026-04-01（2026 年度の初日）
const MAR31 = new Date(2026, 2, 31); // 2026-03-31（2025 年度の最終日）

describe("resolveYear", () => {
  it.each([
    ["2024", 2024],
    ["２０２４", 2024],
    ["24", 2024],
    ["24年度", 2024],
    ["24年", 2024],
    ["2024年度入学", 2024],
    ["2024年入学の情工", 2024],
    ["R6", 2024],
    ["r6", 2024],
    ["R6年度", 2024],
    ["令和6年", 2024],
    ["令和6年度", 2024],
    ["令和元年", 2019],
    ["H28", 2016],
    ["平成28年度", 2016],
  ])("絶対表現 %s → %i", (input, expected) => {
    expect(resolveYear(input, SEP)).toBe(expected);
  });

  it.each([
    ["今年", 2026],
    ["今年度", 2026],
    ["本年度", 2026],
    ["去年", 2025],
    ["昨年", 2025],
    ["昨年度", 2025],
    ["前年度", 2025],
    ["一昨年", 2024],
    ["おととし", 2024],
    ["来年度", 2027],
    ["今年入学", 2026],
  ])("相対表現 %s → %i（9 月基準）", (input, expected) => {
    expect(resolveYear(input, SEP)).toBe(expected);
  });

  it("年度は 4 月始まり（1〜3 月は前年度）", () => {
    expect(resolveYear("今年", FEB)).toBe(2025);
    expect(resolveYear("去年", FEB)).toBe(2024);
    expect(resolveYear("今年度", MAR31)).toBe(2025);
    expect(resolveYear("今年度", APR1)).toBe(2026);
    expect(resolveYear("昨年度", APR1)).toBe(2025);
  });

  it.each(["", "abc", "情工", "1年生", "B2", "M1", "123"])("年と読めない %s は undefined", (input) => {
    expect(resolveYear(input, SEP)).toBeUndefined();
  });
});
