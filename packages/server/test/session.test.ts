import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_BASE_URL } from "@chibatech-src/portal";
import { chromium } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requestFetcher } from "../src/fetcher.ts";
import { Session } from "../src/session.ts";
import { launchTestBrowser, type TestBrowser } from "./helpers/browser.ts";

const LM = "Tue, 31 Mar 2099 00:00:00 GMT";

describe("Session", () => {
  let tb: TestBrowser;
  let session: Session | undefined;
  const logs: string[] = [];

  // Session.close はブラウザも閉じるので、テストごとに起動し直す
  beforeEach(async () => {
    tb = await launchTestBrowser({
      onContext: async (c) => {
        // 合成サイトの後に登録した route が優先される。Last-Modified 付きの応答を 1 つだけ用意する
        await c.route(`${DEFAULT_BASE_URL}whole/lm.html`, (r) =>
          r.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            headers: { "Last-Modified": LM },
            body: "<!DOCTYPE html><title>lm</title><body id=lm>ok</body>",
          }),
        );
      },
    });
  });
  afterEach(async () => {
    await session?.close();
    session = undefined;
    await tb.dispose();
  });

  const make = () =>
    (session = new Session({ getBrowser: tb.getBrowser, userAgent: "srv-test-agent/1.0", log: (m) => logs.push(m) }));

  it("ブラウザは最初の利用で 1 回だけ用意する（同時に呼んでも 1 回）", async () => {
    const s = make();
    expect(tb.launches).toBe(0);
    await Promise.all([s.run(() => s.page()), s.run(() => s.page()), s.run(() => s.context())]);
    expect(tb.launches).toBe(1);
    expect(logs.some((l) => l.includes("test-chromium"))).toBe(true);
  });

  it("コンテキストは viewport 1024x768・ja-JP・User-Agent", async () => {
    const s = make();
    const page = await s.run(() => s.page());
    expect(page.viewportSize()).toEqual({ width: 1024, height: 768 });
    const ua = await page.evaluate(() => [navigator.userAgent, navigator.language]);
    expect(ua).toEqual(["srv-test-agent/1.0", "ja-JP"]);
  });

  it("run は直列に実行する（排他）", async () => {
    const s = make();
    const events: string[] = [];
    const task = (name: string, ms: number) =>
      s.run(async () => {
        events.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, ms));
        events.push(`${name}:end`);
      });
    await Promise.all([task("a", 30), task("b", 1), task("c", 1)]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("失敗しても次の run は動く", async () => {
    const s = make();
    await expect(s.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(s.run(async () => 1)).resolves.toBe(1);
  });

  it("scratch は使い捨ての Page を渡し、終わったら閉じる。状態を持つ Page は汚さない", async () => {
    const s = make();
    const main = await s.run(() => s.page());
    await main.goto(DEFAULT_BASE_URL);
    let scratch: import("playwright-core").Page | undefined;
    await s.run(() =>
      s.scratch(async (p) => {
        scratch = p;
        await p.goto(`${DEFAULT_BASE_URL}whole/inquiry.html`);
      }),
    );
    expect(scratch?.isClosed()).toBe(true);
    expect(main.url()).toBe(DEFAULT_BASE_URL);
    expect(await s.run(() => s.page())).toBe(main);
  });

  it("文書の Last-Modified を覚えておく", async () => {
    const s = make();
    const page = await s.run(() => s.page());
    await page.goto(`${DEFAULT_BASE_URL}whole/lm.html`);
    expect(s.lastModified(`${DEFAULT_BASE_URL}whole/lm.html`)).toBe(LM);
    await page.goto(DEFAULT_BASE_URL);
    expect(s.lastModified(DEFAULT_BASE_URL)).toBeNull();
  });

  it("getBrowser が失敗したら、次の呼び出しで呼び直す", async () => {
    let n = 0;
    const s = (session = new Session({
      getBrowser: async () => {
        n++;
        if (n === 1) throw new Error("no browser");
        return tb.getBrowser();
      },
      userAgent: "srv-test-agent/1.0",
      log: () => undefined,
    }));
    await expect(s.run(() => s.page())).rejects.toThrow("no browser");
    await expect(s.run(() => s.page())).resolves.toBeTruthy();
    expect(n).toBe(2);
  });

  it("close はブラウザを閉じる", async () => {
    const own = await chromium.launch();
    const s = new Session({ getBrowser: async () => ({ browser: own, via: "own" }), userAgent: "x", log: () => undefined });
    await s.run(() => s.page());
    await s.close();
    expect(own.isConnected()).toBe(false);
    await s.close(); // 2 回目も安全
  });
});

describe("requestFetcher（context.request を包む）", () => {
  let http: Server;
  let origin: string;
  beforeAll(async () => {
    http = createHttpServer((req, res) => {
      if (req.url === "/doc.pdf") {
        if (req.headers["if-modified-since"] === LM) {
          res.writeHead(304, { "Last-Modified": LM });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/pdf", "Last-Modified": LM, "X-UA": String(req.headers["user-agent"]) });
        res.end("%PDF-1.4 fake");
        return;
      }
      res.writeHead(404);
      res.end("nope");
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => http.close(r));
  });

  it("状態・ヘッダ・本体を返し、304 と 404 を例外にしない", async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext();
      const f = requestFetcher(ctx.request);
      const r = await f(`${origin}/doc.pdf`, { "User-Agent": "ua-1" });
      expect(r.status).toBe(200);
      expect(r.headers["last-modified"]).toBe(LM);
      expect(r.headers["x-ua"]).toBe("ua-1");
      expect(new TextDecoder().decode(r.body)).toBe("%PDF-1.4 fake");
      expect((await f(`${origin}/doc.pdf`, { "If-Modified-Since": LM })).status).toBe(304);
      expect((await f(`${origin}/missing`, {})).status).toBe(404);
    } finally {
      await b.close();
    }
  });
});
