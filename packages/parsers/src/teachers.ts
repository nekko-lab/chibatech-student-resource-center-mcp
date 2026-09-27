/**
 * 学科長・クラス担任表 PDF の表構造を座標付きテキストから復元する。
 *
 * 想定する形:
 * - 見出し行「学部 / 学科 / 学科長 / １年次〜４年次」（学部ブロックごとに繰り返されることがある）
 * - 学部名は縦書き（1 文字ずつ縦に積む）か横書きで、受け持つ行の中央に置かれる
 * - 1 学科が複数行（複数名）にまたがり、学科名はその中央に置かれる。主担任には ◎
 * - 大学院の「研究科 / 専攻 / 課程 / 専攻長」の表も同じ枠組みで読む（years は空）
 *
 * 列の境界は見出し語の x 範囲と内容の空きから決め、固定の座標は使わない。
 */
import {
  type Box,
  type Line,
  columnBoundaries,
  columnOf,
  groupLines,
  groupWords,
  lineText,
  normalize,
  toBoxes,
} from "./layout.ts";
import type { PageItems } from "./types.ts";

export type SchoolYear = 1 | 2 | 3 | 4;

export interface Teacher {
  /** 姓と名の間は半角空白 1 つ（元が詰めて書かれていればそのまま） */
  name: string;
  main: boolean;
}

export interface TeacherTable {
  title: string;
  legend?: string;
  rows: {
    faculty?: string;
    department: string;
    head?: string;
    years: { year: SchoolYear; teachers: Teacher[] }[];
  }[];
  /** 読み取れなかった箇所（指定の形への追加。省略可能なので指定の形と互換） */
  notes?: string[];
}

type Row = TeacherTable["rows"][number];

type ColumnKind = { kind: "faculty" } | { kind: "department" } | { kind: "head" } | { kind: "year"; year: SchoolYear } | { kind: "other" };

const TITLE_SUFFIX = /^(教授|准教授|講師|助教|特任教授|客員教授|名誉教授|特別教授)$/;
const MAIN_MARK = "◎";

function classifyHeader(word: string): ColumnKind {
  const w = normalize(word);
  if (/^(学部|研究科|学群)$/.test(w)) return { kind: "faculty" };
  if (/^(学科|専攻|学科名|専攻名)$/.test(w)) return { kind: "department" };
  if (/^(学科長|専攻長)$/.test(w)) return { kind: "head" };
  const y = w.match(/^([1-4])年(次|生)?$/);
  if (y) return { kind: "year", year: Number(y[1]) as SchoolYear };
  return { kind: "other" };
}

interface HeaderRow {
  y: number;
  h: number;
  columns: (Box & { col: ColumnKind })[];
}

function findHeaderRow(line: Line): HeaderRow | undefined {
  const words = groupWords(line, 1.5).map((w) => ({ ...w, col: classifyHeader(w.str) }));
  const kinds = new Set(words.map((w) => w.col.kind));
  if (!kinds.has("department") || !(kinds.has("head") || kinds.has("year"))) return undefined;
  return { y: line.y, h: line.h, columns: words };
}

interface Label {
  text: string;
  y0: number;
  y1: number;
  center: number;
}

/**
 * 1 つの列の中の Box を、縦の隙間が文字高さの `gapRatio` 倍以下のものどうし 1 つのラベルにする。
 * 縦書き（1 文字ずつ）と、折り返した横書きの両方をまとめられる。
 */
function verticalLabels(boxes: Box[], gapRatio: number): Label[] {
  const lines = groupLines(boxes);
  const out: (Label & { h: number })[] = [];
  for (const l of lines) {
    const text = lineText(l.boxes).replace(/\s+/g, "");
    const last = out[out.length - 1];
    if (last && l.y - last.y1 <= gapRatio * Math.max(l.h, last.h)) {
      last.text += text;
      last.y1 = l.y;
      last.center = (last.y0 + last.y1) / 2;
    } else {
      out.push({ text, y0: l.y, y1: l.y, center: l.y, h: l.h });
    }
  }
  return out;
}

/** 行（学科）の並びに対し、各ラベル（学部）が受け持つ連続区間を、ラベルが区間の中央に来るように割り当てる */
function assignSpanning(rowCenters: number[], labels: Label[]): (string | undefined)[] {
  const out: (string | undefined)[] = rowCenters.map(() => undefined);
  const ls = [...labels].sort((a, b) => a.center - b.center);
  let idx = 0;
  ls.forEach((l, i) => {
    if (idx >= rowCenters.length) return;
    const remainingLabels = ls.length - 1 - i;
    let last = idx;
    if (remainingLabels === 0) {
      last = rowCenters.length - 1;
    } else {
      let best = Infinity;
      for (let j = idx; j <= rowCenters.length - 1 - remainingLabels; j++) {
        const d = Math.abs((rowCenters[idx]! + rowCenters[j]!) / 2 - l.center);
        if (d < best) {
          best = d;
          last = j;
        }
      }
    }
    for (let k = idx; k <= last; k++) out[k] = l.text;
    idx = last + 1;
  });
  return out;
}

/** セルの Box を氏名の並びにする。1 行 1 名、◎ が主担任、姓と名は空白 1 つでつなぐ。職名は落とす */
function namesInCell(boxes: Box[]): Teacher[] {
  const out: Teacher[] = [];
  for (const line of groupLines(boxes)) {
    let cur: { parts: string[]; main: boolean } | undefined;
    const push = () => {
      if (cur && cur.parts.length) out.push({ name: cur.parts.join(" "), main: cur.main });
      cur = undefined;
    };
    for (const b of line.boxes) {
      let s = b.str.trim().replace(/\s+/g, " ");
      if (TITLE_SUFFIX.test(s)) continue;
      if (s.startsWith(MAIN_MARK)) {
        push();
        cur = { parts: [], main: true };
        s = s.slice(MAIN_MARK.length).trim();
      }
      cur ??= { parts: [], main: false };
      if (s) cur.parts.push(s);
    }
    push();
  }
  return out;
}

interface PageResult {
  title?: string;
  legend?: string;
  rows: Row[];
  notes: string[];
}

const unread = (where: string, what: string) => `読み取れなかった（${where}）: ${what}`;

function parsePage(page: PageItems): PageResult {
  const p = `p${page.page}`;
  const boxes = toBoxes(page.items);
  const lines = groupLines(boxes);
  const headerRows = lines.map(findHeaderRow).filter((h): h is HeaderRow => h !== undefined);
  if (headerRows.length === 0) {
    return { rows: [], notes: [unread(p, "「学科」「学科長」「〇年次」の見出し行が見つからない")] };
  }

  // 見出し行より上: 見出し（タイトル）と凡例
  let title: string | undefined;
  let legend: string | undefined;
  for (const l of lines.filter((l) => l.y < headerRows[0]!.y - 0.5 * headerRows[0]!.h)) {
    const text = lineText(l.boxes, 0.8);
    if (!legend && (text.startsWith(MAIN_MARK) || text.includes("主担任"))) legend = text;
    else if (!title) title = text;
  }

  const rows: Row[] = [];
  const notes: string[] = [];
  headerRows.forEach((hr, bi) => {
    const next = headerRows[bi + 1];
    const yTop = hr.y + 0.5 * hr.h;
    const yBottom = next ? next.y - 0.5 * next.h : Infinity;
    const content = boxes.filter((b) => b.y > yTop && b.y < yBottom);
    const cols = [...hr.columns].sort((a, b) => a.x0 - b.x0);
    const bounds = columnBoundaries(cols, content);
    const byCol = cols.map(() => [] as Box[]);
    for (const b of content) byCol[columnOf(bounds, b.cx)]!.push(b);

    const where = `${p} 見出し行${bi + 1}`;
    const deptIdx = cols.findIndex((c) => c.col.kind === "department");
    const depts = verticalLabels(byCol[deptIdx] ?? [], 1.5);
    if (depts.length === 0) {
      if (content.length) notes.push(unread(where, "学科名の列が空のため、この区画の内容を行に割り当てられない"));
      return;
    }
    const centers = depts.map((d) => d.center);
    const facultyIdx = cols.findIndex((c) => c.col.kind === "faculty");
    const faculties = facultyIdx >= 0 ? assignSpanning(centers, verticalLabels(byCol[facultyIdx] ?? [], 1.8)) : [];

    const nearest = (y: number) => {
      let best = 0;
      centers.forEach((c, i) => {
        if (Math.abs(c - y) < Math.abs(centers[best]! - y)) best = i;
      });
      return best;
    };
    const cellsOf = (idx: number) => {
      const cells = depts.map(() => [] as Box[]);
      for (const b of byCol[idx] ?? []) cells[nearest(b.y)]!.push(b);
      return cells;
    };

    const headIdx = cols.findIndex((c) => c.col.kind === "head");
    const headCells = headIdx >= 0 ? cellsOf(headIdx) : [];
    const yearCols = cols
      .map((c, i) => ({ c, i }))
      .filter((x): x is { c: (typeof cols)[number] & { col: { kind: "year"; year: SchoolYear } }; i: number } => x.c.col.kind === "year")
      .sort((a, b) => a.c.col.year - b.c.col.year);
    const yearCells = yearCols.map((y) => ({ year: y.c.col.year, cells: cellsOf(y.i) }));

    depts.forEach((d, di) => {
      const heads = namesInCell(headCells[di] ?? []);
      const faculty = faculties[di];
      if (facultyIdx >= 0 && !faculty) notes.push(unread(where, `「${d.text}」の学部`));
      rows.push({
        ...(faculty ? { faculty } : {}),
        department: d.text,
        ...(heads.length ? { head: heads.map((h) => h.name).join("、") } : {}),
        years: yearCells.map((y) => ({ year: y.year, teachers: namesInCell(y.cells[di] ?? []) })),
      });
    });
  });
  return { ...(title ? { title } : {}), ...(legend ? { legend } : {}), rows, notes };
}

/** 担任表 PDF の座標付きテキストから表を復元する。読めなかった箇所は notes に残す */
export function parseClassTeachers(pages: readonly PageItems[]): TeacherTable {
  const out: TeacherTable = { title: "", rows: [], notes: [] };
  for (const page of pages) {
    const r = parsePage(page);
    if (!out.title && r.title) out.title = r.title;
    if (out.legend === undefined && r.legend) out.legend = r.legend;
    out.rows.push(...r.rows);
    out.notes!.push(...r.notes);
  }
  return out;
}

/**
 * 学科（専攻）名で行を探す。完全一致があればそれだけ、なければ部分一致。
 * 照合は NFKC・空白除去の後で行う。`year` を指定すると、その年次だけに絞り、その年次の列を持たない行は除く。
 */
export function findTeachers(t: TeacherTable, q: { department: string; year?: SchoolYear }): TeacherTable["rows"] {
  const key = normalize(q.department);
  if (!key) return [];
  const exact = t.rows.filter((r) => normalize(r.department) === key);
  const hits = exact.length ? exact : t.rows.filter((r) => normalize(r.department).includes(key));
  if (q.year === undefined) return hits.map((r) => copyRow(r, r.years));
  return hits.flatMap((r) => {
    const y = r.years.filter((e) => e.year === q.year);
    return y.length ? [copyRow(r, y)] : [];
  });
}

function copyRow(r: Row, years: Row["years"]): Row {
  return { ...r, years: years.map((y) => ({ year: y.year, teachers: y.teachers.map((t) => ({ ...t })) })) };
}
