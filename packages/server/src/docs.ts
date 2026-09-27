/**
 * PDF・文書の取得と本文の切り出し。
 *
 * - 取得は `@chibatech-src/pdf` の fetchPdf（条件付き GET・同一ホストの間隔制御・キャッシュ）
 * - 取得してよいのはポータルと同じホストだけ（AI が任意の URL を取りに行かないように）
 * - 1 回に返すページ数と文字数に上限を設け、超えたら続きの指定方法（next）を返す
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HostThrottle,
  PdfFetchError,
  extractItems,
  extractText,
  fetchPdf,
  pageCount,
  type Fetcher,
  type PageItems,
  type PageText,
  type PdfCache,
} from "@chibatech-src/pdf";
import { PortalError } from "@chibatech-src/portal";

export interface TextLimits {
  /** 1 回に返す最大ページ数 */
  maxPages: number;
  /** 1 回に返す最大文字数（本文の合計） */
  maxChars: number;
}

export const DEFAULT_TEXT_LIMITS: TextLimits = { maxPages: 8, maxChars: 12_000 };

export interface TextRead {
  url: string;
  title: string;
  pageCount: number;
  pages: PageText[];
  lastModified: string | null;
  /** 上限で切ったとき true */
  truncated: boolean;
  /** 続きを読むときの指定（document_read_text の from / to / charOffset） */
  next?: { from: number; to: number; charOffset?: number };
}

export interface ItemsRead {
  url: string;
  title: string;
  pageCount: number;
  pages: PageItems[];
  lastModified: string | null;
}

export interface Download {
  url: string;
  title: string;
  path: string;
  bytes: number;
  lastModified: string | null;
}

/** マクロが使う文書読み取りの口（テストでは合成データの実装に差し替える） */
export interface DocPort {
  readText(url: string, opts: { from?: number; to?: number; charOffset?: number; limits?: Partial<TextLimits> }): Promise<TextRead>;
  readItems(url: string, opts: { maxPages: number }): Promise<ItemsRead>;
  download(url: string, opts?: { filename?: string }): Promise<Download>;
}

export interface DocumentServiceOptions {
  getFetcher: () => Promise<Fetcher>;
  cache: PdfCache;
  userAgent: string;
  baseUrl: string;
  downloadDir?: string;
  limits?: Partial<TextLimits>;
  /** 同一ホストへの最小間隔（既定 1000ms） */
  minIntervalMs?: number;
}

/** URL のパス末尾（デコード済み）。資料名が分からないときの出典名に使う */
export function fileNameOf(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

/** ファイル名からディレクトリ部分と使えない文字を除く */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "download";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DocumentService implements DocPort {
  readonly #o: DocumentServiceOptions;
  readonly #limits: TextLimits;
  readonly #throttle = new HostThrottle();
  readonly #host: string;

  constructor(o: DocumentServiceOptions) {
    this.#o = o;
    this.#limits = { ...DEFAULT_TEXT_LIMITS, ...o.limits };
    this.#host = new URL(o.baseUrl).host;
  }

  /** 相対 URL をベース URL から解決し、ハッシュを除く。ポータル以外のホストは VALIDATION */
  resolveUrl(raw: string): string {
    let u: URL;
    try {
      u = new URL(raw.trim(), this.#o.baseUrl);
    } catch {
      throw new PortalError("VALIDATION", `URL として読めません: ${raw}`, { url: raw });
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.host !== this.#host) {
      throw new PortalError("VALIDATION", `学生資料室のポータル以外の URL は扱いません: ${u.href}`, {
        url: u.href,
        allowedHost: this.#host,
      });
    }
    u.hash = "";
    return u.href;
  }

  async #fetchPdf(url: string): Promise<{ bytes: Uint8Array; lastModified: string | null }> {
    const r = await fetchPdf(url, {
      fetcher: await this.#o.getFetcher(),
      cache: this.#o.cache,
      userAgent: this.#o.userAgent,
      minIntervalMs: this.#o.minIntervalMs ?? 1000,
      throttle: this.#throttle,
    });
    return { bytes: r.bytes, lastModified: r.lastModified ?? null };
  }

  async readText(
    rawUrl: string,
    opts: { from?: number; to?: number; charOffset?: number; limits?: Partial<TextLimits> } = {},
  ): Promise<TextRead> {
    const url = this.resolveUrl(rawUrl);
    const limits = { ...this.#limits, ...opts.limits };
    const { bytes, lastModified } = await this.#fetchPdf(url);
    const total = await pageCount(bytes);
    const from = Math.max(1, Math.trunc(opts.from ?? 1));
    if (from > total) {
      throw new PortalError("VALIDATION", `ページ ${from} はありません（全 ${total} ページ）`, { url, pageCount: total });
    }
    const to = Math.min(total, Math.max(from, Math.trunc(opts.to ?? total)));
    const last = Math.min(to, from + limits.maxPages - 1);
    const extracted = await extractText(bytes, { from, to: last });

    const pages: PageText[] = [];
    let used = 0;
    let next: TextRead["next"];
    for (const p of extracted) {
      const offset = p.page === from ? Math.max(0, Math.trunc(opts.charOffset ?? 0)) : 0;
      const text = p.text.slice(offset);
      if (used + text.length <= limits.maxChars) {
        pages.push({ page: p.page, text });
        used += text.length;
        continue;
      }
      if (pages.length === 0) {
        // 1 ページ目だけで上限を超える: ページの途中で切り、charOffset で続きを示す
        const part = text.slice(0, limits.maxChars);
        pages.push({ page: p.page, text: part });
        next = { from: p.page, to, charOffset: offset + part.length };
      } else {
        next = { from: p.page, to };
      }
      break;
    }
    if (!next && last < to) next = { from: last + 1, to };
    const out: TextRead = { url, title: fileNameOf(url), pageCount: total, pages, lastModified, truncated: next !== undefined };
    if (next) out.next = next;
    return out;
  }

  async readItems(rawUrl: string, opts: { maxPages: number }): Promise<ItemsRead> {
    const url = this.resolveUrl(rawUrl);
    const { bytes, lastModified } = await this.#fetchPdf(url);
    const total = await pageCount(bytes);
    const pages: PageItems[] = [];
    for (let p = 1; p <= Math.min(total, opts.maxPages); p++) pages.push(await extractItems(bytes, p));
    return { url, title: fileNameOf(url), pageCount: total, pages, lastModified };
  }

  async download(rawUrl: string, opts: { filename?: string } = {}): Promise<Download> {
    const url = this.resolveUrl(rawUrl);
    const dir = this.#o.downloadDir;
    if (!dir) {
      throw new PortalError(
        "VALIDATION",
        "保存先が設定されていません。環境変数 CSRC_DOWNLOAD_DIR（mcpb では保存先の設定）を指定してください",
        { url },
      );
    }
    let bytes: Uint8Array;
    let lastModified: string | null;
    if (/\.pdf$/i.test(new URL(url).pathname)) {
      ({ bytes, lastModified } = await this.#fetchPdf(url));
    } else {
      await this.#throttle.wait(url, this.#o.minIntervalMs ?? 1000, Date.now, sleep);
      const fetcher = await this.#o.getFetcher();
      const res = await fetcher(url, { "User-Agent": this.#o.userAgent });
      if (res.status !== 200) throw new PdfFetchError(`HTTP ${res.status} for ${url}`, url, res.status);
      bytes = res.body;
      const lm = Object.entries(res.headers).find(([k]) => k.toLowerCase() === "last-modified")?.[1];
      lastModified = lm ?? null;
    }
    const name = safeFileName(opts.filename ?? fileNameOf(url));
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, bytes);
    return { url, title: fileNameOf(url), path, bytes: bytes.byteLength, lastModified };
  }
}
