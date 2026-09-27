/**
 * 実サイトへのライブ確認（既定ではスキップ。LIVE=1 のときだけ実行）。
 *
 * - アクセスは 5 リクエスト以内（ホーム HTML・jquery.js・common.js・学科ページ HTML の 4 件を想定）。
 *   それ以外（CSS・画像・解析タグ・学科ページのスクリプト等）はすべて中断し、数を検査する。
 * - 判定は「G1 が選択肢にある」「遷移先 URL」「節が 1 つ以上ある」など事実だけ。本文は出力しない。
 */
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_URL,
  contextOptions,
  installRoutes,
  listSections,
  openHome,
  selectDepartment,
  selectStudentType,
  selectYear,
  submitSearch,
} from "../src/index.ts";
import { launch } from "./helpers.ts";

declare const process: { env: Record<string, string | undefined> };
const LIVE = typeof process !== "undefined" && process.env.LIVE === "1";

const MAX_REQUESTS = 5;
const LIVE_UA = "chibatech-src-portal-live-check/0.1 (unofficial; structure check, <=5 requests)";

describe.skipIf(!LIVE)("live: 実サイト", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("学部生 / 2026 に G1 があり、検索で iis/computer_2026.html に遷移する", async () => {
    const context = await browser.newContext(contextOptions({ userAgent: LIVE_UA }));
    const page = await context.newPage();
    const sent: string[] = [];
    await page.route(
      () => true,
      async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const underBase = url.href.startsWith(DEFAULT_BASE_URL);
        const isDoc = req.isNavigationRequest() && req.frame() === page.mainFrame();
        const onHome = page.url() === "about:blank" || page.url() === DEFAULT_BASE_URL;
        const neededScript = /\/cmn\/js\/(jquery|common)\.js$/.test(url.pathname) && onHome;
        if (underBase && (isDoc || neededScript) && sent.length < MAX_REQUESTS) {
          sent.push(url.pathname);
          await route.continue();
          return;
        }
        await route.abort("blockedbyclient");
      },
    );
    await installRoutes(page);

    await openHome(page);
    await selectStudentType(page, "undergrad");
    const depts = await selectYear(page, 2026);
    expect(depts.some((d) => d.code === "G1")).toBe(true);

    await selectDepartment(page, "G1");
    const r = await submitSearch(page);
    expect(r.url).toBe(`${DEFAULT_BASE_URL}iis/computer_2026.html`);

    const sections = await listSections(page);
    expect(sections.sections.length).toBeGreaterThan(0);
    expect(sections.sections.every((sec) => sec.items.every((i) => i.href.startsWith("https://")))).toBe(true);

    expect(sent.length).toBeLessThanOrEqual(MAX_REQUESTS);
    // 本文は出さず、件数などの事実だけを記録する
    console.info(`[live] requests=${sent.length} depts=${depts.length} sections=${sections.sections.length}`);
    await context.close();
  });
});
