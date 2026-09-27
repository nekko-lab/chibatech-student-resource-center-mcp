/**
 * ブラウザのセッション。1 プロセスにブラウザ 1 つ・コンテキスト 1 つ。
 *
 * - ブラウザは最初の利用で 1 回だけ用意する（遅延起動）。失敗・切断したら次の利用で用意し直す
 * - コンテキストは contextOptions（viewport 1024x768・ja-JP・User-Agent）で作る
 * - 状態を持つ操作（ホームのフォームなど）は 1 枚の Page 上で行う。マクロは使い捨ての Page（scratch）で動かす
 * - どの Page にも installRoutes で解析タグを止める
 * - ツールの実行は run で直列にする（排他）
 */
import type { Fetcher } from "@chibatech-src/pdf";
import { contextOptions, installRoutes } from "@chibatech-src/portal";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { requestFetcher } from "./fetcher.ts";

export interface SessionOptions {
  getBrowser: () => Promise<{ browser: Browser; via: string }>;
  userAgent: string;
  log: (message: string) => void;
}

interface Started {
  browser: Browser;
  context: BrowserContext;
  via: string;
}

const stripHash = (url: string): string => url.replace(/#.*$/, "");

export class Session {
  readonly #o: SessionOptions;
  #started: Promise<Started> | undefined;
  #page: Page | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  readonly #lastModified = new Map<string, string>();
  #closing: Promise<void> | undefined;

  constructor(o: SessionOptions) {
    this.#o = o;
  }

  /** fn を直列に実行する（前の実行が終わってから始める） */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.#tail.then(fn);
    this.#tail = p.catch(() => undefined);
    return p;
  }

  #start(): Promise<Started> {
    this.#started ??= (async () => {
      const t0 = Date.now();
      const { browser, via } = await this.#o.getBrowser();
      const context = await browser.newContext(contextOptions({ userAgent: this.#o.userAgent }));
      context.on("response", (r) => {
        if (r.request().resourceType() !== "document") return;
        const lm = r.headers()["last-modified"];
        const url = stripHash(r.url());
        if (lm) this.#lastModified.set(url, lm);
        else this.#lastModified.delete(url);
      });
      browser.on("disconnected", () => {
        this.#started = undefined;
        this.#page = undefined;
      });
      this.#o.log(`browser ready via=${via} version=${browser.version()} in ${Date.now() - t0}ms`);
      return { browser, context, via };
    })().catch((e: unknown) => {
      this.#started = undefined;
      throw e;
    });
    return this.#started;
  }

  async context(): Promise<BrowserContext> {
    return (await this.#start()).context;
  }

  /** ブラウザを起動した経路（未起動なら undefined） */
  async via(): Promise<string | undefined> {
    if (!this.#started) return undefined;
    return (await this.#started.catch(() => undefined))?.via;
  }

  async #newPage(): Promise<Page> {
    const context = await this.context();
    const page = await context.newPage();
    await installRoutes(page);
    return page;
  }

  /** 状態を持つ 1 枚の Page（閉じられていたら作り直す） */
  async page(): Promise<Page> {
    if (this.#page && !this.#page.isClosed()) return this.#page;
    this.#page = await this.#newPage();
    return this.#page;
  }

  /** 使い捨ての Page で fn を動かし、終わったら閉じる */
  async scratch<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.#newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** コンテキストの `request` を包んだ Fetcher */
  async fetcher(): Promise<Fetcher> {
    return requestFetcher((await this.context()).request);
  }

  /** 最後に開いたときの Last-Modified（送られなかった・未取得なら null） */
  lastModified(url: string): string | null {
    return this.#lastModified.get(stripHash(url)) ?? null;
  }

  /** ブラウザを閉じる。何度呼んでもよく、閉じている途中に呼んでもその完了を待つ */
  close(): Promise<void> {
    const started = this.#started;
    this.#started = undefined;
    this.#page = undefined;
    if (!started) return this.#closing ?? Promise.resolve();
    this.#closing = (async () => {
      const s = await started.catch(() => undefined);
      await s?.context.close().catch(() => undefined);
      await s?.browser.close().catch(() => undefined);
    })();
    return this.#closing;
  }
}
