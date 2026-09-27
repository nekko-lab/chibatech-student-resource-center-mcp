import type { TextItem } from "./extract.ts";

interface Line {
  y: number;
  h: number;
  items: TextItem[];
}

/** 字間がフォントサイズのこの割合を超えたら空白を入れる。 */
const SPACE_GAP_RATIO = 0.2;
/** ベースラインの差がフォントサイズのこの割合以内なら同じ行とみなす。 */
const SAME_LINE_RATIO = 0.5;

/**
 * item の並び（content stream の順）から本文を組み立てる。
 *
 * - 読む順（content stream の順）を保ち、y 座標が変わったところで改行する
 * - 同じ行の item は x 順に並べ、間隔が広いところに空白を入れる
 * - 空白だけの item は捨てる（必要な空白は間隔から復元する）
 */
export function layoutText(items: readonly TextItem[]): string {
  const lines: Line[] = [];
  for (const it of items) {
    if (it.str.trim() === "") continue;
    const cur = lines[lines.length - 1];
    if (cur !== undefined && sameLine(cur, it)) {
      cur.items.push(it);
    } else {
      lines.push({ y: it.y, h: it.height, items: [it] });
    }
  }
  return lines
    .map(joinLine)
    .filter((s) => s !== "")
    .join("\n");
}

function sameLine(line: Line, it: TextItem): boolean {
  const h = Math.min(line.h || it.height, it.height || line.h);
  return Math.abs(it.y - line.y) <= Math.max(1, SAME_LINE_RATIO * h);
}

function joinLine(line: Line): string {
  const sorted = [...line.items].sort((a, b) => a.x - b.x);
  let out = "";
  let end = Number.NEGATIVE_INFINITY;
  for (const it of sorted) {
    if (out !== "") {
      const size = Math.max(1, it.height || line.h);
      const gap = it.x - end;
      if (gap > SPACE_GAP_RATIO * size && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
    }
    out += it.str;
    end = Math.max(end, it.x + it.width);
  }
  return out.trim();
}
