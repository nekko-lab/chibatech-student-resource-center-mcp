/**
 * `@chibatech-src/portal/testing` — テスト用の合成サイト。
 *
 * `installFakePortal` は `page.route` / `context.route` でベース URL 以下を横取りし、
 * 自前で書いた架空の HTML・JS・PDF を返す。ベース URL の外への要求（解析タグ・外部リンク等）は
 * すべて中断するので、合成サイトを使ったテストはネットワークに出ない。
 *
 * 後から登録した route が優先されるため、利用側で特定の URL を別に扱いたい場合は
 * `installFakePortal` の後に `route` を登録すればよい。
 */
import type { BrowserContext, Page, Route } from "playwright-core";
import { DEFAULT_BASE_URL } from "../constants.ts";
import { resolveFakePath } from "./pages.ts";

export { FAKE_ALERT_SUBMIT, FAKE_ALERT_YEAR, BREAKPOINT } from "./script.ts";
export { FAKE_YEARS, graduateDepts, undergradDepts } from "./data.ts";

export interface FakePortal {
  /** 合成サイトを置いたベース URL（末尾 `/`） */
  baseUrl: string;
  /** 合成サイトが応答した URL（到着順） */
  served: string[];
  /** ベース URL の外として中断した URL（到着順） */
  blocked: string[];
}

function normalizeBase(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.search = "";
  u.hash = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.href;
}

export async function installFakePortal(
  target: Page | BrowserContext,
  opts: { baseUrl?: string } = {},
): Promise<FakePortal> {
  const baseUrl = normalizeBase(opts.baseUrl ?? DEFAULT_BASE_URL);
  const state: FakePortal = { baseUrl, served: [], blocked: [] };

  const handler = async (route: Route): Promise<void> => {
    const url = route.request().url();
    const u = new URL(url);
    const bare = `${u.origin}${u.pathname}`;
    if (!bare.startsWith(baseUrl) && `${bare}/` !== baseUrl) {
      state.blocked.push(url);
      await route.abort("blockedbyclient");
      return;
    }
    state.served.push(url);
    const rel = bare.length >= baseUrl.length ? bare.slice(baseUrl.length) : "";
    const res = resolveFakePath(baseUrl, decodeURIComponent(rel));
    await route.fulfill({
      status: res.status,
      contentType: res.contentType,
      body: res.body,
    });
  };

  await target.route(() => true, handler);
  return state;
}
