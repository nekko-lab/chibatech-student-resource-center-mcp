/**
 * バスダイヤ PDF と同じ幾何構造を持つ合成 PageItems を作る生成器。
 *
 * 実物の PDF・時刻は一切含めない。再現しているのは「形」だけ:
 * - タイトルと期間が同じベースラインに並ぶ
 * - 中央に「時刻」列、左右に「〇〇発 / 〇〇行」の方向ブロック
 * - 曜日区分の見出しは 1 文字ずつ離して置かれる（均等割付）か、縦に積まれる
 * - 分は曜日区分の中で複数の小列に並び、左側は時刻列に近いほど早い（鏡像）
 * - 注記付きの分は分が少し上に、注記「（茜55）」がその下にずれる。注記が 2 片に割れることもある
 * - 空文字の item、幅だけ持つ空白 item が混ざる
 */
import type { PageItems, TextItem } from "../../src/types.ts";

export interface FixtureDeparture {
  min: number;
  note?: string;
  /** 注記を「(茜」「50)」の 2 片に割って置く */
  splitNote?: boolean;
}

export interface FixtureColumn {
  /** 見出しの各行。空白を含む行は 1 文字ずつ均等割付で置く（例: "土 曜"） */
  header: string[];
  /** 時 → その時台の発車（分） */
  departures: Record<number, FixtureDeparture[]>;
}

export interface FixtureDirection {
  from: string;
  to: string;
  /** 時刻列に近い側から順に */
  columns: FixtureColumn[];
}

export interface BusGeometry {
  pageWidth: number;
  pageHeight: number;
  /** 時刻列の中心 x */
  hourX: number;
  /** 時刻列の中心から最初の曜日列の内側の縁までの距離 */
  hourGap: number;
  /** 曜日列の幅（時刻列に近い側から）。数値なら全列同じ */
  columnWidths: number[] | number;
  /** 1 つの曜日列に並べられる分の小列の数 */
  slots: number;
  titleY: number;
  firstRowY: number;
  rowPitch: number;
  font: number;
}

export interface BusFixture {
  /** 例: "令 和 ９ 年 度 前 期 バ ス ダ イ ヤ"（空白入りのまま 1 item で置く） */
  title: string;
  period?: string;
  hours: number[];
  left: FixtureDirection;
  right: FixtureDirection;
  footnotes?: string[];
  geometry?: Partial<BusGeometry>;
}

export const DEFAULT_BUS_GEOMETRY: BusGeometry = {
  pageWidth: 841.68,
  pageHeight: 595.2,
  hourX: 406,
  hourGap: 30,
  columnWidths: [90, 110, 50, 36],
  slots: 2,
  titleY: 79.8,
  firstRowY: 178.6,
  rowPitch: 23.8,
  font: 9.4,
};

const HEADER_FONT = 10.7;
const SMALL_FONT = 6.7;

function item(str: string, x: number, y: number, width: number, height: number): TextItem {
  return { str, x, y, width, height };
}

/** 文字を [x0, x1] に均等割付し、間に幅付きの空白 item を挟む（Excel の均等割付の出力に似せる） */
function distributed(chars: string[], x0: number, x1: number, y: number, font: number): TextItem[] {
  const out: TextItem[] = [];
  const n = chars.length;
  const step = n > 1 ? (x1 - x0 - font) / (n - 1) : 0;
  chars.forEach((c, i) => {
    const x = n > 1 ? x0 + i * step : (x0 + x1) / 2 - font / 2;
    out.push(item("", x, y, 0, 0));
    out.push(item(c, x, y, font, font));
    if (i < n - 1) out.push(item(" ", x + font, y, 3.3, 0));
  });
  return out;
}

function centered(str: string, cx: number, y: number, font: number): TextItem[] {
  const w = str.length * font;
  return [item("", cx - w / 2, y, 0, 0), item(str, cx - w / 2, y, w, font), item(" ", cx + w / 2, y, 40, 0)];
}

interface ColumnBox {
  x0: number;
  x1: number;
  inner: number;
  side: "left" | "right";
}

function layoutColumns(dir: FixtureDirection, side: "left" | "right", g: BusGeometry): ColumnBox[] {
  const widths = dir.columns.map((_, i) =>
    Array.isArray(g.columnWidths) ? (g.columnWidths[i] ?? g.columnWidths[g.columnWidths.length - 1] ?? 60) : g.columnWidths,
  );
  const boxes: ColumnBox[] = [];
  let edge = side === "left" ? g.hourX - g.hourGap : g.hourX + g.hourGap;
  for (const w of widths) {
    if (side === "left") {
      boxes.push({ x0: edge - w, x1: edge, inner: edge, side });
      edge -= w;
    } else {
      boxes.push({ x0: edge, x1: edge + w, inner: edge, side });
      edge += w;
    }
  }
  return boxes;
}

function headerItems(col: FixtureColumn, box: ColumnBox): TextItem[] {
  const out: TextItem[] = [];
  const lines = col.header;
  const ys =
    lines.length === 1 ? [151.9] : lines.length === 2 ? [147.7, 155.2] : lines.map((_, i) => 143.0 + i * 8.9);
  const cx = (box.x0 + box.x1) / 2;
  lines.forEach((line, i) => {
    const y = ys[i] ?? 151.9;
    if (line.includes(" ")) {
      const chars = line.split(/\s+/).filter(Boolean);
      const pad = (box.x1 - box.x0) * 0.1;
      out.push(...distributed(chars, box.x0 + pad, box.x1 - pad, y, HEADER_FONT));
    } else {
      out.push(...centered(line, cx, y, SMALL_FONT));
    }
  });
  return out;
}

function departureItems(col: FixtureColumn, box: ColumnBox, g: BusGeometry, rows: Map<number, number>): TextItem[] {
  const out: TextItem[] = [];
  const slotW = (box.x1 - box.x0) / g.slots;
  const digitW = g.font * 1.01;
  for (const [hourStr, deps] of Object.entries(col.departures)) {
    const hour = Number(hourStr);
    const r = rows.get(hour);
    if (r === undefined) throw new Error(`fixture: hour ${hour} is not in hours`);
    const rowY = g.firstRowY + r * g.rowPitch;
    const sorted = [...deps].sort((a, b) => a.min - b.min);
    if (sorted.length > g.slots) throw new Error(`fixture: too many departures in ${hour}時`);
    sorted.forEach((d, j) => {
      const cx = box.side === "left" ? box.inner - (j + 0.5) * slotW : box.inner + (j + 0.5) * slotW;
      const text = String(d.min).padStart(2, "0");
      const w = digitW * 2;
      const y = d.note ? rowY - 3.9 : rowY;
      out.push(item("", cx - w / 2, y, 0, 0));
      out.push(item(text, cx - w / 2, y, w, g.font));
      out.push(item(" ", cx + w / 2, y, 3.2, 0));
      if (d.note) {
        const ny = rowY + 8.4;
        if (d.splitNote) {
          const head = `(${d.note.slice(0, 1)}`;
          const tail = `${d.note.slice(1)})`;
          const hw = head.length * 6.2;
          const tw = tail.length * 4.2;
          const x0 = cx - (hw + 6.4 + tw) / 2;
          out.push(item(head, x0, ny, hw, g.font));
          out.push(item(" ", x0 + hw, ny, 0.7, 0));
          out.push(item(tail, x0 + hw + 6.4, ny, tw, g.font));
        } else {
          const s = `（${d.note}）`;
          const nw = 28.6;
          out.push(item("", cx - nw / 2, ny, 0, 0));
          out.push(item(s, cx - nw / 2, ny, nw, g.font));
        }
      }
    });
  }
  return out;
}

export function makeBusPage(f: BusFixture, pageNo = 1): PageItems {
  const g: BusGeometry = { ...DEFAULT_BUS_GEOMETRY, ...f.geometry };
  const rows = new Map(f.hours.map((h, i) => [h, i]));
  const items: TextItem[] = [];

  // タイトルと期間（同じベースライン）
  items.push(item("", g.hourX + 80, g.titleY, 0, 0));
  if (f.period) items.push(item(f.period, g.hourX + 80, g.titleY, f.period.length * 11, 13.4));
  items.push(item("", g.hourX - 280, g.titleY, 0, 0));
  items.push(item(f.title, g.hourX - 280, g.titleY, f.title.length * 9, 18.7));

  const leftCols = layoutColumns(f.left, "left", g);
  const rightCols = layoutColumns(f.right, "right", g);
  const sideSpan = (cols: ColumnBox[]): [number, number] => [
    Math.min(...cols.map((c) => c.x0)),
    Math.max(...cols.map((c) => c.x1)),
  ];
  const [l0, l1] = sideSpan(leftCols);
  const [r0, r1] = sideSpan(rightCols);

  // 方向の見出し（1 文字ずつ離して置く）
  const dirLine = (text: string, x0: number, x1: number, y: number) =>
    distributed([...text], x0 + (x1 - x0) * 0.25, x1 - (x1 - x0) * 0.15, y, HEADER_FONT);
  items.push(...dirLine(`${f.left.from}発`, l0, l1, 109.4));
  items.push(...dirLine(`${f.right.from}発`, r0, r1, 109.4));
  items.push(...dirLine(`${f.left.to}行`, l0, l1, 129.4));
  items.push(...dirLine(`${f.right.to}行`, r0, r1, 129.4));

  // 時刻列の見出し
  items.push(item("", g.hourX - 14.1, 132.6, 0, 0));
  items.push(item("時", g.hourX - 14.1, 132.6, HEADER_FONT, HEADER_FONT));
  items.push(item(" ", g.hourX - 3.4, 132.6, 0.7, 0));
  items.push(item("刻", g.hourX + 3.8, 132.6, HEADER_FONT, HEADER_FONT));

  f.left.columns.forEach((c, i) => items.push(...headerItems(c, leftCols[i]!)));
  f.right.columns.forEach((c, i) => items.push(...headerItems(c, rightCols[i]!)));

  // 時
  f.hours.forEach((h, r) => {
    const y = g.firstRowY + r * g.rowPitch;
    const s = String(h);
    const w = s.length * g.font * 0.505;
    items.push(item("", g.hourX - w / 2, y, 0, 0));
    items.push(item(s, g.hourX - w / 2, y, w, g.font));
    items.push(item(" ", g.hourX + w / 2, y, 3.5, 0));
  });

  f.left.columns.forEach((c, i) => items.push(...departureItems(c, leftCols[i]!, g, rows)));
  f.right.columns.forEach((c, i) => items.push(...departureItems(c, rightCols[i]!, g, rows)));

  // 脚注
  const lastRowY = g.firstRowY + (f.hours.length - 1) * g.rowPitch;
  (f.footnotes ?? []).forEach((t, i) => {
    const y = lastRowY + 21.2 + i * 18.6;
    items.push(item("", 100.1, y, 0, 0));
    items.push(item("※", 100.1, y, 8, 8));
    items.push(item("", 111.7, y, 0, 0));
    items.push(item(t, 111.7, y, t.length * 10.7, 10.7));
  });

  // 実物の item 順は読み順と一致しないので、決定的に並べ替えて順序依存を検出できるようにする
  items.sort((a, b) => (a.x * 7 + a.y * 13) % 17 - (b.x * 7 + b.y * 13) % 17);
  return { page: pageNo, width: g.pageWidth, height: g.pageHeight, items };
}

/** テスト用の標準的な合成ダイヤ（架空の時刻） */
export function sampleBusFixture(overrides: Partial<BusFixture> = {}): BusFixture {
  return {
    title: "令 和 ９ 年 度 前 期 バ ス ダ イ ヤ",
    period: "令和9年4月8日（木）～令和9年7月30日（金）",
    hours: [8, 9, 10, 11, 12],
    left: {
      from: "津田沼",
      to: "新習志野",
      columns: [
        {
          header: ["平 日"],
          departures: {
            8: [{ min: 5 }, { min: 45 }],
            9: [{ min: 25, note: "茜40", splitNote: true }],
            11: [{ min: 0 }, { min: 30 }],
            12: [{ min: 15 }],
          },
        },
        {
          header: ["土 曜"],
          departures: { 9: [{ min: 10 }], 12: [{ min: 40, note: "茜55" }] },
        },
        { header: ["日曜日", "祝日", "休日"], departures: { 10: [{ min: 20 }] } },
        { header: ["１２月24日", "（金）"], departures: { 8: [{ min: 50 }], 9: [{ min: 50 }] } },
      ],
    },
    right: {
      from: "新習志野",
      to: "津田沼",
      columns: [
        {
          header: ["平 日"],
          departures: {
            8: [{ min: 20 }],
            10: [{ min: 5 }, { min: 35, note: "茜50" }],
            12: [{ min: 0 }, { min: 55 }],
          },
        },
        { header: ["土 曜"], departures: { 11: [{ min: 15 }] } },
        { header: ["日曜日", "祝日", "休日"], departures: { 11: [{ min: 45 }] } },
        { header: ["１２月24日", "（金）"], departures: { 9: [{ min: 5 }] } },
      ],
    },
    footnotes: ["茜浜経由は、（茜）の時刻に途中の停留所を出発します。", "架空の運休期間の注意書きです。"],
    ...overrides,
  };
}
