/**
 * 座標付きテキストから表を復元するための幾何の道具。すべて純関数。
 *
 * 列の境界は固定の数値を持たず、見出し語の x 範囲と、その間にある内容の「空き」から決める。
 */
import type { TextItem } from "./types.ts";

/** 空白を除いた 1 つの文字列片。x0..x1 が横の範囲、y はベースライン */
export interface Box {
  str: string;
  x0: number;
  x1: number;
  cx: number;
  y: number;
  h: number;
}

export interface Line {
  y: number;
  h: number;
  /** x の昇順 */
  boxes: Box[];
}

export interface Span {
  x0: number;
  x1: number;
}

/** 空文字・空白だけの item を捨て、横の範囲と中心を持つ Box にする */
export function toBoxes(items: readonly TextItem[]): Box[] {
  const out: Box[] = [];
  for (const it of items) {
    if (it.str.trim() === "") continue;
    const len = [...it.str].length;
    const h = it.height > 0 ? it.height : it.width > 0 ? it.width / Math.max(1, len) : 1;
    const x1 = it.x + Math.max(0, it.width);
    out.push({ str: it.str, x0: it.x, x1, cx: (it.x + x1) / 2, y: it.y, h });
  }
  return out;
}

/**
 * ベースラインの近い Box を 1 行にまとめる。
 * `tolerance` は文字高さに対する比。行の基準は最初に入った Box の y（連鎖して行が太らないように）。
 */
export function groupLines(boxes: readonly Box[], tolerance = 0.35): Line[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines: Line[] = [];
  let cur: Line | undefined;
  for (const b of sorted) {
    if (cur && Math.abs(b.y - cur.y) <= tolerance * Math.max(b.h, cur.h)) {
      cur.boxes.push(b);
      cur.h = Math.max(cur.h, b.h);
    } else {
      cur = { y: b.y, h: b.h, boxes: [b] };
      lines.push(cur);
    }
  }
  for (const l of lines) l.boxes.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** 1 行の中で、隙間が文字高さの `gapRatio` 倍以下の Box を 1 語につなぐ */
export function groupWords(line: Line, gapRatio: number): Box[] {
  const out: Box[] = [];
  for (const b of line.boxes) {
    const last = out[out.length - 1];
    if (last && b.x0 - last.x1 <= gapRatio * Math.max(last.h, b.h)) {
      last.str += b.str;
      last.x1 = Math.max(last.x1, b.x1);
      last.cx = (last.x0 + last.x1) / 2;
      last.h = Math.max(last.h, b.h);
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/**
 * 見出しの x 範囲（左から順）と内容の x 範囲から、列の境界（見出しの数 - 1 個）を決める。
 *
 * 隣り合う見出しの間 [左の右端, 右の左端] で、内容に覆われていない最も広い区間の中央を境界にする。
 * 見出しは列の中央にあるとは限らない（均等割付・左寄せ・内容より狭い見出し）ので、中点ではなく「空き」を使う。
 */
export function columnBoundaries(headers: readonly Span[], content: readonly Span[]): number[] {
  const hs = [...headers].sort((a, b) => a.x0 - b.x0);
  const out: number[] = [];
  for (let i = 0; i + 1 < hs.length; i++) {
    const a = hs[i]!;
    const b = hs[i + 1]!;
    const lo = a.x1;
    const hi = b.x0;
    if (lo >= hi) {
      out.push(((a.x0 + a.x1) / 2 + (b.x0 + b.x1) / 2) / 2);
      continue;
    }
    const covered = content
      .map((c) => ({ x0: Math.max(lo, c.x0), x1: Math.min(hi, c.x1) }))
      .filter((c) => c.x1 > c.x0)
      .sort((p, q) => p.x0 - q.x0);
    let best: Span | undefined;
    let cursor = lo;
    const consider = (x0: number, x1: number) => {
      if (x1 > x0 && (!best || x1 - x0 > best.x1 - best.x0)) best = { x0, x1 };
    };
    for (const c of covered) {
      consider(cursor, c.x0);
      cursor = Math.max(cursor, c.x1);
    }
    consider(cursor, hi);
    out.push(best ? (best.x0 + best.x1) / 2 : (lo + hi) / 2);
  }
  return out;
}

/** 境界の配列から x が属する列番号（0 始まり）を返す */
export function columnOf(boundaries: readonly number[], x: number): number {
  let i = 0;
  while (i < boundaries.length && x >= boundaries[i]!) i++;
  return i;
}

/** 照合用の正規化: NFKC（全角英数・括弧を半角に）と空白の除去 */
export function normalize(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}

/** 隣り合う値の差（昇順に並べた y から行間を出すのに使う） */
export function diffs(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(values[i]! - values[i - 1]!);
  return out;
}

/** 1 行の Box を読み順につなぐ。文字高さより広い隙間には空白を 1 つ入れる */
export function lineText(boxes: readonly Box[], gapRatio = 1.5): string {
  let s = "";
  let prev: Box | undefined;
  for (const b of [...boxes].sort((p, q) => p.x0 - q.x0)) {
    if (prev && b.x0 - prev.x1 > gapRatio * Math.max(prev.h, b.h)) s += " ";
    s += b.str.trim();
    prev = b;
  }
  return s.replace(/\s+/g, " ").trim();
}
