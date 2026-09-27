import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, openHome, openQuickLink } from "../src/index.ts";
import { catchError, launch, openFake, type FakeSession } from "./helpers.ts";

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

describe("openQuickLink", () => {
  it("html のリンクは遷移する", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const r = await openQuickLink(s.page, "関連サイト");
    expect(r).toEqual({ url: `${B}whole/link.html`, kind: "html" });
    expect(s.page.url()).toBe(`${B}whole/link.html`);
  });

  it("pdf は遷移せず URL を返す", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const r = await openQuickLink(s.page, "シャトル時刻表");
    expect(r).toEqual({ url: `${B}whole/gakubu/shuttle.pdf`, kind: "pdf" });
    expect(s.page.url()).toBe(B);
  });

  it("外部サイトは遷移せず URL を返す", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const r = await openQuickLink(s.page, "食堂メニュー");
    expect(r).toEqual({ url: "https://dining.example.com/menu/", kind: "external" });
    expect(s.page.url()).toBe(B);
  });

  it("名前の一部・空白の揺れでも一意なら選べる", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    expect((await openQuickLink(s.page, "構内 案内")).url).toBe(`${B}whole/gakubu/map.pdf`);
  });

  it("学科ページなどホーム以外ではサイドメニューから選ぶ", async () => {
    s = await openFake(browser);
    await s.page.goto(`${B}fic/xeng_2026.html`);
    const r = await openQuickLink(s.page, "よくある質問・窓口");
    expect(r).toEqual({ url: `${B}whole/inquiry.html`, kind: "html" });
    expect(await s.page.locator("body#inquiry").count()).toBe(1);
  });

  it("見つからない名前は NOT_FOUND（details に選べる名前）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(openQuickLink(s.page, "存在しないリンク"));
    expect(err.code).toBe("NOT_FOUND");
    expect((err.details as { available: string[] }).available).toContain("関連サイト");
  });

  it("複数に当たる名前は VALIDATION（details に候補）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(openQuickLink(s.page, "・"));
    expect(err.code).toBe("VALIDATION");
    expect((err.details as { candidates: string[] }).candidates.length).toBeGreaterThan(1);
  });

  it("クイックリンクもサイドメニューも無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    await s.context.route(`${B}whole/empty.html`, (r) =>
      r.fulfill({ contentType: "text/html", body: "<!DOCTYPE html><html><body><p>x</p></body></html>" }),
    );
    await s.page.goto(`${B}whole/empty.html`);
    const err = await catchError(openQuickLink(s.page, "関連サイト"));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selectors: ["section.top_nav li a", "aside nav li a"] });
  });
});
