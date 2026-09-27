/**
 * 索引の保存と読み込み。
 *
 * - 保存先は PDF キャッシュと同じディレクトリ（CSRC_CACHE_DIR）の `search-index.v1.json` 1 つ
 * - 中身は PDF ごとの本文（ページ順の文字列）と、作り直しの判断に使う Last-Modified / ETag だけ。
 *   正規化した本文と 2-gram の転置索引は、読み込んだときにメモリで作り直す（ファイルを小さく保つため）
 * - 一時ファイルに書いてから改名する。読めない・形の違うファイルは捨てて空から始める
 * - 書き込みは `@chibatech-src/pdf` の FsAdapter を通す（Node・Bun の両方で動く）
 *
 * 索引は学生本人の PC の中だけに置く。どこにも送らない。
 */
import { nodeFsAdapter, type FsAdapter } from "@chibatech-src/pdf";

export const INDEX_FILE = "search-index.v1.json";
const KIND = "csrc-search-index";
const VERSION = 1;

export interface StoredDoc {
  url: string;
  lastModified: string | null;
  etag: string | null;
  /** 最後に取得して確かめた時刻（epoch ミリ秒） */
  checkedAt: number;
  /** PDF の全ページ数（索引に入れたページ数より多いことがある） */
  pageCount: number;
  /** 1 ページ目からの本文 */
  pages: string[];
}

export interface LoadResult {
  docs: StoredDoc[];
  /** ファイルを捨てたときの理由 */
  discarded?: string;
}

export interface IndexStore {
  /** 保存先（メモリなら null） */
  readonly location: string | null;
  load(): Promise<LoadResult>;
  save(docs: readonly StoredDoc[]): Promise<void>;
}

interface IndexFile {
  v: typeof VERSION;
  kind: typeof KIND;
  savedAt: number;
  docs: StoredDoc[];
}

export function encodeIndex(docs: readonly StoredDoc[], savedAt: number = Date.now()): Uint8Array {
  const body: IndexFile = { v: VERSION, kind: KIND, savedAt, docs: [...docs] };
  return new TextEncoder().encode(JSON.stringify(body));
}

const isStrOrNull = (v: unknown) => v === null || typeof v === "string";

function isStoredDoc(d: unknown): d is StoredDoc {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.url === "string" &&
    isStrOrNull(o.lastModified) &&
    isStrOrNull(o.etag) &&
    typeof o.checkedAt === "number" &&
    typeof o.pageCount === "number" &&
    Array.isArray(o.pages) &&
    o.pages.every((p) => typeof p === "string")
  );
}

/** 索引ファイルを読む。形が違えば undefined */
export function decodeIndex(bytes: Uint8Array): StoredDoc[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const f = parsed as Partial<IndexFile>;
  if (f.v !== VERSION || f.kind !== KIND || !Array.isArray(f.docs)) return undefined;
  if (!f.docs.every(isStoredDoc)) return undefined;
  return f.docs.map((d) => ({
    url: d.url,
    lastModified: d.lastModified,
    etag: d.etag,
    checkedAt: d.checkedAt,
    pageCount: d.pageCount,
    pages: d.pages,
  }));
}

const clone = (d: StoredDoc): StoredDoc => ({ ...d, pages: [...d.pages] });

export class MemoryIndexStore implements IndexStore {
  readonly location = null;
  #docs: StoredDoc[] = [];

  async load(): Promise<LoadResult> {
    return { docs: this.#docs.map(clone) };
  }

  async save(docs: readonly StoredDoc[]): Promise<void> {
    this.#docs = docs.map(clone);
  }
}

export class FsIndexStore implements IndexStore {
  readonly location: string;
  readonly #dir: string;
  readonly #fs: FsAdapter;

  constructor(dir: string, fs: FsAdapter = nodeFsAdapter()) {
    this.#dir = dir.replace(/[\\/]+$/, "");
    this.#fs = fs;
    this.location = `${this.#dir}/${INDEX_FILE}`;
  }

  async load(): Promise<LoadResult> {
    const bytes = await this.#fs.readFile(this.location);
    if (bytes === undefined) return { docs: [] };
    const docs = decodeIndex(bytes);
    if (docs === undefined) return { docs: [], discarded: `索引ファイルを読めないため捨てて作り直します: ${this.location}` };
    return { docs };
  }

  async save(docs: readonly StoredDoc[]): Promise<void> {
    await this.#fs.mkdir(this.#dir);
    const tmp = `${this.location}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}.tmp`;
    await this.#fs.writeFile(tmp, encodeIndex(docs));
    await this.#fs.rename(tmp, this.location);
  }
}
