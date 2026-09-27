import type { PdfCache, PdfCacheEntry } from "./cache.ts";

/**
 * HTTP GET の差し替え口。製品では Playwright の `page.request` を包んだものを渡す。
 * headers は応答ヘッダ（名前の大小文字は問わない）。
 */
export type Fetcher = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;

export interface FetchPdfOptions {
  fetcher: Fetcher;
  cache: PdfCache;
  userAgent: string;
  /** 同一ホストへの要求の最小間隔。既定 1000ms。 */
  minIntervalMs?: number;
  /** 現在時刻（epoch ミリ秒）。テスト用の差し替え口。 */
  now?: () => number;
  /** 待機。テスト用の差し替え口。 */
  sleep?: (ms: number) => Promise<void>;
  /** ホストごとの間隔の記録。省略時はプロセス共通のものを使う。 */
  throttle?: HostThrottle;
}

export interface FetchPdfResult {
  bytes: Uint8Array;
  lastModified?: string;
  /** 304 でキャッシュを返したとき true。 */
  fromCache: boolean;
}

export class PdfFetchError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "PdfFetchError";
    this.url = url;
    this.status = status;
  }
}

/**
 * ホストごとに「次に要求してよい時刻」を予約する。
 * 予約は同期的に行うので、同時に投げた要求も順番に間隔が空く。
 */
export class HostThrottle {
  readonly #next = new Map<string, number>();

  async wait(url: string, minIntervalMs: number, now: () => number, sleep: (ms: number) => Promise<void>) {
    const host = new URL(url).host;
    const t = now();
    const start = Math.max(t, this.#next.get(host) ?? Number.NEGATIVE_INFINITY);
    this.#next.set(host, start + minIntervalMs);
    if (start > t) await sleep(start - t);
  }
}

const sharedThrottle = new HostThrottle();
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * PDF を条件付き GET（If-Modified-Since / If-None-Match）で取得する。304 ならキャッシュを返す。
 * URL の fragment（`#page=N`）は要求にもキャッシュキーにも含めない。
 */
export async function fetchPdf(rawUrl: string, opts: FetchPdfOptions): Promise<FetchPdfResult> {
  const u = new URL(rawUrl);
  u.hash = "";
  const url = u.toString();
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const throttle = opts.throttle ?? sharedThrottle;

  const cached = await opts.cache.get(url);
  const headers: Record<string, string> = { "User-Agent": opts.userAgent };
  if (cached?.lastModified !== undefined) headers["If-Modified-Since"] = cached.lastModified;
  if (cached?.etag !== undefined) headers["If-None-Match"] = cached.etag;

  await throttle.wait(url, opts.minIntervalMs ?? 1000, now, sleep);
  const res = await opts.fetcher(url, headers);
  const h = lowerKeys(res.headers);

  if (res.status === 304) {
    if (cached === undefined) {
      throw new PdfFetchError(`304 Not Modified without a cached copy: ${url}`, url, 304);
    }
    const revalidated: PdfCacheEntry = { ...cached, fetchedAt: now() };
    if (h["last-modified"] !== undefined) revalidated.lastModified = h["last-modified"];
    if (h["etag"] !== undefined) revalidated.etag = h["etag"];
    await opts.cache.put(url, revalidated);
    return result(cached.bytes, revalidated.lastModified, true);
  }

  if (res.status !== 200) {
    throw new PdfFetchError(`HTTP ${res.status} for ${url}`, url, res.status);
  }
  if (!looksLikePdf(res.body)) {
    throw new PdfFetchError(`response is not a PDF: ${url}`, url, res.status);
  }

  const entry: PdfCacheEntry = { bytes: res.body, fetchedAt: now() };
  if (h["last-modified"] !== undefined) entry.lastModified = h["last-modified"];
  if (h["etag"] !== undefined) entry.etag = h["etag"];
  await opts.cache.put(url, entry);
  return result(res.body, entry.lastModified, false);
}

function result(bytes: Uint8Array, lastModified: string | undefined, fromCache: boolean): FetchPdfResult {
  return lastModified === undefined ? { bytes, fromCache } : { bytes, lastModified, fromCache };
}

function lowerKeys(h: Record<string, string>): Record<string, string | undefined> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** 冒頭 1KB 以内に `%PDF-` があるか（仕様上、ヘッダの前にゴミが入ることを許す）。 */
function looksLikePdf(body: Uint8Array): boolean {
  const end = Math.min(body.length, 1024) - PDF_MAGIC.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (body[i + j] !== PDF_MAGIC[j]) continue outer;
    }
    return true;
  }
  return false;
}
