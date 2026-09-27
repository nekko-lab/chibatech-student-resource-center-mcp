import type { Page } from "playwright-core";

export interface PortalContextOptions {
  viewport: { width: 1024; height: 768 };
  userAgent: string;
  locale: "ja-JP";
}

/**
 * `browser.newContext()` に渡すオプション。
 *
 * サイトは幅 737px 未満でアコーディオンを閉じ、そのブレークポイントをまたぐリサイズで
 * 再読込するので、viewport は 1024x768 に固定する。
 */
export function contextOptions(opts: { userAgent: string }): PortalContextOptions {
  return { viewport: { width: 1024, height: 768 }, userAgent: opts.userAgent, locale: "ja-JP" };
}

/** 止める解析・広告系ホスト（サブドメインを含む） */
export const BLOCKED_HOSTS: readonly string[] = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "doubleclick.net",
];

export function isBlockedUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** googletagmanager.com などの解析要求を止める */
export async function installRoutes(page: Page): Promise<void> {
  await page.route(isBlockedUrl, (route) => route.abort("blockedbyclient"));
}
