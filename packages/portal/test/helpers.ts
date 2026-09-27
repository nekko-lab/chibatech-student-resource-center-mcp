import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { DEFAULT_BASE_URL, contextOptions } from "../src/index.ts";
import { installFakePortal, type FakePortal } from "../src/testing/index.ts";
import { resolveFakePath } from "../src/testing/pages.ts";

export const TEST_UA = "chibatech-src-portal-test/0.0 (unofficial; synthetic site)";

export async function launch(): Promise<Browser> {
  // イメージ同梱の Chromium を使う（channel は指定しない）
  return chromium.launch();
}

export interface FakeSession {
  context: BrowserContext;
  page: Page;
  fake: FakePortal;
}

export async function openFake(
  browser: Browser,
  opts: { baseUrl?: string; viewport?: { width: number; height: number } } = {},
): Promise<FakeSession> {
  const base = contextOptions({ userAgent: TEST_UA });
  const context = await browser.newContext({ ...base, viewport: opts.viewport ?? base.viewport });
  const fake = await installFakePortal(context, opts.baseUrl ? { baseUrl: opts.baseUrl } : {});
  const page = await context.newPage();
  return { context, page, fake };
}

/** PortalError を投げることを確かめ、その値を返す */
export async function catchError(p: Promise<unknown>): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string; details?: unknown };
  }
  throw new Error("expected the operation to throw");
}

/**
 * 合成サイトの HTML を直接得る（壊れた版を route で差し込むテスト用）。
 * route.fetch() は route を通らず実ネットワークへ出るので使わない。
 */
export function fakeHtml(path: string, baseUrl: string = DEFAULT_BASE_URL): string {
  return resolveFakePath(baseUrl, path).body;
}
