import type { TextItem } from "./extract.ts";

/** 行の組み立てに使う item。縦書き（pdfjs の dir === "ttb"）なら vertical を立てる。 */
export interface LayoutItem extends TextItem {
  vertical?: boolean;
}

interface Line {
  vertical: boolean;
  /** 横書きはベースラインの y、縦書きは列の x。 */
  pos: number;
  /** 横書きは文字の高さ、縦書きは列の幅（どちらもほぼフォントサイズ）。 */
  size: number;
  items: LayoutItem[];
}

/** 字間がフォントサイズのこの割合を超えたら空白を入れる。 */
const SPACE_GAP_RATIO = 0.2;
/** ベースライン（縦書きは列の位置）の差がフォントサイズのこの割合以内なら同じ行とみなす。 */
const SAME_LINE_RATIO = 0.5;

/**
 * item の並び（content stream の順）から本文を組み立てる。
 *
 * - 読む順（content stream の順）を保ち、y 座標が変わったところで改行する
 * - 同じ行の item は x 順に並べ、間隔が広いところに空白を入れる
 * - 縦書きの item は列（x）ごとにまとめ、上から下へ並べる
 * - 空白だけの item は捨てる（必要な空白は間隔から復元する）
 */
export function layoutText(items: readonly LayoutItem[]): string {
  const lines: Line[] = [];
  for (const it of items) {
    if (it.str.trim() === "") continue;
    const vertical = it.vertical === true;
    const pos = vertical ? it.x : it.y;
    const size = vertical ? it.width : it.height;
    const cur = lines[lines.length - 1];
    if (cur !== undefined && cur.vertical === vertical && near(cur, pos, size)) {
      cur.items.push(it);
    } else {
      lines.push({ vertical, pos, size, items: [it] });
    }
  }
  return lines
    .map(joinLine)
    .filter((s) => s !== "")
    .join("\n");
}

function near(line: Line, pos: number, size: number): boolean {
  const s = Math.min(line.size || size, size || line.size);
  return Math.abs(pos - line.pos) <= Math.max(1, SAME_LINE_RATIO * s);
}

function joinLine(line: Line): string {
  // 横書きは左から右（x）、縦書きは上から下（y）に進む
  const start = (it: LayoutItem) => (line.vertical ? it.y : it.x);
  const extent = (it: LayoutItem) => (line.vertical ? it.height : it.width);
  const size = (it: LayoutItem) => Math.max(1, (line.vertical ? it.width : it.height) || line.size);

  const sorted = [...line.items].sort((a, b) => start(a) - start(b));
  let out = "";
  let end = Number.NEGATIVE_INFINITY;
  for (const it of sorted) {
    if (out !== "") {
      const gap = start(it) - end;
      if (gap > SPACE_GAP_RATIO * size(it) && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
    }
    out += it.str;
    end = Math.max(end, start(it) + extent(it));
  }
  return out.trim();
}
