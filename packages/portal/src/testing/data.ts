/**
 * 合成サイトの架空データ。
 *
 * 実サイトの文言・学科名・学科表は一切含めない。セレクタが依存する「形」だけを実サイトに合わせ、
 * 中身はすべて架空にしている。次のケースを意図的に含める。
 *
 * - 年度によって学科コードが変わる（模擬情報学科: 2023 年度まで `72`、2024 年度から `Y2`）
 * - 年度によって学科が増える（2026 年度から `W4`）
 * - 大学院の複数専攻が 1 ページを共有する（Q1 / Q2 / Q9 → `graduate/fiction_<年度>.html`）
 * - 同じ PDF の同じページ番号を複数の項目が共有する
 * - 要ログイン注記付きの文書
 */

export const FAKE_YEARS: readonly number[] = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016];

export interface FakeDept {
  /** option の value（学科コード） */
  dept: string;
  /** option の表示文言（「コード：名称」） */
  name: string;
  /** ベース URL からの相対パス */
  path: string;
}

export function undergradDepts(year: number): FakeDept[] {
  const list: FakeDept[] = [
    { dept: "X1", name: "X1：架空工学科", path: `fic/xeng_${year}.html` },
    year <= 2023
      ? { dept: "72", name: "72：模擬情報学科（～2023年度入学）", path: `fic/sim_${year}.html` }
      : { dept: "Y2", name: "Y2：模擬情報学科（2024年度入学～）", path: `fic2/sim_${year}.html` },
    { dept: "Z3", name: "Z3：仮想デザイン学科", path: `fic/vdesign_${year}.html` },
  ];
  if (year >= 2026) {
    list.push({ dept: "W4", name: "W4：試行未来学科", path: `fic2/trial_${year}.html` });
  }
  return list;
}

export function graduateDepts(year: number): FakeDept[] {
  const shared = `graduate/fiction_${year}.html`;
  return [
    { dept: "Q1", name: "Q1：架空工学専攻", path: shared },
    { dept: "Q2", name: "Q2：試作機械専攻", path: shared },
    { dept: "Q9", name: "Q9：架空工学専攻（博士後期課程）", path: shared },
    { dept: "71", name: "71：模擬情報専攻（修士課程）", path: `graduate/sim_${year}.html` },
  ];
}

export interface FakeLink {
  href: string;
  text: string;
}

export interface FakeSection {
  title: string;
  links: FakeLink[];
}

/** 学部の学科ページの節構成（実サイトの節の並び方に似せた架空の見出し） */
export function undergradSections(year: number, deptSlug: string): FakeSection[] {
  const c = `common_${year}`;
  return [
    {
      title: "架空の生活案内",
      links: [
        { href: `${c}/life.pdf#page=1`, text: "架空の年間行事" },
        { href: `${c}/life.pdf#page=3`, text: "架空の学生証" },
        { href: `${c}/life.pdf#page=13`, text: "架空のクラス担任" },
        { href: `${c}/life.pdf#page=13`, text: "架空の通学案内" },
        { href: `${c}/life.pdf#page=20`, text: "架空の奨学制度" },
      ],
    },
    {
      title: "架空の修学案内",
      links: [
        { href: `${c}/study.pdf#page=1`, text: "架空の学籍" },
        { href: `${c}/study.pdf#page=2`, text: "架空の履修要項" },
      ],
    },
    {
      title: "架空の要件と課程表",
      links: [
        { href: `${deptSlug}/${deptSlug}_${year}.pdf#page=1`, text: "架空学部の方針" },
        { href: `${deptSlug}/${deptSlug}_${year}.pdf#page=7`, text: "架空の進級・卒業要件と教育課程表" },
        { href: `${c}/office.pdf`, text: "架空の教員室一覧" },
      ],
    },
    {
      title: "架空の進路案内",
      links: [
        { href: `../whole/shinro/job_${year}.pdf#page=1`, text: "架空の就職委員会" },
        { href: `../whole/shinro/job_${year}.pdf#page=2`, text: "架空のアルバイト案内" },
      ],
    },
    {
      title: "架空の規程集",
      links: [
        { href: `${c}/regulation.pdf#page=1`, text: "架空の学則" },
        { href: `${c}/regulation.pdf#page=12`, text: "架空の履修規程" },
      ],
    },
  ];
}

/** 研究科ページの節構成（学部と節構成が違う） */
export function graduateSections(year: number, school: string, schoolName: string): FakeSection[] {
  const c = `common_${year}`;
  return [
    {
      title: "架空の概要",
      links: [
        { href: `${c}/summary.pdf#page=1`, text: "架空の沿革" },
        { href: `${c}/summary.pdf#page=5`, text: "架空の課程" },
        { href: `${c}/summary.pdf#page=5`, text: "架空の学位" },
      ],
    },
    {
      title: "架空の修学案内",
      links: [
        { href: `${c}/study.pdf#page=1`, text: "架空の学生番号" },
        { href: `${c}/study.pdf#page=10`, text: "架空の修了要件" },
      ],
    },
    {
      title: "架空の手続案内",
      links: [{ href: `${c}/procedure.pdf#page=6`, text: "架空の証明書類" }],
    },
    {
      title: schoolName,
      links: [
        { href: `${school}/${school}_${year}.pdf#page=1`, text: "架空研究科の方針" },
        { href: `${school}/${school}_${year}.pdf#page=4`, text: "架空研究科の教育課程表" },
      ],
    },
  ];
}
