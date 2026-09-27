import { describe, expect, it } from "vitest";
import { DEPARTMENT_ALIASES, QUERY_SUFFIX_FILLERS, SYNONYM_GROUPS, normalizeJa } from "../src/index";

// 辞書を足すときの取り違えを機械的に止める検査。
describe("辞書データの整合", () => {
  it("略称は正規化後も空でなく、重複しない", () => {
    const keys = Object.keys(DEPARTMENT_ALIASES).map(normalizeJa);
    expect(keys.every((k) => k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("略称の指す名称は括弧を含まない（注記を除いた名称で書く）", () => {
    for (const targets of Object.values(DEPARTMENT_ALIASES)) {
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) expect(normalizeJa(t)).not.toMatch(/[()]/);
    }
  });

  it("同義語グループは 2 語以上で、グループ内に正規化後の重複が無い", () => {
    for (const g of SYNONYM_GROUPS) {
      const norm = g.map(normalizeJa);
      expect(norm.length).toBeGreaterThanOrEqual(2);
      expect(norm.every((w) => w.length > 0)).toBe(true);
      expect(new Set(norm).size).toBe(norm.length);
    }
  });

  it("言い回しの語は空でない", () => {
    expect(QUERY_SUFFIX_FILLERS.every((f) => normalizeJa(f).length > 0)).toBe(true);
  });
});
