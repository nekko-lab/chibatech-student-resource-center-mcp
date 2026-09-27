import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL } from "../src/index.ts";
import { FAKE_ALERT_YEAR, installFakePortal } from "../src/testing/index.ts";
import { launch, openFake, type FakeSession } from "./helpers.ts";

let browser: Browser;
let s: FakeSession;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  await s?.context.close();
});

const B = DEFAULT_BASE_URL;

describe("installFakePortal", () => {
  it("ベース URL の外（解析タグなど）は中断し、ネットワークに出ない", async () => {
    s = await openFake(browser);
    await s.page.goto(B);
    expect(s.fake.blocked.some((u) => u.includes("googletagmanager.com"))).toBe(true);
    expect(s.fake.served.every((u) => u.startsWith(B))).toBe(true);
    expect(s.fake.served).toContain(`${B}cmn/js/common.js`);
  });

  it("Page に対しても入れられる", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const fake = await installFakePortal(page, { baseUrl: "http://portal.test/p" });
    expect(fake.baseUrl).toBe("http://portal.test/p/");
    await page.goto("http://portal.test/p/");
    expect(await page.locator("body#home").count()).toBe(1);
    await context.close();
  });

  it("知らないパスは 404、PDF は application/pdf", async () => {
    s = await openFake(browser);
    const nf = await s.page.goto(`${B}no/such/page.html`);
    expect(nf?.status()).toBe(404);
    // page.request（APIRequestContext）は route を通らず実ネットワークへ出るので、ページ内 fetch で確かめる
    await s.page.goto(B);
    const ct = await s.page.evaluate(async (u) => (await fetch(u)).headers.get("content-type"), `${B}whole/gakubu/map.pdf`);
    expect(ct).toBe("application/pdf");
  });

  it("年度未選択で学科の select をクリックすると alert が出る", async () => {
    s = await openFake(browser);
    await s.page.goto(B);
    const dialog = s.page.waitForEvent("dialog");
    void s.page.locator("#slt_dept").click();
    const d = await dialog;
    expect(d.message()).toBe(FAKE_ALERT_YEAR);
    await d.dismiss();
  });

  it("幅 737px の境界をまたぐリサイズで再読込する", async () => {
    s = await openFake(browser);
    await s.page.goto(`${B}fic/xeng_2026.html`);
    await s.page.evaluate(() => ((window as unknown as { __marker?: number }).__marker = 1));
    const nav = s.page.waitForEvent("framenavigated");
    await s.page.setViewportSize({ width: 600, height: 768 });
    await nav;
    await s.page.waitForLoadState("domcontentloaded");
    expect(await s.page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
  });

  it("アコーディオンは見出しクリックで開閉する（幅 737px 未満は閉じて始まる）", async () => {
    s = await openFake(browser, { viewport: { width: 500, height: 800 } });
    await s.page.goto(`${B}fic/xeng_2026.html`);
    const detail = s.page.locator(".collapse__detail").first();
    expect(await detail.isVisible()).toBe(false);
    await s.page.locator(".collapse__trigger").first().click();
    expect(await detail.isVisible()).toBe(true);
  });
});
