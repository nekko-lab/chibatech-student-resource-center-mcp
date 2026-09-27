/**
 * バスダイヤ（Excel 製の 1 ページ PDF）の表構造を座標付きテキストから復元する。
 *
 * 想定する形:
 * - 中央に「時刻」の列（時）、その左右に方向ブロック（「〇〇発」「〇〇行」の見出し）
 * - 各方向は曜日区分の列（平日 / 土曜 / 日曜日・祝日・休日 / 特定日）に分かれ、セルには「分」だけが並ぶ
 * - 注記付きの分は「（茜XX）」のような注記がすぐ下に置かれる
 *
 * 列の境界は見出し語の x 範囲と内容の空きから決め、固定の座標は使わない。
 */
import {
  type Box,
  type Line,
  type Span,
  columnBoundaries,
  columnOf,
  diffs,
  groupLines,
  groupWords,
  lineText,
  median,
  normalize,
  toBoxes,
} from "./layout.ts";
import type { PageItems } from "./types.ts";

export type DayType = "weekday" | "saturday" | "holiday" | "special";

export interface Departure {
  /** "HH:MM" */
  time: string;
  note?: string;
}

export interface BusSchedule {
  title: string;
  period?: string;
  directions: {
    from: string;
    to: string;
    columns: { dayType: DayType; label: string; departures: Departure[] }[];
  }[];
  /** 表の下の脚注と、読み取れなかった箇所（「読み取れなかった」で始まる） */
  notes: string[];
}

type Direction = BusSchedule["directions"][number];
type Side = "left" | "right";

const HOUR_LABEL = /^(時刻|時間|時)$/;
const HOUR_TOKEN = /^(\d{1,2})時?$/;
const DAY_KEYWORD = /平日|土曜日?|日曜日?|祝祭日|祝日|休日|祭日/g;
const PERIOD = /[～〜~].*(年|月|日)|(年|月|日).*[～〜~]/;
const IGNORABLE = /^[・,、/／\s]*$/;

const unread = (where: string, what: string) => `読み取れなかった（${where}）: ${what}`;

function dayTypeOf(keyword: string): DayType {
  if (keyword.startsWith("平")) return "weekday";
  if (keyword.startsWith("土")) return "saturday";
  return "holiday";
}

interface HeaderPart {
  x0: number;
  x1: number;
  y: number;
  text: string;
  keyword: boolean;
}

interface DayColumn {
  x0: number;
  x1: number;
  side: Side;
  label: string;
  dayType: DayType;
  departures: { time: string; note?: string; cx: number; hour: number }[];
}

/** 1 行を時刻列の中心で左右に分ける（時刻の見出し自身は除く） */
function splitSides(line: Line, centerX: number, exclude: (b: Box) => boolean): Record<Side, Box[]> {
  const out: Record<Side, Box[]> = { left: [], right: [] };
  for (const b of line.boxes) {
    if (exclude(b)) continue;
    out[b.cx < centerX ? "left" : "right"].push(b);
  }
  return out;
}

/** 曜日見出しの 1 行（片側）から、曜日キーワードとそれ以外の文字列片を x 範囲付きで取り出す */
function headerParts(boxes: Box[], y: number): HeaderPart[] {
  const chars: { c: string; x0: number; x1: number; h: number }[] = [];
  for (const b of boxes) {
    const cs = [...b.str];
    const w = (b.x1 - b.x0) / Math.max(1, cs.length);
    cs.forEach((c, i) => {
      if (/\s/.test(c)) return;
      chars.push({ c, x0: b.x0 + w * i, x1: b.x0 + w * (i + 1), h: b.h });
    });
  }
  const s = chars.map((c) => c.c).join("");
  const used = new Array<boolean>(chars.length).fill(false);
  const parts: HeaderPart[] = [];
  for (const m of s.matchAll(DAY_KEYWORD)) {
    const start = [...s.slice(0, m.index)].length;
    const len = [...m[0]].length;
    for (let i = start; i < start + len; i++) used[i] = true;
    parts.push({ x0: chars[start]!.x0, x1: chars[start + len - 1]!.x1, y, text: m[0], keyword: true });
  }
  // キーワード以外の文字は、隙間の小さい連なりごとに 1 片にする（例: 「１２月24日」）
  let run: typeof chars = [];
  const flush = () => {
    const text = run.map((c) => c.c).join("");
    if (run.length && !IGNORABLE.test(text)) {
      parts.push({ x0: run[0]!.x0, x1: run[run.length - 1]!.x1, y, text, keyword: false });
    }
    run = [];
  };
  chars.forEach((c, i) => {
    const prev = run[run.length - 1];
    if (used[i] || (prev && c.x0 - prev.x1 > 1.5 * Math.max(prev.h, c.h))) flush();
    if (!used[i]) run.push(c);
  });
  flush();
  return parts;
}

/** x 範囲の重なる見出し片を 1 列にまとめる（縦に積まれた「日曜日 / 祝日 / 休日」など） */
function clusterColumns(parts: HeaderPart[], side: Side): DayColumn[] {
  const groups: HeaderPart[][] = [];
  for (const p of [...parts].sort((a, b) => a.x0 - b.x0)) {
    const g = groups.find((gr) => gr.some((q) => p.x0 < q.x1 && q.x0 < p.x1));
    if (g) g.push(p);
    else groups.push([p]);
  }
  return groups.map((g) => {
    const ordered = [...g].sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const keywords = [...new Set(ordered.filter((p) => p.keyword).map((p) => p.text))];
    const rest = ordered.filter((p) => !p.keyword).map((p) => p.text);
    return {
      x0: Math.min(...g.map((p) => p.x0)),
      x1: Math.max(...g.map((p) => p.x1)),
      side,
      label: keywords.join("・") + rest.join(""),
      dayType: keywords[0] ? dayTypeOf(keywords[0]) : "special",
      departures: [],
    };
  });
}

function parseDirectionText(text: string): { from: string; to: string } {
  const from = text.match(/^(.+?)発/)?.[1] ?? "";
  const to = text.match(/発[→⇒\-~]*(.+?)行/)?.[1] ?? (from ? "" : (text.match(/^(.+?)行/)?.[1] ?? ""));
  return { from, to };
}

interface Token {
  str: string;
  cx: number;
  y: number;
  h: number;
}

/** 括弧が閉じていない片を、同じ行の右隣の片とつなぐ（「(茜」「50)」→「(茜50)」） */
function mergeParenTokens(boxes: Box[]): Token[] {
  const out: Token[] = [];
  const opens = (s: string) => (s.match(/[（(]/g)?.length ?? 0) - (s.match(/[)）]/g)?.length ?? 0);
  for (const line of groupLines(boxes)) {
    let cur: (Token & { x0: number; x1: number }) | undefined;
    for (const b of line.boxes) {
      if (cur && opens(cur.str) > 0 && b.x0 - cur.x1 < 3 * Math.max(cur.h, b.h)) {
        cur.str += b.str;
        cur.x1 = b.x1;
        cur.cx = (cur.x0 + cur.x1) / 2;
        continue;
      }
      if (cur) out.push(cur);
      cur = { str: b.str, x0: b.x0, x1: b.x1, cx: b.cx, y: b.y, h: b.h };
    }
    if (cur) out.push(cur);
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

interface PageResult {
  title?: string;
  period?: string;
  directions: Direction[];
  notes: string[];
}

function parsePage(page: PageItems): PageResult {
  const p = `p${page.page}`;
  const notes: string[] = [];
  const boxes = toBoxes(page.items);
  const lines = groupLines(boxes);

  // 1. 「時刻」の列見出し
  let hourLabel: Box | undefined;
  for (const l of lines) {
    hourLabel = groupWords(l, 1.0).find((w) => HOUR_LABEL.test(normalize(w.str)));
    if (hourLabel) break;
  }
  if (!hourLabel) {
    return { directions: [], notes: [unread(p, "「時刻」の列見出しが見つからないため表を復元できない")] };
  }
  const hl = hourLabel;
  const hw = hl.x1 - hl.x0;
  const isHourLabelBox = (b: Box) => Math.abs(b.y - hl.y) <= 0.35 * hl.h && b.x0 >= hl.x0 - 0.5 && b.x1 <= hl.x1 + 0.5;

  // 2. 時刻列の数字から表本体の上端を決める（見出し帯と表本体を分ける）
  const approxHours = boxes.filter(
    (b) => HOUR_TOKEN.test(normalize(b.str)) && b.cx >= hl.x0 - hw / 2 && b.cx <= hl.x1 + hw / 2 && b.y > hl.y - hl.h,
  );
  if (approxHours.length === 0) {
    return { directions: [], notes: [unread(p, "時刻列に「時」の数字が見つからない")] };
  }
  const gridH = median(approxHours.map((b) => b.h)) ?? hl.h;
  const firstGridY = Math.min(...approxHours.map((b) => b.y));
  const approxPitch = median(diffs(approxHours.map((b) => b.y).sort((a, b) => a - b))) ?? gridH * 2.5;
  const approxBottom = Math.max(...approxHours.map((b) => b.y)) + 0.75 * approxPitch;
  const headerTop = firstGridY - 0.6 * gridH;

  // 3. 見出し帯: タイトル行・方向見出し行・曜日見出し行
  const headerLines = groupLines(boxes.filter((b) => b.y < headerTop));
  const dirText: Record<Side, string> = { left: "", right: "" };
  const dirLineIdx: number[] = [];
  headerLines.forEach((l, i) => {
    const sides = splitSides(l, hl.cx, isHourLabelBox);
    let isDir = false;
    for (const side of ["left", "right"] as const) {
      const t = normalize(sides[side].map((b) => b.str).join(""));
      if (/(発|行)$/.test(t)) {
        dirText[side] += t;
        isDir = true;
      }
    }
    if (isDir) dirLineIdx.push(i);
  });
  const firstDir = dirLineIdx.length ? Math.min(...dirLineIdx) : 1;
  const lastDir = dirLineIdx.length ? Math.max(...dirLineIdx) : 0;
  if (!dirLineIdx.length) notes.push(unread(p, "「〇〇発」「〇〇行」の見出しが見つからない"));

  // タイトルと期間（方向見出しより上の行）
  let title = "";
  let period: string | undefined;
  for (const l of headerLines.slice(0, firstDir)) {
    for (const b of l.boxes) {
      if (!period && PERIOD.test(b.str)) period = b.str.trim();
      else title += b.str.replace(/\s+/g, "");
    }
  }

  // 曜日区分の列見出し（方向見出しより下の行）
  const parts: Record<Side, HeaderPart[]> = { left: [], right: [] };
  for (const l of headerLines.slice(lastDir + 1)) {
    const sides = splitSides(l, hl.cx, isHourLabelBox);
    for (const side of ["left", "right"] as const) parts[side].push(...headerParts(sides[side], l.y));
  }
  const dayCols = [...clusterColumns(parts.left, "left"), ...clusterColumns(parts.right, "right")];
  if (dayCols.length === 0) {
    return { title, period, directions: [], notes: [...notes, unread(p, "曜日区分の列見出しが見つからない")] };
  }

  // 4. 列の境界（見出しの x 範囲と表本体の空きから）
  const gridBoxes = boxes.filter((b) => b.y >= headerTop && b.y <= approxBottom);
  const headers: (Span & { col?: DayColumn })[] = [
    ...dayCols.map((c) => ({ x0: c.x0, x1: c.x1, col: c })),
    { x0: hl.x0, x1: hl.x1 },
  ].sort((a, b) => a.x0 - b.x0);
  const bounds = columnBoundaries(headers, gridBoxes);
  const hourIdx = headers.findIndex((h) => !h.col);

  // 5. 時の行
  const hourRows: { hour: number; y: number }[] = [];
  for (const b of gridBoxes) {
    if (columnOf(bounds, b.cx) !== hourIdx) continue;
    const m = normalize(b.str).match(HOUR_TOKEN);
    if (m) hourRows.push({ hour: Number(m[1]), y: b.y });
    else notes.push(unread(`${p} 時刻列`, `"${b.str}"`));
  }
  hourRows.sort((a, b) => a.y - b.y);
  const pitch = median(diffs(hourRows.map((r) => r.y))) ?? gridH * 2.5;
  // 見出し帯には食い込ませない（最初の行の上側は見出しとの境まで）
  const top = Math.max(headerTop, (hourRows[0]?.y ?? firstGridY) - 0.75 * pitch);
  const bottom = (hourRows[hourRows.length - 1]?.y ?? firstGridY) + 0.75 * pitch;

  // 6. 分と注記
  const cellBoxes = boxes.filter((b) => b.y >= top && b.y <= bottom && columnOf(bounds, b.cx) !== hourIdx);
  const pendingNotes: { col: DayColumn; hour: number; cx: number; text: string }[] = [];
  const where = (c: DayColumn, hour?: number) =>
    `${p} ${c.side === "left" ? "左" : "右"}「${c.label}」${hour === undefined ? "" : ` ${hour}時台`}`;
  for (const t of mergeParenTokens(cellBoxes)) {
    const col = headers[columnOf(bounds, t.cx)]?.col;
    if (!col) continue;
    let row: { hour: number; y: number } | undefined;
    for (const r of hourRows) if (!row || Math.abs(r.y - t.y) < Math.abs(row.y - t.y)) row = r;
    if (!row || Math.abs(row.y - t.y) > 0.75 * pitch) {
      notes.push(unread(where(col), `"${t.str}"`));
      continue;
    }
    const s = normalize(t.str);
    const withNote = s.match(/^(\d{1,2})\((.+)\)$/);
    const minOnly = s.match(/^(\d{1,2})$/);
    const noteOnly = s.match(/^\((.+)\)$/);
    const min = Number(withNote?.[1] ?? minOnly?.[1] ?? NaN);
    if ((withNote || minOnly) && min <= 59) {
      col.departures.push({
        time: `${pad2(row.hour)}:${pad2(min)}`,
        ...(withNote ? { note: withNote[2] } : {}),
        cx: t.cx,
        hour: row.hour,
      });
    } else if (noteOnly) {
      pendingNotes.push({ col, hour: row.hour, cx: t.cx, text: noteOnly[1]! });
    } else {
      notes.push(unread(where(col, row.hour), `"${t.str}"`));
    }
  }
  // 注記は同じセルの中で x が最も近い（まだ注記の無い）分に付ける
  for (const n of pendingNotes) {
    const target = n.col.departures
      .filter((d) => d.hour === n.hour && d.note === undefined)
      .sort((a, b) => Math.abs(a.cx - n.cx) - Math.abs(b.cx - n.cx))[0];
    if (target) target.note = n.text;
    else notes.push(unread(where(n.col, n.hour), `注記「${n.text}」の対象の分が無い`));
  }

  // 7. 脚注（表本体より下の行）
  const footnotes = groupLines(boxes.filter((b) => b.y > bottom)).map((l) => lineText(l.boxes));

  // 8. 方向ごとにまとめる（列は時刻列に近い順）
  const directions: Direction[] = [];
  for (const side of ["left", "right"] as const) {
    const cols = dayCols
      .filter((c) => c.side === side)
      .sort((a, b) => (side === "left" ? b.x1 - a.x1 : a.x0 - b.x0));
    if (cols.length === 0) continue;
    const { from, to } = parseDirectionText(dirText[side]);
    if (dirLineIdx.length && (!from || !to)) notes.push(unread(`${p} ${side === "left" ? "左" : "右"}`, `方向の見出し「${dirText[side]}」`));
    directions.push({
      from,
      to,
      columns: cols.map((c) => ({
        dayType: c.dayType,
        label: c.label,
        departures: c.departures
          .map((d) => (d.note === undefined ? { time: d.time } : { time: d.time, note: d.note }))
          .sort((a, b) => a.time.localeCompare(b.time)),
      })),
    });
  }
  return { title, period, directions, notes: [...footnotes, ...notes] };
}

/** バスダイヤ PDF の座標付きテキストから時刻表を復元する。読めなかった箇所は notes に残す */
export function parseBusSchedule(pages: readonly PageItems[]): BusSchedule {
  const out: BusSchedule = { title: "", directions: [], notes: [] };
  for (const page of pages) {
    const r = parsePage(page);
    if (!out.title && r.title) out.title = r.title;
    if (!out.period && r.period) out.period = r.period;
    for (const d of r.directions) {
      const same = out.directions.find((e) => e.from === d.from && e.to === d.to);
      if (same) same.columns.push(...d.columns);
      else out.directions.push(d);
    }
    out.notes.push(...r.notes);
  }
  if (out.directions.length === 0 && !out.notes.some((n) => n.startsWith("読み取れなかった"))) {
    out.notes.push(unread("全体", "時刻表が見つからない"));
  }
  if (out.period === undefined) delete out.period;
  return out;
}

const placeKey = (s: string) => normalize(s).replace(/(駅|発|行|バス停)$/g, "");

/** 時刻表から、指定の出発地・曜日区分で `now` 以降の発車を `count` 件（既定 3）返す */
export function nextBuses(
  s: BusSchedule,
  q: { from: string; dayType: DayType; now: string; count?: number },
): Departure[] {
  const m = normalize(q.now).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 29 || Number(m[2]) > 59) {
    throw new RangeError(`now は "HH:MM" 形式で指定する: ${q.now}`);
  }
  const now = `${pad2(Number(m[1]))}:${m[2]}`;
  const key = placeKey(q.from);
  if (!key) return [];
  const deps = s.directions
    .filter((d) => {
      const f = placeKey(d.from);
      return f !== "" && (f.includes(key) || key.includes(f));
    })
    .flatMap((d) => d.columns.filter((c) => c.dayType === q.dayType))
    .flatMap((c) => c.departures)
    .filter((d) => d.time >= now)
    .sort((a, b) => a.time.localeCompare(b.time));
  return deps.slice(0, q.count ?? 3).map((d) => ({ ...d }));
}
