/**
 * テスト用のブラウザ。テストイメージ同梱の Chromium を起動し、サーバが作るコンテキストに
 * 合成サイト（installFakePortal）を差し込む。合成サイトはベース URL の外への要求をすべて中断するので、
 * テストはネットワークに出ない。
 */
import { installFakePortal, type FakePortal } from "@chibatech-src/portal/testing";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

export interface TestBrowser {
  /** サーバに渡す Browser（newContext で合成サイトを差し込む） */
  browser: Browser;
  /** 作られたコンテキストと、その合成サイト */
  contexts: { context: BrowserContext; fake: FakePortal }[];
  /** getBrowser が呼ばれた回数 */
  launches: number;
  getBrowser: () => Promise<{ browser: Browser; via: string }>;
  /** 本物のブラウザを閉じる（サーバが閉じていても安全） */
  dispose: () => Promise<void>;
}

export async function launchTestBrowser(
  opts: { baseUrl?: string; onContext?: (c: BrowserContext) => Promise<void> } = {},
): Promise<TestBrowser> {
  const real = await chromium.launch();
  const contexts: TestBrowser["contexts"] = [];
  const browser = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "newContext") {
        return async (options?: Parameters<Browser["newContext"]>[0]) => {
          const context = await target.newContext(options);
          const fake = await installFakePortal(context, opts.baseUrl ? { baseUrl: opts.baseUrl } : {});
          await opts.onContext?.(context);
          contexts.push({ context, fake });
          return context;
        };
      }
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const t: TestBrowser = {
    browser,
    contexts,
    launches: 0,
    getBrowser: async () => {
      t.launches++;
      return { browser, via: "test-chromium" };
    },
    dispose: async () => {
      await real.close().catch(() => undefined);
    },
  };
  return t;
}
