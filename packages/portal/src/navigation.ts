import type { Page } from "playwright-core";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from "./constants.ts";
import { PortalError } from "./errors.ts";

/** ベース URL を正規化する（末尾 `/`、クエリ・ハッシュなし）。不正なら VALIDATION */
export function resolveBaseUrl(baseUrl: string = DEFAULT_BASE_URL): string {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new PortalError("VALIDATION", `baseUrl が URL として解釈できません: ${baseUrl}`, { baseUrl });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new PortalError("VALIDATION", `baseUrl は http(s) である必要があります: ${baseUrl}`, { baseUrl });
  }
  u.search = "";
  u.hash = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.href;
}

/** 遷移し、失敗や 4xx/5xx を NAVIGATION に変換する */
export async function gotoChecked(
  page: Page,
  url: string,
  waitUntil: "load" | "domcontentloaded" = "load",
): Promise<void> {
  let status: number | undefined;
  try {
    const res = await page.goto(url, { waitUntil, timeout: DEFAULT_TIMEOUT_MS });
    status = res?.status();
  } catch (e) {
    throw new PortalError("NAVIGATION", `ページを開けませんでした: ${url}`, { url, cause: String(e) });
  }
  if (status !== undefined && status >= 400) {
    throw new PortalError("NAVIGATION", `ページが HTTP ${status} を返しました: ${url}`, { url, status });
  }
}

/** 期待するページ（body の id）にいることを確かめる。いなければ NAVIGATION */
export async function requirePage(page: Page, bodySelector: string, hint: string): Promise<void> {
  if ((await page.locator(bodySelector).count()) === 0) {
    throw new PortalError("NAVIGATION", `${hint}を開いてから呼んでください（現在: ${page.url()}）`, {
      expected: bodySelector,
      url: page.url(),
    });
  }
}
