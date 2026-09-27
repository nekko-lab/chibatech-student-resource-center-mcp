import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BASE_URL } from "@chibatech-src/portal";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USER_AGENT, createServer, toolDefinitions, type ServerDeps } from "../src/index.ts";
import { NOTICE } from "../src/respond.ts";
import { launchTestBrowser, type TestBrowser } from "./helpers/browser.ts";
import { fakeFetcher, makePdf, type FakeFetcher } from "./helpers/pdf.ts";

const BASE = DEFAULT_BASE_URL;

const ATOMIC = [
  "portal_open_home",
  "portal_open_quick_link",
  "portal_back",
  "portal_select_student_type",
  "portal_select_year",
  "portal_select_department",
  "portal_submit_search",
  "portal_list_news",
  "portal_list_sections",
  "portal_list_documents",
  "portal_list_faq",
  "portal_list_contacts",
  "portal_snapshot",
  "document_read_text",
  "document_download",
];
const MACROS = [
  "find_department_page",
  "lookup_requirements",
  "lookup_handbook_topic",
  "get_academic_calendar",
  "get_bus_schedule",
  "find_class_teacher",
  "find_manual",
  "get_absence_form",
  "find_contact",
];

type CallResult = { content: { type: string; text: string }[]; isError?: boolean };

interface Harness {
  client: Client;
  tb: TestBrowser;
  fetch: FakeFetcher;
  call: (name: string, args?: Record<string, unknown>) => Promise<{ raw: CallResult; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}

async function connect(extra: Partial<ServerDeps> = {}): Promise<Harness> {
  const tb = await launchTestBrowser();
  const fetch = fakeFetcher({}, (url) => {
    const path = url.slice(BASE.length);
    if (!url.startsWith(BASE)) return undefined;
    if (/\.pdf(\?|$)/.test(url)) {
      return { body: makePdf(Array.from({ length: 24 }, (_, i) => `Fictional ${path} page ${i + 1}`)) };
    }
    if (/\.xlsx$/.test(url)) return { body: new TextEncoder().encode("FAKE XLSX"), contentType: "application/octet-stream" };
    return undefined;
  });
  const server = createServer({
    getBrowser: tb.getBrowser,
    userAgent: USER_AGENT,
    fetcher: fetch.fetcher,
    log: () => undefined,
    now: () => new Date(2026, 8, 28, 8, 30),
    ...extra,
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "srv-test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const raw = (await client.callTool({ name, arguments: args })) as CallResult;
    return { raw, body: JSON.parse(raw.content.at(-1)!.text) as Record<string, unknown> };
  };
  return {
    client,
    tb,
    fetch,
    call,
    close: async () => {
      await client.close();
      await tb.dispose();
    },
  };
}

describe("toolDefinitions", () => {
  it("サーバを起動せずに全ツールの名前と説明を返す", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual([...ATOMIC, ...MACROS]);
    for (const d of defs) {
      expect(d.description).toMatch(/非公式/);
    }
  });
});

describe("MCP サーバ（in-memory transport・合成サイト）", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await connect({ profile: { studentType: "undergrad", admissionYear: 2026 } });
  });
  afterAll(async () => {
    await h.close();
  });

  it("tools/list は toolDefinitions と一致し、ブラウザはまだ起動しない", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => ({ name: t.name, description: t.description }))).toEqual(toolDefinitions());
    expect(h.tb.launches).toBe(0);
    const read = tools.find((t) => t.name === "document_read_text")!;
    expect(read.inputSchema.required).toEqual(["url"]);
  });

  it("最初の応答にだけ非公式の注記が付き、ブラウザは 1 回だけ起動する", async () => {
    const first = await h.call("portal_open_home");
    expect(first.raw.content[0]!.text).toBe(NOTICE);
    expect(first.body.status).toBe("ok");
    expect(first.body.news).toEqual(expect.arrayContaining([{ date: "2026-04-01", text: "架空年度の資料を掲載しました。" }]));
    expect(first.body.sources).toEqual([{ title: "架空大学 資料室", url: BASE, lastModified: null }]);
    const second = await h.call("portal_list_news");
    expect(second.raw.content).toHaveLength(1);
    expect(h.tb.launches).toBe(1);
  });

  it("フォームを 1 段ずつ操作して学科ページの節を読む", async () => {
    await h.call("portal_open_home");
    expect((await h.call("portal_select_student_type", { studentType: "学部生" })).body.studentType).toBe("undergrad");
    const year = await h.call("portal_select_year", { year: 2026 });
    expect((year.body.departments as { code: string }[]).map((d) => d.code)).toEqual(["X1", "Y2", "Z3", "W4"]);
    const dept = await h.call("portal_select_department", { department: "模擬情報" });
    expect(dept.body.department).toEqual({ code: "Y2", name: "模擬情報学科（2024年度入学～）" });
    const submit = await h.call("portal_submit_search");
    expect(submit.body.url).toBe(`${BASE}fic2/sim_2026.html`);
    const sections = await h.call("portal_list_sections");
    expect(sections.body.heading).toMatch(/模擬情報学科/);
    expect((sections.body.sections as unknown[]).length).toBe(5);
    const back = await h.call("portal_back");
    expect(back.body.url).toBe(BASE);
  });

  it("エラーは code と details を読める形で返す", async () => {
    await h.call("portal_open_home");
    await h.call("portal_select_student_type", { studentType: "undergrad" });
    const r = await h.call("portal_select_year", { year: 1999 });
    expect(r.raw.isError).toBe(true);
    expect(r.body.status).toBe("error");
    expect(r.body.error).toMatchObject({ code: "VALIDATION", details: { available: expect.arrayContaining([2026, 2016]) } });
  });

  it("クイックリンク: HTML は遷移し、PDF は URL を返す", async () => {
    await h.call("portal_open_home");
    const html = await h.call("portal_open_quick_link", { name: "申請様式" });
    expect(html.body).toMatchObject({ kind: "html", url: `${BASE}whole/web_manual.html` });
    const pdf = await h.call("portal_open_quick_link", { name: "年間行事" });
    expect(pdf.body).toMatchObject({ kind: "pdf", url: `${BASE}whole/gakubu/calendar.pdf` });
  });

  it("共通ページの一覧・Q&A・お問合せ先・スナップショット", async () => {
    const docs = await h.call("portal_list_documents", { kind: "absence" });
    expect((docs.body.categories as { category: string }[]).map((c) => c.category)).toEqual(["学部", "大学院"]);
    const faq = await h.call("portal_list_faq");
    expect((faq.body.faq as unknown[]).length).toBe(4);
    const contacts = await h.call("portal_list_contacts");
    expect((contacts.body.contacts as { name: string }[]).map((c) => c.name)).toContain("架空保健室");
    const snap = await h.call("portal_snapshot");
    expect(String(snap.body.snapshot)).toContain("架空保健室");
  });

  it("document_read_text はページ範囲と上限を守り、出典にページと Last-Modified を付ける", async () => {
    const url = `${BASE}whole/gakubu/calendar.pdf`;
    h.fetch.files.set(url, { body: makePdf(["Fictional term start", "Fictional exams", "Fictional break"]), lastModified: "Wed, 01 Apr 2026 00:00:00 GMT" });
    const r = await h.call("document_read_text", { url: "whole/gakubu/calendar.pdf#page=2", from: 2, to: 3 });
    expect(r.body.pageCount).toBe(3);
    expect((r.body.pages as { page: number; text: string }[]).map((p) => p.page)).toEqual([2, 3]);
    expect(r.body.sources).toEqual([{ title: "calendar.pdf", url, pages: [2, 3], lastModified: "Wed, 01 Apr 2026 00:00:00 GMT" }]);

    const long = await h.call("document_read_text", { url: `${BASE}fic/common_2026/life.pdf` });
    expect((long.body.pages as unknown[]).length).toBe(8);
    expect(long.body.next).toEqual({ from: 9, to: 24 });
    expect(String(long.body.note)).toMatch(/続き/);

    const outside = await h.call("document_read_text", { url: "https://example.com/x.pdf" });
    expect(outside.body.error).toMatchObject({ code: "VALIDATION" });
  });

  it("マクロは使い捨ての Page で動き、状態を持つ Page を汚さない。プロフィールを既定に使う", async () => {
    await h.call("portal_open_home");
    await h.call("portal_select_student_type", { studentType: "graduate" });
    const r = await h.call("find_department_page", { department: "模擬情報" });
    expect(r.body.status).toBe("ok");
    expect(r.body.department).toEqual({ code: "Y2", name: "模擬情報学科（2024年度入学～）" });
    expect(r.body.url).toBe(`${BASE}fic2/sim_2026.html`);
    expect(r.body.sources).toEqual([{ title: expect.stringMatching(/模擬情報学科/), url: `${BASE}fic2/sim_2026.html`, lastModified: null }]);
    // 状態を持つ Page はホームのまま（大学院生を選んだ状態が残っている）
    const years = await h.call("portal_select_year", { year: 2026 });
    expect((years.body.departments as { code: string }[]).map((d) => d.code)).toContain("Q1");
  });

  it("曖昧な学科は候補を返して聞き返す", async () => {
    const r = await h.call("find_department_page", { studentType: "graduate", department: "架空工学専攻" });
    expect(r.body.status).toBe("needs_clarification");
    expect((r.body.candidates as { code: string }[]).map((c) => c.code).sort()).toEqual(["Q1", "Q9"]);
  });

  it("lookup_handbook_topic は該当項目のページだけを読む", async () => {
    const r = await h.call("lookup_handbook_topic", { topic: "奨学金", department: "X1" });
    expect(r.body.status).toBe("ok");
    expect(r.body.item).toMatchObject({ title: "架空の奨学制度" });
    expect((r.body.pages as { page: number; text: string }[]).map((p) => p.page)).toEqual([20, 21, 22, 23]);
    expect((r.body.pages as { text: string }[])[0]!.text).toContain("page 20");
  });

  it("lookup_requirements は要件の項目の範囲を読む", async () => {
    const r = await h.call("lookup_requirements", { kind: "教育課程", department: "架空工学科" });
    expect(r.body.status).toBe("ok");
    expect(r.body.range).toEqual({ from: 7 });
    expect((r.body.sources as { url: string }[])[1]!.url).toBe(`${BASE}fic/xeng/xeng_2026.pdf`);
  });

  it("表として読めない PDF は推測せず LAYOUT_CHANGED を返す（バスダイヤ）", async () => {
    const r = await h.call("get_bus_schedule", { from: "架空駅" });
    expect(r.raw.isError).toBe(true);
    expect(r.body.error).toMatchObject({ code: "LAYOUT_CHANGED" });
    expect(String(r.body.hint)).toMatch(/推測/);
  });

  it("find_manual・find_contact・get_absence_form は合成サイトの一覧から探す", async () => {
    const m = await h.call("find_manual", { keyword: "VPN" });
    expect(m.body.matches).toEqual([expect.objectContaining({ title: "架空の VPN 接続", requiresLogin: true })]);
    const c = await h.call("find_contact", { query: "健康相談" });
    expect((c.body.contacts as { name: string }[]).map((x) => x.name)).toEqual(["架空保健室"]);
    const a = await h.call("get_absence_form", { form: "欠席" });
    expect(a.body.forms).toEqual([expect.objectContaining({ title: "欠席連絡票", url: `${BASE}whole/gakubu/absence_form.pdf` })]);
  });

  it("同時に呼んでも直列に処理し、どちらも正しく返す", async () => {
    const [a, b] = await Promise.all([h.call("portal_list_faq"), h.call("portal_list_contacts")]);
    expect(a.body.status).toBe("ok");
    expect(b.body.status).toBe("ok");
  });

  it("合成サイトの外へは出ていない", () => {
    const blocked = h.tb.contexts.flatMap((c) => c.fake.blocked);
    expect(blocked.every((u) => !u.startsWith(BASE))).toBe(true);
    expect(h.fetch.requests.every((r) => r.url.startsWith(BASE))).toBe(true);
  });
});

describe("document_download（MCP 経由）", () => {
  it("保存先に保存してパスを返す。未設定なら VALIDATION", async () => {
    const dir = await mkdtemp(join(tmpdir(), "srv_mcp_dl_"));
    const h = await connect({ downloadDir: dir });
    try {
      const r = await h.call("document_download", { url: `${BASE}whole/web_manual/cat_02_02.xlsx` });
      expect(r.body.path).toBe(join(dir, "cat_02_02.xlsx"));
      expect(await readFile(join(dir, "cat_02_02.xlsx"), "utf8")).toBe("FAKE XLSX");
      const g = await h.call("get_absence_form", { studentType: "学部", form: "受診", save: true });
      expect((g.body.forms as { savedTo: string }[])[0]!.savedTo).toBe(join(dir, "medical_record.pdf"));
    } finally {
      await h.close();
      await rm(dir, { recursive: true, force: true });
    }
    const n = await connect();
    try {
      const r = await n.call("document_download", { url: `${BASE}whole/gakubu/absence_form.pdf` });
      expect(r.body.error).toMatchObject({ code: "VALIDATION" });
    } finally {
      await n.close();
    }
  });
});

describe("終了", () => {
  it("クライアントが切断したらブラウザを閉じる", async () => {
    const h = await connect();
    await h.call("portal_open_home");
    const real = h.tb.browser;
    await h.client.close();
    await expect.poll(() => real.isConnected(), { timeout: 5000 }).toBe(false);
    await h.tb.dispose();
  });
});
