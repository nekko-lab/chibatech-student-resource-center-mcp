/**
 * ツールの定義（名前・説明・入力スキーマ・実行）。サーバを起動せずに名前と説明を読めるよう、静的な配列にしている。
 *
 * - アトミックツール（portal_* / document_*）: サーバが持つ 1 枚の Page 上で 1 段ずつ操作する
 * - マクロスキル: 学生の質問を起点に部品を組み合わせる。使い捨ての Page で動かす
 */
import { resolveDepartment, resolveStudentType, resolveYear } from "@chibatech-src/match";
import type { SchoolYear } from "@chibatech-src/parsers";
import {
  DOCUMENT_KINDS,
  PortalError,
  listContacts,
  listDocuments,
  listFaq,
  listNews,
  listSections,
  openHome,
  openQuickLink,
  selectDepartment,
  selectStudentType,
  selectYear,
  snapshot,
  submitSearch,
  type DepartmentOption,
  type DocumentKind,
} from "@chibatech-src/portal";
import type { Page } from "playwright-core";
import { z } from "zod";
import type { DocumentService } from "./docs.ts";
import { findContact, findManual, getAbsenceForm } from "./macros/documents.ts";
import { findDepartmentPage, lookupHandbookTopic, lookupRequirements, type RequirementKind } from "./macros/department.ts";
import type { MacroEnv } from "./macros/ports.ts";
import { findClassTeacher, getAcademicCalendar, getBusSchedule } from "./macros/quicklink.ts";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, searchDocuments } from "./macros/search.ts";
import { clarify, ok, type Outcome, type Source } from "./respond.ts";
import type { DocumentIndex } from "./search/indexer.ts";
import type { Session } from "./session.ts";

export interface ToolContext {
  session: Session;
  docs: DocumentService;
  env: MacroEnv;
  baseUrl: string;
  /** search_documents の索引（プロセスに 1 つ） */
  searchIndex: DocumentIndex;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<Outcome>;
}

function tool<S extends z.ZodRawShape>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  run: (ctx: ToolContext, args: z.infer<z.ZodObject<S>>) => Promise<Outcome>;
}): ToolSpec {
  return spec as unknown as ToolSpec;
}

const MAX_SNAPSHOT_CHARS = 30_000;

async function currentSource(ctx: ToolContext, page: Page): Promise<Source> {
  const url = page.url();
  return { title: (await page.title()).trim() || null, url, lastModified: ctx.session.lastModified(url) };
}

/** 状態を持つ Page がポータルの外（起動直後の about:blank など）にいれば、ホームを開いておく */
async function portalPage(ctx: ToolContext): Promise<Page> {
  const page = await ctx.session.page();
  if (!page.url().startsWith(ctx.baseUrl)) await openHome(page, { baseUrl: ctx.baseUrl });
  return page;
}

// ---- 入力スキーマの部品 ----

const studentTypeArg = z
  .string()
  .optional()
  .describe("区分。undergrad（学部生）/ graduate（大学院生）。「学部」「院生」「M1」などの日本語も可。省略時はプロフィール");
const yearArg = z
  .union([z.number().int(), z.string()])
  .optional()
  .describe("入学年度。2024 / R6 / 令和6年 / 去年 なども可。省略時はプロフィール");
const departmentArg = z.string().optional().describe("学科・専攻のコード（例: G1）か名称（略称も可）。省略時はプロフィール");

const deptArgs = { studentType: studentTypeArg, year: yearArg, department: departmentArg };

const pick = (a: { studentType?: string | undefined; year?: number | string | undefined; department?: string | undefined }) => ({
  studentType: a.studentType,
  year: a.year,
  department: a.department,
});

// ---- アトミックツール ----

const atomic: ToolSpec[] = [
  tool({
    name: "portal_open_home",
    description: "（非公式）学生資料室のホームを開き、NEWS とクイックリンクの一覧を返す。フォーム操作（portal_select_*）の起点。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await ctx.session.page();
      const r = await openHome(page, { baseUrl: ctx.baseUrl });
      return ok({ url: r.url, news: r.news, quickLinks: r.quickLinks }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_open_quick_link",
    description:
      "（非公式）クイックリンクを名前で開く（部分一致）。HTML のページだけ遷移し、PDF・学外サイトは URL を返す（PDF は document_read_text で読める）。",
    inputSchema: { name: z.string().describe("クイックリンクの名前（例: 学年暦、バスダイヤ）") },
    run: async (ctx, a) => {
      const page = await portalPage(ctx);
      const r = await openQuickLink(page, a.name);
      if (r.kind === "html") return ok({ url: r.url, kind: r.kind }, [await currentSource(ctx, page)]);
      const note = r.kind === "pdf" ? "PDF は開いていません。本文は document_read_text で読めます" : "学外のサイトのため開いていません";
      return ok({ url: r.url, kind: r.kind, note }, [{ title: a.name, url: r.url, lastModified: null }]);
    },
  }),
  tool({
    name: "portal_back",
    description: "（非公式）状態を持つページで 1 つ前のページに戻る。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await ctx.session.page();
      const res = await page.goBack({ waitUntil: "load" });
      if (res === null) throw new PortalError("NAVIGATION", "戻れる履歴がありません", { url: page.url() });
      return ok({ url: page.url(), title: (await page.title()).trim() }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_select_student_type",
    description: "（非公式）ホームの検索フォームで区分（学部生 / 大学院生）を選ぶ。入学年度・学科の選択はリセットされる。",
    inputSchema: { studentType: z.string().describe("undergrad / graduate（「学部生」「大学院生」なども可）") },
    run: async (ctx, a) => {
      const t = resolveStudentType(a.studentType);
      if (!t) throw new PortalError("VALIDATION", `区分を読み取れません: ${a.studentType}`, { available: ["undergrad", "graduate"] });
      const page = await portalPage(ctx);
      await selectStudentType(page, t);
      return ok({ studentType: t }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_select_year",
    description: "（非公式）ホームの検索フォームで入学年度を選び、選べる学科・専攻（コードと名称）を返す。先に区分を選ぶ。",
    inputSchema: { year: z.union([z.number().int(), z.string()]).describe("入学年度（2024 / R6 / 去年 なども可）") },
    run: async (ctx, a) => {
      const year = typeof a.year === "number" ? a.year : resolveYear(a.year, ctx.env.now());
      if (year === undefined) throw new PortalError("VALIDATION", `入学年度を読み取れません: ${String(a.year)}`, { year: a.year });
      const page = await portalPage(ctx);
      const departments = await selectYear(page, year);
      return ok({ year, departments }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_select_department",
    description:
      "（非公式）ホームの検索フォームで学科・専攻を選ぶ。コードか名称（略称も可）で指定し、曖昧なら候補を返す。先に入学年度を選ぶ。",
    inputSchema: { department: z.string().describe("学科・専攻のコードか名称") },
    run: async (ctx, a) => {
      const page = await portalPage(ctx);
      try {
        await selectDepartment(page, a.department.trim());
        return ok({ department: { code: a.department.trim() } }, [await currentSource(ctx, page)]);
      } catch (e) {
        const available = e instanceof PortalError && e.code === "VALIDATION" ? (e.details as { available?: DepartmentOption[] })?.available : undefined;
        if (!available || available.length === 0) throw e;
        const r = resolveDepartment(a.department, available);
        if (r.best) {
          await selectDepartment(page, r.best.code);
          return ok({ department: { code: r.best.code, name: r.best.name } }, [await currentSource(ctx, page)]);
        }
        if (r.ambiguous) {
          return clarify(
            `「${a.department}」に当たる学科・専攻が複数あります。どれですか`,
            r.candidates.map((c) => ({ code: c.item.code, name: c.item.name })),
            [await currentSource(ctx, page)],
          );
        }
        throw e;
      }
    },
  }),
  tool({
    name: "portal_submit_search",
    description: "（非公式）ホームの検索フォームを送信し、学科・研究科ページへ移る。続けて portal_list_sections で節を読む。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await portalPage(ctx);
      const r = await submitSearch(page);
      return ok({ url: r.url, title: r.title }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_list_news",
    description: "（非公式）ホームの NEWS（お知らせ）を日付つきで返す。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await portalPage(ctx);
      const news = await listNews(page).catch(async (e: unknown) => {
        if (e instanceof PortalError && e.code === "NAVIGATION") return (await openHome(page, { baseUrl: ctx.baseUrl })).news;
        throw e;
      });
      return ok({ news }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_list_sections",
    description: "（非公式）いま開いている学科・研究科ページの節と項目（URL・PDF・ページ番号）を返す。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await ctx.session.page();
      const r = await listSections(page);
      return ok({ url: page.url(), heading: r.heading, sections: r.sections }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_list_documents",
    description:
      "（非公式）共通ページの文書一覧を返す。kind: manual（各種申請書・マニュアル）/ absence（欠席届）/ class_guide（授業時間表）/ handbook（学生便覧）/ links（外部サイト）。",
    inputSchema: { kind: z.enum(DOCUMENT_KINDS as [DocumentKind, ...DocumentKind[]]).describe("文書の種類") },
    run: async (ctx, a) => {
      const page = await ctx.session.page();
      const categories = await listDocuments(page, a.kind, { baseUrl: ctx.baseUrl });
      return ok({ kind: a.kind, categories }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_list_faq",
    description: "（非公式）Q&A（分類・質問・回答）を返す。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await ctx.session.page();
      const faq = await listFaq(page, { baseUrl: ctx.baseUrl });
      return ok({ faq }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_list_contacts",
    description: "（非公式）お問合せ先（分類・名称・キャンパス・電話・取扱時間）を返す。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await ctx.session.page();
      const contacts = await listContacts(page, { baseUrl: ctx.baseUrl });
      return ok({ contacts }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "portal_snapshot",
    description: "（非公式）いま開いているページの ARIA スナップショット（構造の確認用）を返す。長いときは切り詰める。",
    inputSchema: {},
    run: async (ctx) => {
      const page = await ctx.session.page();
      const s = await snapshot(page);
      const truncated = s.length > MAX_SNAPSHOT_CHARS;
      return ok({ url: page.url(), snapshot: truncated ? s.slice(0, MAX_SNAPSHOT_CHARS) : s, truncated }, [await currentSource(ctx, page)]);
    },
  }),
  tool({
    name: "document_read_text",
    description:
      "（非公式）学生資料室の PDF の本文を、指定したページ範囲だけ返す。1 回に返すページ数・文字数には上限があり、超えたら next に続きの指定（from / to / charOffset）を返す。",
    inputSchema: {
      url: z.string().describe("PDF の URL（ポータルからの相対パスも可。#page=N は無視する）"),
      from: z.number().int().min(1).optional().describe("最初のページ（1 始まり。既定 1）"),
      to: z.number().int().min(1).optional().describe("最後のページ（既定は最終ページ。上限で切ることがある）"),
      charOffset: z.number().int().min(0).optional().describe("最初のページの何文字目から返すか（next の続きを読むとき）"),
    },
    run: async (ctx, a) => {
      const r = await ctx.docs.readText(a.url, {
        ...(a.from !== undefined ? { from: a.from } : {}),
        ...(a.to !== undefined ? { to: a.to } : {}),
        ...(a.charOffset !== undefined ? { charOffset: a.charOffset } : {}),
      });
      const data: Record<string, unknown> = { url: r.url, pageCount: r.pageCount, pages: r.pages };
      if (r.next) {
        data.next = r.next;
        data.note = "上限で切りました。続きは document_read_text に同じ url と next の値を渡してください";
      }
      return ok(data, [{ title: r.title, url: r.url, pages: r.pages.map((p) => p.page), lastModified: r.lastModified }]);
    },
  }),
  tool({
    name: "document_download",
    description: "（非公式）学生資料室の文書（PDF・様式など）を保存先（CSRC_DOWNLOAD_DIR）に保存し、保存したパスを返す。",
    inputSchema: {
      url: z.string().describe("文書の URL（ポータルからの相対パスも可）"),
      filename: z.string().optional().describe("保存するファイル名（省略時は URL の末尾。ディレクトリは指定できない）"),
    },
    run: async (ctx, a) => {
      const d = await ctx.docs.download(a.url, a.filename !== undefined ? { filename: a.filename } : {});
      return ok({ url: d.url, path: d.path, bytes: d.bytes }, [{ title: d.title, url: d.url, lastModified: d.lastModified }]);
    },
  }),
];

// ---- マクロスキル ----

const macros: ToolSpec[] = [
  tool({
    name: "find_department_page",
    description:
      "（非公式）区分・入学年度・学科から学科（研究科）ページを探し、節と項目の一覧を返す。学科や年度が曖昧なら候補を返して聞き返す。",
    inputSchema: deptArgs,
    run: (ctx, a) => findDepartmentPage(ctx.env, pick(a)),
  }),
  tool({
    name: "lookup_requirements",
    description:
      "（非公式）進級・卒業（修了）要件または教育課程表を、学科ページの該当項目から必要なページだけ読んで返す。",
    inputSchema: {
      kind: z.enum(["進級", "卒業", "教育課程"]).describe("知りたい要件の種類"),
      ...deptArgs,
    },
    run: (ctx, a) => lookupRequirements(ctx.env, { ...pick(a), kind: a.kind as RequirementKind }),
  }),
  tool({
    name: "lookup_handbook_topic",
    description: "（非公式）学生便覧などの話題（例: 奨学金、学生証）を学科ページの項目から探し、該当するページの本文だけを返す。",
    inputSchema: { topic: z.string().describe("話題（例: 奨学金）"), ...deptArgs },
    run: (ctx, a) => lookupHandbookTopic(ctx.env, { ...pick(a), topic: a.topic }),
  }),
  tool({
    name: "get_academic_calendar",
    description: "（非公式）クイックリンクの学年暦を読み、知りたいこと（任意）に関係するページの本文を返す。",
    inputSchema: { query: z.string().optional().describe("知りたいこと（例: 試験期間、夏季休業）") },
    run: (ctx, a) => getAcademicCalendar(ctx.env, { query: a.query }),
  }),
  tool({
    name: "get_bus_schedule",
    description:
      "（非公式）バスダイヤから、出発地・曜日区分・時刻に合う次の便を返す。曜日区分を省略すると日付から平日・土曜・日曜を決める（祝日は判定しないので、祝日なら holiday を指定する）。",
    inputSchema: {
      from: z.string().optional().describe("出発地（例: 駅名、キャンパス名。部分一致）"),
      dayType: z.enum(["weekday", "saturday", "holiday", "special"]).optional().describe("曜日区分（省略時は日付から決める）"),
      time: z.string().optional().describe("この時刻以降の便（HH:MM。省略時は現在時刻）"),
      count: z.number().int().min(1).max(20).optional().describe("返す件数（既定 3）"),
    },
    run: (ctx, a) => getBusSchedule(ctx.env, { from: a.from, dayType: a.dayType, time: a.time, count: a.count }),
  }),
  tool({
    name: "find_class_teacher",
    description: "（非公式）学科長・クラス担任表から、指定した学科（と年次）に当たる行だけを返す。",
    inputSchema: {
      department: departmentArg,
      year: z.number().int().min(1).max(4).optional().describe("年次（1〜4）"),
    },
    run: (ctx, a) =>
      findClassTeacher(ctx.env, { department: a.department, year: a.year as SchoolYear | undefined }),
  }),
  tool({
    name: "find_manual",
    description: "（非公式）各種申請書・マニュアルの一覧からキーワードに当たる文書を探し、URL と要ログインかを返す。",
    inputSchema: { keyword: z.string().describe("キーワード（例: 保険、VPN）") },
    run: (ctx, a) => findManual(ctx.env, { keyword: a.keyword }),
  }),
  tool({
    name: "get_absence_form",
    description: "（非公式）欠席届・受診証明書などの様式の URL を返す。save を true にすると保存先に保存してパスを返す。",
    inputSchema: {
      studentType: studentTypeArg,
      form: z.string().optional().describe("様式の名前（例: 欠席届、受診証明書）。省略時は区分の様式をすべて"),
      save: z.boolean().optional().describe("保存するか（既定 false）"),
    },
    run: (ctx, a) => getAbsenceForm(ctx.env, { studentType: a.studentType, form: a.form, save: a.save }),
  }),
  tool({
    name: "find_contact",
    description: "（非公式）用件から Q&A とお問合せ先を探し、部署・場所・電話・受付時間を返す。",
    inputSchema: { query: z.string().describe("用件（例: 欠席、成績、Wi-Fi）") },
    run: (ctx, a) => findContact(ctx.env, { query: a.query }),
  }),
  tool({
    name: "search_documents",
    description:
      "（非公式）学生資料室の PDF の本文を横断して全文検索し、当たったページの資料名・URL・ページ番号・短い抜粋を返す。" +
      "学科ページの項目名や申請書・マニュアルの名前に出てこない語（例: GPA、再履修、学割、追試）を調べるときや、" +
      "lookup_handbook_topic・find_manual などで見つからなかったときに使う。" +
      "対象は学科（研究科）ページの PDF・クイックリンクの PDF（学年暦など）・各種申請書・マニュアルの PDF。" +
      "空白で区切った語はすべて含むページを探し、同義語も探す。本文の続きは document_read_text で読む。" +
      "初回は索引の作成に時間がかかる。status が partial なら、同じ引数でもう一度呼ぶと続きから索引を作る。",
    inputSchema: {
      query: z.string().describe("探す語（空白区切りで複数語。例: GPA、再履修 追試）"),
      ...deptArgs,
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH_LIMIT)
        .optional()
        .describe(`返すページ数（既定 ${DEFAULT_SEARCH_LIMIT}、上限 ${MAX_SEARCH_LIMIT}）`),
    },
    run: (ctx, a) => searchDocuments(ctx.env, ctx.searchIndex, { ...pick(a), query: a.query, limit: a.limit }),
  }),
];

export const TOOLS: readonly ToolSpec[] = [...atomic, ...macros];
