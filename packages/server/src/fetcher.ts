import type { Fetcher } from "@chibatech-src/pdf";
import type { APIRequestContext } from "playwright-core";

const TIMEOUT_MS = 30_000;

/**
 * Playwright の `context.request` を包んだ Fetcher。
 * Cookie やプロキシ設定をブラウザと共有するため、PDF の取得はこれで行う。
 * 4xx / 5xx / 304 も例外にせず、状態として返す（判定は fetchPdf が行う）。
 */
export function requestFetcher(request: APIRequestContext): Fetcher {
  return async (url, headers) => {
    const res = await request.get(url, { headers, timeout: TIMEOUT_MS, failOnStatusCode: false, maxRedirects: 5 });
    try {
      return { status: res.status(), headers: res.headers(), body: new Uint8Array(await res.body()) };
    } finally {
      await res.dispose().catch(() => undefined);
    }
  };
}
