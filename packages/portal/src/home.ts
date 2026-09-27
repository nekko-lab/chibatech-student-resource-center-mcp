import type { Dialog, Page, Request, Response } from "playwright-core";
import { DEFAULT_TIMEOUT_MS } from "./constants.ts";
import { PortalError, layoutChanged, requireSelector } from "./errors.ts";
import { gotoChecked, requirePage, resolveBaseUrl } from "./navigation.ts";
import { TOP_NAV_LINKS, readQuickLinks, type QuickLink } from "./quicklinks.ts";
import { normalizeSpace, toIsoDate } from "./text.ts";

export type StudentType = "undergrad" | "graduate";

export interface NewsItem {
  /** `YYYY-MM-DD`（サイトの表記が日付として読めない場合はそのまま） */
  date: string;
  text: string;
}

export interface DepartmentOption {
  code: string;
  name: string;
}

const HOME = "body#home";
const NEWS = "section.news dl";
const YEAR = "#slt_year";
const DEPT = "#slt_dept";
const SUBMIT = "#btn_submit";
const RADIO: Record<StudentType, string> = { undergrad: "#rdo_gakubu", graduate: "#rdo_graduate" };

const requireHome = (page: Page): Promise<void> => requirePage(page, HOME, "ホーム");

/** ホームを開き、NEWS とクイックリンクを返す */
export async function openHome(
  page: Page,
  opts: { baseUrl?: string } = {},
): Promise<{ url: string; news: NewsItem[]; quickLinks: QuickLink[] }> {
  const base = resolveBaseUrl(opts.baseUrl);
  await gotoChecked(page, base);
  await requireSelector(page, HOME);
  const news = await listNews(page);
  const quickLinks = await readQuickLinks(page, [TOP_NAV_LINKS]);
  return { url: page.url(), news, quickLinks };
}

/** 開いているホームから NEWS（日付＋本文）を読む */
export async function listNews(page: Page): Promise<NewsItem[]> {
  await requireHome(page);
  await requireSelector(page, NEWS);
  const pairs = await page.locator(NEWS).first().evaluate((dl) => {
    const out: { date: string; text: string }[] = [];
    let date: string | null = null;
    for (const el of Array.from(dl.children)) {
      if (el.tagName === "DT") date = el.textContent ?? "";
      else if (el.tagName === "DD" && date !== null) {
        out.push({ date, text: el.textContent ?? "" });
        date = null;
      }
    }
    return out;
  });
  return pairs.map((p) => ({ date: toIsoDate(normalizeSpace(p.date)), text: normalizeSpace(p.text) }));
}

/** 区分（学部生／大学院生）を選ぶ。サイトの JS により入学年度・学科の選択はリセットされる */
export async function selectStudentType(page: Page, t: StudentType): Promise<void> {
  const sel = RADIO[t];
  if (!Object.hasOwn(RADIO, t) || !sel) {
    throw new PortalError("VALIDATION", `区分は undergrad / graduate のどちらかです: ${String(t)}`, {
      available: Object.keys(RADIO),
    });
  }
  await requireHome(page);
  await requireSelector(page, sel);
  const radio = page.locator(sel).first();
  const label = page.locator(`label[for="${sel.slice(1)}"]`).first();
  // サイトは radio の click で年度・学科をリセットする。見た目の都合で input が隠れていても動くよう、
  // 見えていれば label を、見えていなければ input に click イベントを送る。
  if ((await label.count()) > 0 && (await label.isVisible())) await label.click();
  else if (await radio.isVisible()) await radio.click();
  else await radio.dispatchEvent("click");
  if (!(await radio.isChecked())) {
    throw layoutChanged(page, sel, { reason: "radio did not become checked" });
  }
}

async function readYears(page: Page): Promise<number[]> {
  const values = await page.locator(`${YEAR} option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  return values.filter((v) => /^\d{4}$/.test(v)).map(Number);
}

async function readDepartments(page: Page): Promise<DepartmentOption[]> {
  const raw = await page
    .locator(`${DEPT} option`)
    .evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })));
  return raw
    .filter((o) => o.value !== "")
    .map((o) => {
      const text = normalizeSpace(o.text);
      const prefix = new RegExp(`^${o.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[：:]\\s*`);
      return { code: o.value, name: text.replace(prefix, "") };
    });
}

async function waitForDepartments(page: Page, timeout: number): Promise<DepartmentOption[]> {
  try {
    await page.waitForFunction(
      (sel) => Array.from(document.querySelectorAll(`${sel} option`)).some((o) => (o as HTMLOptionElement).value !== ""),
      DEPT,
      { timeout, polling: 50 },
    );
  } catch {
    return [];
  }
  return readDepartments(page);
}

/**
 * 入学年度を選び、サイトの JS が生成した学科・専攻の選択肢を返す。
 * 提示されない年度は VALIDATION（details.available に選べる年度）。
 */
export async function selectYear(page: Page, year: number): Promise<DepartmentOption[]> {
  await requireHome(page);
  await requireSelector(page, YEAR);
  await requireSelector(page, DEPT);
  const available = await readYears(page);
  if (!Number.isInteger(year) || !available.includes(year)) {
    throw new PortalError("VALIDATION", `入学年度 ${String(year)} は選べません`, { available });
  }
  await page.selectOption(YEAR, String(year));
  let depts = await waitForDepartments(page, 2_000);
  if (depts.length === 0) {
    // サイトの初期化（ready ハンドラ）より先に選んだ場合に備え、1 回だけ選び直す
    await page.selectOption(YEAR, "");
    await page.selectOption(YEAR, String(year));
    depts = await waitForDepartments(page, 3_000);
  }
  if (depts.length === 0) {
    throw layoutChanged(page, `${DEPT} option`, { reason: "no department options were generated", year });
  }
  return depts;
}

/** 学科・専攻をコードで選ぶ。選択肢に無いコードは VALIDATION（details.available に選択肢） */
export async function selectDepartment(page: Page, code: string): Promise<void> {
  await requireHome(page);
  await requireSelector(page, DEPT);
  const available = await readDepartments(page);
  if (!available.some((d) => d.code === code)) {
    const hint = available.length === 0 ? "（先に入学年度を選んでください）" : "";
    throw new PortalError("VALIDATION", `学科・専攻コード ${code} は選択肢にありません${hint}`, { available });
  }
  await page.selectOption(DEPT, code);
  if ((await page.locator(DEPT).inputValue()) !== code) {
    throw layoutChanged(page, DEPT, { reason: "selection did not stick", code });
  }
}

type SubmitOutcome =
  | { kind: "dialog"; message: string }
  | { kind: "response"; response: Response }
  | { kind: "failed"; request: Request }
  | { kind: "timeout" };

/**
 * 検索ボタンを押して学科ページへ遷移する。
 * サイトが出す alert は捕まえて VALIDATION に変換する（details.dialog に文言）。
 */
export async function submitSearch(page: Page): Promise<{ url: string; title: string }> {
  await requireHome(page);
  await requireSelector(page, SUBMIT);

  const isMainNav = (r: Request): boolean => r.isNavigationRequest() && r.frame() === page.mainFrame();
  let onDialog: ((d: Dialog) => void) | undefined;
  let onFailed: ((r: Request) => void) | undefined;
  const outcome = new Promise<SubmitOutcome>((resolve) => {
    onDialog = (d) => {
      resolve({ kind: "dialog", message: d.message() });
      d.dismiss().catch(() => undefined);
    };
    onFailed = (r) => {
      if (isMainNav(r)) resolve({ kind: "failed", request: r });
    };
    page.on("dialog", onDialog);
    page.on("requestfailed", onFailed);
    page
      .waitForResponse((r) => isMainNav(r.request()), { timeout: DEFAULT_TIMEOUT_MS })
      .then((response) => resolve({ kind: "response", response }))
      .catch(() => resolve({ kind: "timeout" }));
  });

  try {
    await page.locator(SUBMIT).first().click();
    const r = await outcome;
    if (r.kind === "dialog") {
      throw new PortalError("VALIDATION", r.message, { dialog: r.message });
    }
    if (r.kind === "failed") {
      throw new PortalError("NAVIGATION", `検索結果のページを開けませんでした: ${r.request.url()}`, {
        url: r.request.url(),
        cause: r.request.failure()?.errorText,
      });
    }
    if (r.kind === "timeout") {
      throw new PortalError("NAVIGATION", "検索しても遷移しませんでした", { url: page.url() });
    }
    const status = r.response.status();
    if (status >= 400) {
      throw new PortalError("NAVIGATION", `検索結果のページが HTTP ${status} を返しました`, {
        url: r.response.url(),
        status,
      });
    }
    await page.waitForLoadState("domcontentloaded", { timeout: DEFAULT_TIMEOUT_MS });
    return { url: page.url(), title: normalizeSpace(await page.title()) };
  } finally {
    if (onDialog) page.off("dialog", onDialog);
    if (onFailed) page.off("requestfailed", onFailed);
  }
}
