/**
 * 学科長・クラス担任表 PDF と同じ幾何構造を持つ合成 PageItems を作る生成器。
 *
 * 実物の氏名は一切含めない（架空の氏名だけを使う）。再現しているのは「形」だけ:
 * - 見出し行「学部 / 学 科 / 学科長 / １年次〜４年次」が学部ブロックごとに繰り返される
 * - 学部名は 1 文字ずつ縦に積まれ、ブロックの行の中央に来る
 * - 学科名・学科長は行の中央、各年次は複数名が縦に並び、主担任に ◎
 * - 氏名は「姓」「名」が別 item（間に空白 item）。5 文字の氏名は 1 item
 * - 2 ページ目は「研究科 / 専攻 / 課程 / 専攻長」の表。研究科名は横書きで複数行の中央に来る
 */
import type { PageItems, TextItem } from "../../src/types.ts";

export interface FixtureTeacher {
  /** "姓 名" または空白なしの氏名 */
  name: string;
  main?: boolean;
}

export interface FixtureDept {
  name: string;
  head?: string;
  /** 1〜4 年次。欠けた年次は空欄 */
  years: FixtureTeacher[][];
}

export interface FixtureBlock {
  faculty: string;
  departments: FixtureDept[];
}

export interface FixtureMajor {
  name: string;
  courses: string[];
  head: string;
}

export interface FixtureSchool {
  name: string;
  majors: FixtureMajor[];
}

export interface TeacherGeometry {
  pageWidth: number;
  pageHeight: number;
  font: number;
  /** 列の中心 x（学部・学科・学科長・1〜4 年次） */
  facultyX: number;
  deptX: number;
  headX: number;
  yearX: [number, number, number, number];
  firstHeaderY: number;
}

export interface TeacherFixture {
  title: string;
  legend?: string;
  /** ページごとの学部ブロック */
  pages: FixtureBlock[][];
  graduate?: { title: string; date: string; schools: FixtureSchool[] };
  geometry?: Partial<TeacherGeometry>;
}

export const DEFAULT_TEACHER_GEOMETRY: TeacherGeometry = {
  pageWidth: 595.2,
  pageHeight: 841.68,
  font: 6.8,
  facultyX: 81.7,
  deptX: 150.8,
  headX: 236,
  yearX: [294.2, 352.4, 410.6, 468.8],
  firstHeaderY: 57.4,
};

function item(str: string, x: number, y: number, width: number, height: number): TextItem {
  return { str, x, y, width, height };
}

function word(str: string, x: number, y: number, font: number): TextItem[] {
  return [item("", x, y, 0, 0), item(str, x, y, str.length * font, font)];
}

/** 5 文字幅の枠に「姓」「名」を両端揃えで置く（主担任は ◎ の分だけ左に出る） */
function nameItems(t: FixtureTeacher, boxStart: number, y: number, font: number): TextItem[] {
  const cw = font * 1.015;
  const boxEnd = boxStart + 5 * cw;
  const out: TextItem[] = [];
  const parts = t.name.split(/\s+/);
  const prefix = t.main ? "◎" : "";
  const start = t.main ? boxStart - cw : boxStart;
  if (parts.length === 1) {
    out.push(...word(prefix + parts[0]!, start, y, cw));
    return out;
  }
  const [sur, given] = [parts[0]!, parts.slice(1).join("")];
  const s = prefix + sur;
  out.push(...word(s, start, y, cw));
  out.push(item(" ", start + s.length * cw, y, 1.0, 0));
  const gx = boxEnd - given.length * cw;
  out.push(item(given, gx, y, given.length * cw, font));
  out.push(item(" ", boxEnd, y, 2.5, 0));
  return out;
}

function headerRow(g: TeacherGeometry, y: number): TextItem[] {
  const f = g.font;
  const out: TextItem[] = [];
  out.push(...word("学部", g.facultyX - f, y, f));
  out.push(item(" ", g.facultyX + f, y, 7.6, 0));
  out.push(item("学", g.deptX - 10.3, y, f, f));
  out.push(item(" ", g.deptX - 3.5, y, 1.0, 0));
  out.push(item("科", g.deptX + 3.5, y, f, f));
  out.push(item(" ", g.deptX + 10.3, y, 9.4, 0));
  out.push(...word("学科長", g.headX - 1.5 * f, y, f));
  g.yearX.forEach((x, i) => {
    out.push(...word(`${"１２３４"[i]}年次`, x - 1.5 * f, y, f));
    out.push(item(" ", x + 1.5 * f, y, 5.5, 0));
  });
  return out;
}

const NAME_PITCH = 13.4;

function blockItems(block: FixtureBlock, g: TeacherGeometry, headerY: number): { items: TextItem[]; nextY: number } {
  const f = g.font;
  const out: TextItem[] = [...headerRow(g, headerY)];
  const maxNames = Math.max(2, ...block.departments.flatMap((d) => d.years.map((y) => y.length)));
  const pitch = Math.max(26.9, maxNames * NAME_PITCH + 0.5);
  const firstCenter = headerY + 6.2 + pitch / 2;
  const centers = block.departments.map((_, i) => firstCenter + i * pitch);

  block.departments.forEach((d, i) => {
    const c = centers[i]!;
    const dw = d.name.length * f * 1.02;
    out.push(...word(d.name, g.deptX - dw / 2, c, f * 1.02));
    out.push(item(" ", g.deptX + dw / 2, c, 7.4, 0));
    if (d.head) out.push(...nameItems({ name: d.head }, g.headX - 17.4, c, f));
    d.years.forEach((teachers, yi) => {
      const x = g.yearX[yi];
      if (x === undefined) return;
      teachers.forEach((t, k) => {
        const y = c + (k - (teachers.length - 1) / 2) * NAME_PITCH + 0.5;
        out.push(...nameItems(t, x - 21.2, y, f));
      });
    });
  });

  // 学部名は縦書き（1 文字 1 item）でブロックの中央に置く
  const mid = ((centers[0] ?? firstCenter) + (centers[centers.length - 1] ?? firstCenter)) / 2;
  const chars = [...block.faculty];
  const cp = 7.9;
  chars.forEach((ch, k) => {
    const y = mid + (k - (chars.length - 1) / 2) * cp;
    out.push(item("", g.facultyX - 3.8, y, 0, 0));
    out.push(item(ch, g.facultyX - 3.8, y, f, f));
  });

  const last = centers[centers.length - 1] ?? firstCenter;
  return { items: out, nextY: last + 27.5 };
}

function graduatePage(gr: NonNullable<TeacherFixture["graduate"]>, g: TeacherGeometry, pageNo: number): PageItems {
  const f = 10.7;
  const out: TextItem[] = [];
  out.push(...word(gr.title, 168, 48.5, f * 1.6));
  out.push(item(gr.date, 468.2, 69.8, gr.date.length * f * 0.74, f));
  const hy = 91.3;
  out.push(...word("研究科", 81.6, hy, f));
  out.push(item(" ", 113.6, hy, 12.1, 0));
  out.push(...word("専攻", 243.1, hy, f));
  out.push(...word("課程", 357.0, hy, f));
  out.push(...word("専攻長", 461.9, hy, f));

  let y = 121.8;
  const pitch = 35.9;
  for (const school of gr.schools) {
    const ys: number[] = [];
    for (const m of school.majors) {
      ys.push(y);
      out.push(...word(m.name, 180.1, y, f));
      out.push(item(" ", 180.1 + m.name.length * f, y, 4.1, 0));
      m.courses.forEach((c, k) => {
        const cy = y + (k - (m.courses.length - 1) / 2) * 17.9;
        out.push(...word(c, 330.7, cy, f));
      });
      const [sur, given] = m.head.split(/\s+/);
      out.push(...word(sur ?? "", 407.9, y, f));
      out.push(item(" ", 429.2, y, 1.0, 0));
      if (given) out.push(item(given, 461.3 - given.length * f, y, given.length * f, f));
      out.push(item(" ", 461.3, y, 1.0, 0));
      out.push(item("教授", 472.0, y, 2 * f, f));
      y += pitch;
    }
    const mid = ((ys[0] ?? y) + (ys[ys.length - 1] ?? y)) / 2;
    const w = school.name.length * f;
    // 1 行だけの研究科は左寄せ、複数行は中央寄せ（実物の揺れを再現）
    const x = ys.length === 1 ? 18.4 : 97.6 - w / 2;
    out.push(...word(school.name, x, mid, f));
  }
  return { page: pageNo, width: g.pageWidth, height: g.pageHeight, items: out };
}

export function makeTeacherPages(fx: TeacherFixture): PageItems[] {
  const g: TeacherGeometry = { ...DEFAULT_TEACHER_GEOMETRY, ...fx.geometry };
  const pages: PageItems[] = [];
  fx.pages.forEach((blocks, pi) => {
    const items: TextItem[] = [];
    if (pi === 0) {
      items.push(...word(fx.title, 197.9, 25.0, 11.8 * 0.55));
      if (fx.legend) items.push(item(fx.legend, 96.0, 43.9, fx.legend.length * 6.8 * 0.72, 6.8));
    }
    let y = g.firstHeaderY;
    for (const b of blocks) {
      const r = blockItems(b, g, y);
      items.push(...r.items);
      y = r.nextY;
    }
    items.sort((a, b) => (a.x * 3 + a.y * 11) % 19 - (b.x * 3 + b.y * 11) % 19);
    pages.push({ page: pi + 1, width: g.pageWidth, height: g.pageHeight, items });
  });
  if (fx.graduate) pages.push(graduatePage(fx.graduate, g, pages.length + 1));
  return pages;
}

/** テスト用の標準的な合成担任表（架空の氏名） */
export function sampleTeacherFixture(overrides: Partial<TeacherFixture> = {}): TeacherFixture {
  return {
    title: "2099年度 学科長・クラス担任表",
    legend: "◎：主担任（架空学部のみ）",
    pages: [
      [
        {
          faculty: "架空工学部",
          departments: [
            {
              name: "機構工学科",
              head: "甲野 一郎",
              years: [
                [{ name: "乙川 二郎", main: true }, { name: "丙田 三子" }],
                [{ name: "丁原 四季", main: true }, { name: "戊井 五月" }],
                [{ name: "己島 六花", main: true }, { name: "庚山 七海" }],
                [{ name: "辛木 八雲", main: true }, { name: "壬生沢 九" }],
              ],
            },
            {
              name: "宇宙資源工学科",
              head: "癸 十和",
              years: [[{ name: "子安 一葉", main: true }, { name: "丑松 二葉" }], [{ name: "寅井 三葉", main: true }], [], []],
            },
            {
              name: "情報理工学科",
              head: "卯月 四葉",
              years: [
                [{ name: "辰巳 五葉", main: true }, { name: "架空野花子" }],
                [{ name: "午後 六葉" }],
                [{ name: "未明 七葉", main: true }, { name: "申田 八葉" }],
                [{ name: "酉島長太郎", main: true }, { name: "戌井 九葉" }],
              ],
            },
          ],
        },
        {
          faculty: "仮想科学部",
          departments: [
            {
              name: "情報工学科",
              head: "亥野 十葉",
              years: [[{ name: "甲斐 一歩" }], [{ name: "乙女 二歩" }], [{ name: "丙午 三歩" }], [{ name: "丁寧 四歩" }]],
            },
            {
              name: "プロジェクト仮想学科",
              head: "戊辰 五歩",
              years: [[], [], [{ name: "己亥 六歩" }], [{ name: "庚申 七歩" }, { name: "辛酉 八歩" }, { name: "壬戌 九歩" }]],
            },
          ],
        },
      ],
    ],
    graduate: {
      title: "2099年度 大学院専攻長一覧",
      date: "2099年4月1日付",
      schools: [
        {
          name: "架空工学研究科",
          majors: [
            { name: "機構工学専攻", courses: ["修士課程"], head: "甲野 一郎" },
            { name: "宇宙資源工学専攻", courses: ["修士課程"], head: "子安 一葉" },
            { name: "架空工学専攻", courses: ["博士後期課程"], head: "卯月 四葉" },
          ],
        },
        {
          name: "仮想科学研究科",
          majors: [{ name: "仮想科学専攻", courses: ["修士課程", "博士後期課程"], head: "亥野 十" }],
        },
      ],
    },
    ...overrides,
  };
}
