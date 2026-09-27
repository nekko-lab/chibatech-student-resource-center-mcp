import { joinPath, nodeFsAdapter, type FsAdapter } from "./fs-adapter.ts";

export interface PdfCacheEntry {
  bytes: Uint8Array;
  lastModified?: string;
  etag?: string;
  /** 取得（または 304 で再検証）した時刻。epoch ミリ秒。 */
  fetchedAt: number;
}

export interface PdfCache {
  get(url: string): Promise<PdfCacheEntry | undefined>;
  put(url: string, e: PdfCacheEntry): Promise<void>;
}

function copyEntry(e: PdfCacheEntry): PdfCacheEntry {
  const out: PdfCacheEntry = { bytes: e.bytes.slice(), fetchedAt: e.fetchedAt };
  if (e.lastModified !== undefined) out.lastModified = e.lastModified;
  if (e.etag !== undefined) out.etag = e.etag;
  return out;
}

/** プロセス内だけのキャッシュ。 */
export class MemoryPdfCache implements PdfCache {
  readonly #map = new Map<string, PdfCacheEntry>();

  async get(url: string): Promise<PdfCacheEntry | undefined> {
    const e = this.#map.get(url);
    return e === undefined ? undefined : copyEntry(e);
  }

  async put(url: string, e: PdfCacheEntry): Promise<void> {
    this.#map.set(url, copyEntry(e));
  }
}

interface MetaFile {
  v: 1;
  url: string;
  size: number;
  lastModified?: string;
  etag?: string;
  fetchedAt: number;
}

/**
 * ディレクトリに保存するキャッシュ。URL の SHA-256 を名前にした `<hash>.pdf` と `<hash>.json`（メタデータ）を置く。
 * 一時ファイルに書いてから改名し、メタデータを最後に確定させるので、途中で落ちても壊れたエントリは返さない。
 */
export class FsPdfCache implements PdfCache {
  readonly #dir: string;
  readonly #fs: FsAdapter;

  constructor(dir: string, fs: FsAdapter = nodeFsAdapter()) {
    this.#dir = dir.replace(/[\\/]+$/, "");
    this.#fs = fs;
  }

  async get(url: string): Promise<PdfCacheEntry | undefined> {
    const { pdf, json } = await this.#paths(url);
    const metaBytes = await this.#fs.readFile(json);
    if (metaBytes === undefined) return undefined;
    const meta = parseMeta(metaBytes);
    if (meta === undefined || meta.url !== url) return undefined;
    const bytes = await this.#fs.readFile(pdf);
    if (bytes === undefined || bytes.byteLength !== meta.size) return undefined;
    const e: PdfCacheEntry = { bytes, fetchedAt: meta.fetchedAt };
    if (meta.lastModified !== undefined) e.lastModified = meta.lastModified;
    if (meta.etag !== undefined) e.etag = meta.etag;
    return e;
  }

  async put(url: string, e: PdfCacheEntry): Promise<void> {
    const { pdf, json } = await this.#paths(url);
    const meta: MetaFile = { v: 1, url, size: e.bytes.byteLength, fetchedAt: e.fetchedAt };
    if (e.lastModified !== undefined) meta.lastModified = e.lastModified;
    if (e.etag !== undefined) meta.etag = e.etag;

    await this.#fs.mkdir(this.#dir);
    await this.#atomicWrite(pdf, e.bytes.slice());
    await this.#atomicWrite(json, new TextEncoder().encode(JSON.stringify(meta)));
  }

  async #atomicWrite(path: string, data: Uint8Array): Promise<void> {
    const tmp = `${path}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}.tmp`;
    await this.#fs.writeFile(tmp, data);
    await this.#fs.rename(tmp, path);
  }

  async #paths(url: string): Promise<{ pdf: string; json: string }> {
    const name = await sha256Hex(url);
    return { pdf: joinPath(this.#dir, `${name}.pdf`), json: joinPath(this.#dir, `${name}.json`) };
  }
}

function parseMeta(bytes: Uint8Array): MetaFile | undefined {
  try {
    const m = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MetaFile>;
    if (m.v !== 1 || typeof m.url !== "string" || typeof m.size !== "number" || typeof m.fetchedAt !== "number") {
      return undefined;
    }
    if (m.lastModified !== undefined && typeof m.lastModified !== "string") return undefined;
    if (m.etag !== undefined && typeof m.etag !== "string") return undefined;
    return m as MetaFile;
  } catch {
    return undefined;
  }
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
