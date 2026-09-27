import { describe, expect, it } from "vitest";
import type { TextItem } from "../src/index.ts";
import { layoutText } from "../src/layout.ts";

const item = (str: string, x: number, y: number, width = str.length * 6, height = 12): TextItem => ({
  str,
  x,
  y,
  width,
  height,
});

describe("layoutText", () => {
  it("空の入力は空文字列", () => {
    expect(layoutText([])).toBe("");
  });

  it("y が変わったところで改行し、描いた順を保つ", () => {
    expect(layoutText([item("a", 0, 10), item("b", 0, 30), item("c", 0, 20)])).toBe("a\nb\nc");
  });

  it("フォントサイズの半分までのベースラインのずれは同じ行", () => {
    expect(layoutText([item("a", 0, 100), item("b", 50, 105.9)])).toBe("a b");
    expect(layoutText([item("a", 0, 100), item("b", 50, 106.1)])).toBe("a\nb");
  });

  it("小さい文字（上付きなど）は小さい側の高さで判定する", () => {
    expect(layoutText([item("x", 0, 100, 6, 20), item("2", 6, 96, 3, 6)])).toBe("x\n2");
  });

  it("字間がフォントサイズの 0.2 倍を超えたら空白を入れる", () => {
    // 高さ 12 → しきい値 2.4
    expect(layoutText([item("ab", 0, 0, 12), item("cd", 12 + 2.5, 0, 12)])).toBe("ab cd");
    expect(layoutText([item("ab", 0, 0, 12), item("cd", 12 + 2.3, 0, 12)])).toBe("abcd");
  });

  it("重なる item（負の間隔）は詰める", () => {
    expect(layoutText([item("ab", 0, 0, 12), item("cd", 10, 0, 12)])).toBe("abcd");
  });

  it("既に空白で終わる・始まる item には空白を足さない", () => {
    expect(layoutText([item("ab ", 0, 0, 18), item("cd", 40, 0)])).toBe("ab cd");
    expect(layoutText([item("ab", 0, 0, 12), item(" cd", 40, 0)])).toBe("ab cd");
  });

  it("空白だけの item は捨て、行頭行末の空白を落とす", () => {
    expect(layoutText([item(" ", 0, 0), item("  a ", 10, 0), item(" ", 0, 50)])).toBe("a");
  });

  it("高さ 0 の item でも行をまとめられる", () => {
    expect(layoutText([item("a", 0, 0, 6, 0), item("b", 6, 0.5, 6, 0), item("c", 0, 10, 6, 0)])).toBe("ab\nc");
  });
});
