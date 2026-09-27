/**
 * 全文検索の索引（プロセスに 1 つ）。PDF ごと・ページごとの本文を持ち、2-gram の転置索引で検索する。
 *
 * - 取得は DocPort.readAllText（DocumentService の条件付き GET・同一ホストの間隔 1 秒・キャッシュ）を通す
 * - 1 回の update で索引作りに使う時間に上限を設ける（既定 25 秒）。上限に達したら残りは pending として返し、
 *   次の呼び出しで続きから作る（MCP クライアントのタイムアウトより先に応答を返すため）
 * - 確かめてから revalidateAfterMs（既定 12 時間）経った PDF は、条件付き GET で版を確かめる。
 *   Last-Modified / ETag が同じなら本文を取り出し直さない
 * - 保存先（IndexStore）があれば、変わったときだけ保存する
 * - 進捗は log（stderr）にだけ出す
 */
import type { DocPort, Validators } from "../docs.ts";
import { BigramIndex, type SourceDoc } from "./bigram.ts";
import type { ParsedTerm } from "./query.ts";
import { searchPages, type SearchResult } from "./rank.ts";
import type { IndexStore, StoredDoc } from "./store.ts";
import { normalizeText } from "./text.ts";

export const DEFAULT_TIME_LIMIT_MS = 25_000;
export const DEFAULT_REVALIDATE_AFTER_MS = 12 * 3600_000;
export const DEFAULT_RETRY_FAILED_AFTER_MS = 10 * 60_000;

export interface CorpusDoc {
  /** ハッシュを除いた PDF の URL */
  url: string;
  /** 資料名 */
  title: string;
}

export interface IndexerOptions {
  store?: IndexStore;
  /** 経過時間の計測（epoch ミリ秒） */
  clock?: () => number;
  log?: (message: string) => void;
  timeLimitMs?: number;
  revalidateAfterMs?: number;
  retryFailedAfterMs?: number;
}

export interface UpdateReport {
  /** コーパスの PDF の本数 */
  total: number;
  /** そのうち索引にある本数 */
  indexed: number;
  /** この呼び出しで本文を取り出した本数 */
  built: number;
  /** この呼び出しで版を確かめ、変わっていなかった本数 */
  revalidated: number;
  /** 時間の上限で手を付けられなかった PDF */
  pending: string[];
  /** 取得できなかった PDF（索引に無いもの） */
  failed: { url: string; title: string; error: string }[];
  /** pending が無い */
  complete: boolean;
}

interface Entry extends StoredDoc {
  norms: string[];
}

type TextSource = Pick<DocPort, "readAllText">;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class DocumentIndex {
  readonly #store: IndexStore | undefined;
  readonly #clock: () => number;
  readonly #log: (m: string) => void;
  readonly #timeLimitMs: number;
  readonly #revalidateAfterMs: number;
  readonly #retryFailedAfterMs: number;
  readonly #docs = new Map<string, Entry>();
  readonly #failed = new Map<string, { at: number; error: string }>();
  #loaded: Promise<void> | undefined;
  #index: BigramIndex | undefined;

  constructor(o: IndexerOptions = {}) {
    this.#store = o.store;
    this.#clock = o.clock ?? Date.now;
    this.#log = o.log ?? (() => undefined);
    this.#timeLimitMs = o.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
    this.#revalidateAfterMs = o.revalidateAfterMs ?? DEFAULT_REVALIDATE_AFTER_MS;
    this.#retryFailedAfterMs = o.retryFailedAfterMs ?? DEFAULT_RETRY_FAILED_AFTER_MS;
  }

  /** 経過時間の計測に使う時計の今（呼び出しの始まりを update の startedAt に渡す） */
  now(): number {
    return this.#clock();
  }

  #set(d: StoredDoc): void {
    this.#docs.set(d.url, { ...d, norms: d.pages.map(normalizeText) });
    this.#index = undefined;
  }

  #load(): Promise<void> {
    this.#loaded ??= (async () => {
      if (!this.#store) return;
      try {
        const r = await this.#store.load();
        if (r.discarded) this.#log(`search_documents: ${r.discarded}`);
        for (const d of r.docs) this.#set(d);
        if (r.docs.length > 0) this.#log(`search_documents: 保存した索引を読み込みました（${r.docs.length} 本）`);
      } catch (e) {
        this.#log(`search_documents: 索引を読み込めないため空から作ります: ${errorText(e)}`);
      }
    })();
    return this.#loaded;
  }

  async #save(): Promise<void> {
    if (!this.#store) return;
    const docs: StoredDoc[] = [...this.#docs.values()].map(({ norms: _norms, ...d }) => d);
    try {
      await this.#store.save(docs);
    } catch (e) {
      this.#log(`search_documents: 索引を保存できませんでした: ${errorText(e)}`);
    }
  }

  #recentlyFailed(url: string, now: number): boolean {
    const f = this.#failed.get(url);
    return f !== undefined && now - f.at < this.#retryFailedAfterMs;
  }

  /** コーパスの PDF を索引に入れる（未作成を先に、次に古くなったものを確かめる）。startedAt から時間の上限まで */
  async update(corpus: readonly CorpusDoc[], source: TextSource, opts: { startedAt: number }): Promise<UpdateReport> {
    await this.#load();
    const now = this.#clock();
    const missing = corpus.filter((d) => !this.#docs.has(d.url) && !this.#recentlyFailed(d.url, now));
    const stale = corpus.filter((d) => {
      const e = this.#docs.get(d.url);
      return e !== undefined && now - e.checkedAt >= this.#revalidateAfterMs && !this.#recentlyFailed(d.url, now);
    });

    let built = 0;
    let revalidated = 0;
    let changed = false;
    const indexedCount = () => corpus.filter((d) => this.#docs.has(d.url)).length;
    for (const d of [...missing, ...stale]) {
      if (this.#clock() - opts.startedAt >= this.#timeLimitMs) break;
      const prev = this.#docs.get(d.url);
      try {
        const known: Validators | undefined = prev ? { lastModified: prev.lastModified, etag: prev.etag } : undefined;
        const r = await source.readAllText(d.url, known ? { known } : {});
        const checkedAt = this.#clock();
        if (r.unchanged && prev) {
          prev.checkedAt = checkedAt;
          revalidated++;
        } else if (!r.unchanged) {
          this.#set({
            url: d.url,
            lastModified: r.lastModified,
            etag: r.etag,
            checkedAt,
            pageCount: r.pageCount,
            pages: pagesInOrder(r.pages),
          });
          built++;
        }
        changed = true;
        this.#failed.delete(d.url);
        this.#log(`search_documents: 索引 ${indexedCount()}/${corpus.length} ${r.unchanged ? "変更なし" : "作成"}: ${d.title}`);
      } catch (e) {
        this.#failed.set(d.url, { at: this.#clock(), error: errorText(e) });
        this.#log(`search_documents: 取得できませんでした: ${d.title} ${d.url}: ${errorText(e)}`);
      }
    }
    if (changed) await this.#save();

    const after = this.#clock();
    const pending = corpus.filter((d) => !this.#docs.has(d.url) && !this.#recentlyFailed(d.url, after)).map((d) => d.url);
    const failed = corpus
      .filter((d) => !this.#docs.has(d.url) && this.#failed.has(d.url) && !pending.includes(d.url))
      .map((d) => ({ url: d.url, title: d.title, error: this.#failed.get(d.url)!.error }));
    return { total: corpus.length, indexed: indexedCount(), built, revalidated, pending, failed, complete: pending.length === 0 };
  }

  /** 索引にある PDF の版とページ数 */
  meta(url: string): { lastModified: string | null; etag: string | null; pageCount: number; indexedPages: number; checkedAt: number } | undefined {
    const e = this.#docs.get(url);
    if (!e) return undefined;
    return { lastModified: e.lastModified, etag: e.etag, pageCount: e.pageCount, indexedPages: e.pages.length, checkedAt: e.checkedAt };
  }

  #bigrams(): BigramIndex {
    if (!this.#index) {
      const docs: SourceDoc[] = [...this.#docs.values()].map((e) => ({
        url: e.url,
        pages: e.pages.map((text, i) => ({ page: i + 1, text, norm: e.norms[i] ?? "" })),
      }));
      this.#index = BigramIndex.build(docs);
    }
    return this.#index;
  }

  /** urls に含まれる PDF の中だけを検索する */
  search(terms: readonly ParsedTerm[], opts: { limit: number; urls: ReadonlySet<string> }): SearchResult {
    return searchPages(this.#bigrams(), terms, { limit: opts.limit, filter: (u) => opts.urls.has(u) });
  }
}

/** 1 ページ目から順の本文（抜けたページは空文字で埋める） */
function pagesInOrder(pages: { page: number; text: string }[]): string[] {
  const out: string[] = [];
  for (const p of pages) {
    while (out.length < p.page - 1) out.push("");
    out[p.page - 1] = p.text;
  }
  return out;
}
