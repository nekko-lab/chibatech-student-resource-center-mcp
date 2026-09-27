import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, PortalError, contextOptions, installRoutes } from "../src/index.ts";
import { installFakePortal } from "../src/testing/index.ts";
import { TEST_UA, launch } from "./helpers.ts";

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

describe("DEFAULT_BASE_URL", () => {
  it("ポータルのベース URL（末尾スラッシュ付き）", () => {
    expect(DEFAULT_BASE_URL).toBe("https://kmsk.is.it-chiba.ac.jp/portal/");
  });
});

describe("PortalError", () => {
  it("code と details を持つ Error", () => {
    const e = new PortalError("LAYOUT_CHANGED", "missing", { selector: "#x" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PortalError");
    expect(e.code).toBe("LAYOUT_CHANGED");
    expect(e.details).toEqual({ selector: "#x" });
    expect(e.message).toBe("missing");
  });
});

describe("contextOptions", () => {
  it("viewport を 1024x768 に固定し、locale を ja-JP にする", () => {
    expect(contextOptions({ userAgent: "ua/1" })).toEqual({
      viewport: { width: 1024, height: 768 },
      userAgent: "ua/1",
      locale: "ja-JP",
    });
  });
});

describe("installRoutes", () => {
  it("googletagmanager.com などの解析要求を止め、他の要求は通す", async () => {
    const context = await browser.newContext(contextOptions({ userAgent: TEST_UA }));
    const page = await context.newPage();
    // 「ネットワーク」の代わり: 解析タグにも応答する route を先に登録しておく
    const reached: string[] = [];
    await page.route(
      () => true,
      async (route) => {
        const url = route.request().url();
        reached.push(url);
        if (url.includes("googletagmanager.com") || url.includes("google-analytics.com")) {
          await route.fulfill({ contentType: "application/javascript", body: "window.__tracked = true;" });
          return;
        }
        await route.fulfill({
          contentType: "text/html",
          body: `<!DOCTYPE html><html><head>
            <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
            <script src="https://www.google-analytics.com/analytics.js"></script>
            </head><body><p id="ok">ok</p></body></html>`,
        });
      },
    );
    await installRoutes(page);
    const failed: string[] = [];
    page.on("requestfailed", (r) => failed.push(r.url()));

    await page.goto("https://site.example.test/");
    await expect(page.locator("#ok").textContent()).resolves.toBe("ok");
    expect(await page.evaluate(() => (window as unknown as { __tracked?: boolean }).__tracked)).toBeUndefined();
    expect(failed.some((u) => u.includes("googletagmanager.com"))).toBe(true);
    expect(failed.some((u) => u.includes("google-analytics.com"))).toBe(true);
    expect(reached.some((u) => u.includes("googletagmanager.com"))).toBe(false);
    await context.close();
  });

  it("合成サイトの上でも使え、ページ本体は読める", async () => {
    const context = await browser.newContext(contextOptions({ userAgent: TEST_UA }));
    const fake = await installFakePortal(context);
    const page = await context.newPage();
    await installRoutes(page);
    await page.goto(DEFAULT_BASE_URL);
    expect(await page.locator("body#home").count()).toBe(1);
    expect(fake.served.some((u) => u.includes("googletagmanager.com"))).toBe(false);
    await context.close();
  });
});
