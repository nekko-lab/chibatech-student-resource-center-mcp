import { DEFAULT_BASE_URL, PortalError } from "@chibatech-src/portal";
import { FAKE_YEARS } from "@chibatech-src/portal/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortalService } from "../src/portal-port.ts";
import { Session } from "../src/session.ts";
import { launchTestBrowser, type TestBrowser } from "./helpers/browser.ts";

describe("PortalService（合成サイト）", () => {
  let tb: TestBrowser;
  let session: Session;
  let now = 0;
  let svc: PortalService;
  beforeEach(async () => {
    tb = await launchTestBrowser();
    session = new Session({ getBrowser: tb.getBrowser, userAgent: "srv-test", log: () => undefined });
    now = 0;
    svc = new PortalService(session, DEFAULT_BASE_URL, { ttlMs: 1000, clock: () => now });
  });
  afterEach(async () => {
    await session.close();
    await tb.dispose();
  });

  const homeLoads = () => tb.contexts.flatMap((c) => c.fake.served).filter((u) => u === DEFAULT_BASE_URL).length;

  it("選べる年度・学科・学科ページを読む", async () => {
    expect(await svc.years("undergrad")).toEqual([...FAKE_YEARS]);
    expect((await svc.departments("graduate", 2025)).map((d) => d.code)).toEqual(["Q1", "Q2", "Q9", "71"]);
    const p = await svc.departmentPage("undergrad", 2023, "72");
    expect(p.url).toBe(`${DEFAULT_BASE_URL}fic/sim_2023.html`);
    expect(p.heading).toMatch(/模擬情報学科/);
    expect(p.sections.length).toBe(5);
  });

  it("選べない年度は VALIDATION（details.available）", async () => {
    const e = await svc.departments("undergrad", 1999).catch((x: unknown) => x);
    expect((e as PortalError).code).toBe("VALIDATION");
    expect((e as PortalError).details).toMatchObject({ available: [...FAKE_YEARS] });
  });

  it("結果を一定時間覚えておき、サイトへの要求を減らす", async () => {
    await svc.quickLinks();
    await svc.quickLinks();
    expect(homeLoads()).toBe(1);
    now = 2000;
    const q = await svc.quickLinks();
    expect(homeLoads()).toBe(2);
    expect(q.items.map((l) => l.title)).toContain("シャトル時刻表");
  });

  it("失敗した結果は覚えない", async () => {
    await expect(svc.departmentPage("undergrad", 2026, "ZZ")).rejects.toBeInstanceOf(PortalError);
    await expect(svc.departmentPage("undergrad", 2026, "X1")).resolves.toMatchObject({ url: `${DEFAULT_BASE_URL}fic/xeng_2026.html` });
  });

  it("使い捨ての Page を閉じる", async () => {
    await svc.faq();
    const ctx = await session.context();
    expect(ctx.pages().length).toBe(0);
  });
});
