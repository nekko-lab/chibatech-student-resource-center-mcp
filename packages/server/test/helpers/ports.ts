/**
 * マクロの単体テスト用の合成ポート（ブラウザも PDF も使わない）。データはすべて架空。
 */
import type { PageItems } from "@chibatech-src/pdf";
import {
  PortalError,
  type Contact,
  type DepartmentOption,
  type DocumentCategory,
  type DocumentKind,
  type FaqItem,
  type QuickLink,
  type Section,
  type StudentType,
} from "@chibatech-src/portal";
import type { DocPort, Download, ItemsRead, TextRead } from "../../src/docs.ts";
import type { DeptPage, Listing, MacroEnv, PortalPort } from "../../src/macros/ports.ts";
import type { StudentProfile } from "../../src/types.ts";

export const BASE = "https://portal.example.test/portal/";
export const LM = "Wed, 01 Apr 2099 00:00:00 GMT";

const pdfItem = (title: string, path: string, page?: number) => {
  const pdfUrl = `${BASE}${path}`;
  return page === undefined
    ? { title, href: pdfUrl, pdfUrl }
    : { title, href: `${pdfUrl}#page=${page}`, pdfUrl, page };
};

export function undergradSections(year: number): Section[] {
  const c = `fic/common_${year}`;
  return [
    {
      title: "架空の生活案内",
      items: [
        pdfItem("架空の年間行事", `${c}/life.pdf`, 1),
        pdfItem("架空の学生証", `${c}/life.pdf`, 3),
        pdfItem("架空のクラス担任", `${c}/life.pdf`, 13),
        pdfItem("架空の通学案内", `${c}/life.pdf`, 13),
        pdfItem("架空の奨学制度", `${c}/life.pdf`, 20),
      ],
    },
    {
      title: "架空の要件と課程表",
      items: [
        pdfItem("架空学部の方針", `fic/xeng_${year}.pdf`, 1),
        pdfItem("架空の進級・卒業要件と教育課程表", `fic/xeng_${year}.pdf`, 7),
        pdfItem("架空の教員室一覧", `${c}/office.pdf`),
      ],
    },
    {
      title: "架空の外部案内",
      items: [{ title: "架空の学習システム", href: "https://lms.example.com/" }],
    },
  ];
}

export const UNDERGRAD_DEPTS: DepartmentOption[] = [
  { code: "X1", name: "架空機械学科" },
  { code: "Y2", name: "模擬情報学科（2098年度入学～）" },
  { code: "Y3", name: "模擬情報デザイン学科" },
];

export const GRADUATE_DEPTS: DepartmentOption[] = [
  { code: "Q1", name: "架空工学専攻" },
  { code: "Q9", name: "架空工学専攻（博士後期課程）" },
  { code: "71", name: "模擬情報専攻（修士課程）" },
];

export const QUICK_LINKS: QuickLink[] = [
  { title: "時間割・履修の手引き", url: `${BASE}whole/class_guide.html`, kind: "html" },
  { title: "学年暦（架空）", url: `${BASE}whole/gakubu/calendar.pdf`, kind: "pdf" },
  { title: "バスダイヤ", url: `${BASE}whole/gakubu/bus.pdf`, kind: "pdf", updated: "2099.04.01" },
  { title: "学科長・クラス担任表", url: `${BASE}whole/gakubu/advisers.pdf`, kind: "pdf" },
  { title: "食堂メニュー", url: "https://dining.example.com/", kind: "external" },
];

export const MANUALS: DocumentCategory[] = [
  {
    category: "架空の学生生活",
    items: [
      { title: "架空の学びの手引き", url: `${BASE}whole/web_manual/a.pdf`, ext: "pdf", requiresLogin: false, note: "取扱窓口：架空センター" },
      { title: "架空の保険のしおり", url: `${BASE}whole/web_manual/b.pdf`, ext: "pdf", requiresLogin: false },
    ],
  },
  {
    category: "架空のネットワーク",
    items: [
      { title: "架空の VPN 接続", url: "https://drive.example.com/vpn", requiresLogin: true, note: "※学生専用/ログインしてください" },
    ],
  },
];

export const ABSENCE: DocumentCategory[] = [
  {
    category: "学部",
    items: [
      { title: "欠席連絡票", url: `${BASE}whole/gakubu/absence_form.pdf`, ext: "pdf", requiresLogin: false },
      { title: "受診記録票", url: `${BASE}whole/gakubu/medical_record.pdf`, ext: "pdf", requiresLogin: false },
    ],
  },
  {
    category: "大学院",
    items: [
      { title: "欠席連絡票", url: `${BASE}whole/graduate/absence_form.pdf`, ext: "pdf", requiresLogin: false },
      { title: "受診記録票", url: `${BASE}whole/gakubu/medical_record.pdf`, ext: "pdf", requiresLogin: false },
    ],
  },
];

export const FAQ: FaqItem[] = [
  { category: "架空の学生番号について", q: "架空の学生番号の見方がわかりません。", a: "年度・学科・個人番号の順に並びます。" },
  { category: "架空の欠席について", q: "架空の欠席連絡はどこに出しますか。", a: "架空保健室か教務係の窓口に提出してください。" },
];

export const CONTACTS: Contact[] = [
  { group: "部署別連絡先（架空）", name: "架空センター 教務係", campus: "北キャンパス", phone: "000-0000-0001", hours: "平日 9:00～17:00", raw: "架空センター 教務係\n北キャンパス\n架空1号館1階\n000-0000-0001\n担当業務（架空）\n履修・成績" },
  { group: "部署別連絡先（架空）", name: "架空保健室", phone: "000-0000-0003", hours: "平日 9:00～19:00", raw: "架空保健室\n架空1号館1階\n000-0000-0003\n担当業務（架空）\n健康相談" },
  { group: "部署別連絡先（架空）", name: "架空サービス株式会社", raw: "架空サービス株式会社\n架空の推奨機器の問い合わせ先" },
];

export interface FakeDocs extends DocPort {
  /** URL → 各ページの本文 */
  texts: Map<string, string[]>;
  /** URL → 座標付きテキスト */
  layouts: Map<string, PageItems[]>;
  calls: string[];
}

export function fakeDocs(): FakeDocs {
  const texts = new Map<string, string[]>();
  const layouts = new Map<string, PageItems[]>();
  const calls: string[] = [];
  const title = (url: string) => new URL(url).pathname.split("/").pop() ?? url;
  const missing = (url: string) => new PortalError("NOT_FOUND", `合成データに無い URL: ${url}`, { url });
  return {
    texts,
    layouts,
    calls,
    async readText(url, opts): Promise<TextRead> {
      calls.push(`text ${url} ${opts.from ?? 1}-${opts.to ?? ""}`);
      const all = texts.get(url.replace(/#.*$/, ""));
      if (!all) throw missing(url);
      const from = opts.from ?? 1;
      const to = Math.min(opts.to ?? all.length, all.length);
      const max = opts.limits?.maxPages ?? 8;
      const last = Math.min(to, from + max - 1);
      const pages = all.slice(from - 1, last).map((text, i) => ({ page: from + i, text }));
      const r: TextRead = { url, title: title(url), pageCount: all.length, pages, lastModified: LM, truncated: last < to };
      if (last < to) r.next = { from: last + 1, to };
      return r;
    },
    async readItems(url, opts): Promise<ItemsRead> {
      calls.push(`items ${url}`);
      const pages = layouts.get(url);
      if (!pages) throw missing(url);
      return { url, title: title(url), pageCount: pages.length, pages: pages.slice(0, opts.maxPages), lastModified: LM };
    },
    async download(url, opts): Promise<Download> {
      calls.push(`download ${url}`);
      const name = opts?.filename ?? title(url);
      return { url, title: title(url), path: `/tmp/srv_fake_dl/${name}`, bytes: 10, lastModified: LM };
    },
  };
}

export interface FakePortalPort extends PortalPort {
  calls: string[];
}

export function fakePortal(opts: { quickLinks?: QuickLink[] } = {}): FakePortalPort {
  const calls: string[] = [];
  const years = [2099, 2098];
  const listing = <T,>(path: string, t: string, items: T): Listing<T> => ({ url: `${BASE}${path}`, title: t, items, lastModified: null });
  return {
    calls,
    async years(type: StudentType) {
      calls.push(`years ${type}`);
      return years;
    },
    async departments(type: StudentType, year: number) {
      calls.push(`departments ${type} ${year}`);
      if (!years.includes(year)) throw new PortalError("VALIDATION", `入学年度 ${year} は選べません`, { available: years });
      return type === "undergrad" ? UNDERGRAD_DEPTS : GRADUATE_DEPTS;
    },
    async departmentPage(type: StudentType, year: number, code: string): Promise<DeptPage> {
      calls.push(`departmentPage ${type} ${year} ${code}`);
      const d = (type === "undergrad" ? UNDERGRAD_DEPTS : GRADUATE_DEPTS).find((x) => x.code === code);
      if (!d) throw new PortalError("VALIDATION", `コード ${code} は選択肢にありません`, {});
      return {
        url: `${BASE}fic/${code.toLowerCase()}_${year}.html`,
        heading: `${year}年度入学 架空学部 ${d.name}`,
        sections: undergradSections(year),
        lastModified: LM,
      };
    },
    async quickLinks() {
      calls.push("quickLinks");
      return listing("", "架空大学 資料室", opts.quickLinks ?? QUICK_LINKS);
    },
    async documents(kind: DocumentKind) {
      calls.push(`documents ${kind}`);
      if (kind === "manual") return listing("whole/web_manual.html", "申請様式・操作手引き", MANUALS);
      if (kind === "absence") return listing("whole/absence.html", "欠席連絡・受診記録", ABSENCE);
      return listing(`whole/${kind}.html`, kind, []);
    },
    async faq() {
      calls.push("faq");
      return listing("whole/inquiry.html", "よくある質問・窓口", FAQ);
    },
    async contacts() {
      calls.push("contacts");
      return listing("whole/inquiry.html", "よくある質問・窓口", CONTACTS);
    },
  };
}

/** 2099-09-28（月） 08:30 ローカル時刻 */
export const MONDAY = new Date(2099, 8, 28, 8, 30);

export function fakeEnv(profile: StudentProfile = {}, now: Date = MONDAY, o: { quickLinks?: QuickLink[] } = {}) {
  const portal = fakePortal(o);
  const docs = fakeDocs();
  const env: MacroEnv = { portal, docs, now: () => now, profile };
  return { env, portal, docs };
}
