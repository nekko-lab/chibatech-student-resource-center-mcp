import { describe, expect, it } from "vitest";
import { DocumentIndex, type CorpusDoc } from "../src/search/indexer.ts";
import { parseQuery } from "../src/search/query.ts";
import { FsIndexStore, INDEX_FILE, MemoryIndexStore } from "../src/search/store.ts";
import { memoryFs } from "./helpers/memfs.ts";
import { BASE, fakeDocs } from "./helpers/ports.ts";

const url = (n: number) => `${BASE}fic/doc${n}.pdf`;
const corpus = (n: number): CorpusDoc[] => Array.from({ length: n }, (_, i) => ({ url: url(i + 1), title: `架空資料${i + 1}` }));

function setup(n: number, opts: { secondsPerDoc?: number; store?: MemoryIndexStore | FsIndexStore } = {}) {
  let t = 0;
  const docs = fakeDocs();
  for (let i = 1; i <= n; i++) docs.texts.set(url(i), [`架空資料${i}の一ページ目`, `架空資料${i}の追試の案内`]);
  docs.beforeReadAll = () => {
    t += (opts.secondsPerDoc ?? 0) * 1000;
  };
  const logs: string[] = [];
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const make = () =>
    new DocumentIndex({ clock: clock.now, log: (m) => logs.push(m), ...(opts.store ? { store: opts.store } : {}) });
  return { docs, clock, logs, make };
}

const hitsOf = (idx: DocumentIndex, q: string, urls: string[]) =>
  idx.search(parseQuery(q), { limit: 20, urls: new Set(urls) }).hits.map((h) => `${h.ref.url.slice(BASE.length)}#${h.ref.page}`);

describe("DocumentIndex", () => {
  it("コーパスの PDF をページごとに索引へ入れ、対象の資料の中だけを検索する", async () => {
    const { docs, make, clock } = setup(3);
    const idx = make();
    const r = await idx.update(corpus(3), docs, { startedAt: clock.now() });
    expect(r).toMatchObject({ total: 3, indexed: 3, built: 3, complete: true, pending: [], failed: [] });
    expect(hitsOf(idx, "追試", [url(1), url(3)])).toEqual(["fic/doc1.pdf#2", "fic/doc3.pdf#2"]);
    expect(idx.meta(url(2))).toMatchObject({ lastModified: expect.any(String), pageCount: 2 });
  });

  it("時間の上限に達したら途中で止め、次の呼び出しで続きから作る", async () => {
    const { docs, make, clock, logs } = setup(5, { secondsPerDoc: 10 });
    const idx = make();
    const first = await idx.update(corpus(5), docs, { startedAt: clock.now() });
    // 0s・10s・20s に始めた 3 本を作ったところで 30s（上限 25s 超え）
    expect(first).toMatchObject({ total: 5, indexed: 3, built: 3, complete: false });
    expect(first.pending).toEqual([url(4), url(5)]);
    expect(hitsOf(idx, "追試", corpus(5).map((d) => d.url))).toHaveLength(3);
    expect(logs.some((l) => /3\/5/.test(l))).toBe(true);

    const second = await idx.update(corpus(5), docs, { startedAt: clock.now() });
    expect(second).toMatchObject({ indexed: 5, built: 2, complete: true, pending: [] });
    expect(docs.extractions).toEqual([1, 2, 3, 4, 5].map(url));
  });

  it("時間の上限は変えられる", async () => {
    const { docs, clock } = setup(5, { secondsPerDoc: 10 });
    const idx = new DocumentIndex({ clock: clock.now, timeLimitMs: 5_000 });
    expect((await idx.update(corpus(5), docs, { startedAt: clock.now() })).built).toBe(1);
  });

  it("確かめてから時間が経っていなければ取得し直さない。経っていれば条件付きで確かめ、Last-Modified が同じなら作り直さない", async () => {
    const { docs, make, clock } = setup(2);
    const idx = make();
    await idx.update(corpus(2), docs, { startedAt: clock.now() });
    docs.calls.length = 0;

    clock.advance(60_000);
    await idx.update(corpus(2), docs, { startedAt: clock.now() });
    expect(docs.calls).toEqual([]);

    clock.advance(13 * 3600_000);
    const r = await idx.update(corpus(2), docs, { startedAt: clock.now() });
    expect(docs.calls).toEqual([`all ${url(1)}`, `all ${url(2)}`]);
    expect(r).toMatchObject({ built: 0, revalidated: 2 });
    expect(docs.extractions).toEqual([url(1), url(2)]);
  });

  it("Last-Modified が変わった PDF だけ作り直す", async () => {
    const { docs, make, clock } = setup(2);
    const idx = make();
    await idx.update(corpus(2), docs, { startedAt: clock.now() });
    clock.advance(13 * 3600_000);
    docs.lastModified.set(url(2), "Thu, 02 Apr 2099 00:00:00 GMT");
    docs.texts.set(url(2), ["架空の学割の案内に差し替え"]);
    const r = await idx.update(corpus(2), docs, { startedAt: clock.now() });
    expect(r).toMatchObject({ built: 1, revalidated: 1 });
    expect(docs.extractions).toEqual([url(1), url(2), url(2)]);
    expect(hitsOf(idx, "学割", [url(1), url(2)])).toEqual(["fic/doc2.pdf#1"]);
    expect(hitsOf(idx, "追試", [url(1), url(2)])).toEqual(["fic/doc1.pdf#2"]);
  });

  it("取得できない PDF は failed に入れて先へ進む（pending には残さない）", async () => {
    const { docs, make, clock } = setup(2);
    const idx = make();
    const r = await idx.update([...corpus(2), { url: `${BASE}fic/missing.pdf`, title: "架空の欠番" }], docs, { startedAt: clock.now() });
    expect(r).toMatchObject({ total: 3, indexed: 2, complete: true, pending: [] });
    expect(r.failed).toEqual([{ url: `${BASE}fic/missing.pdf`, title: "架空の欠番", error: expect.stringMatching(/NOT_FOUND|合成データ/) }]);
  });

  it("保存先があれば索引を保存し、次のプロセスでは読み込んで取得し直さない", async () => {
    const fs = memoryFs();
    const store = new FsIndexStore("/cache", fs);
    const { docs, make, clock } = setup(2, { store });
    await make().update(corpus(2), docs, { startedAt: clock.now() });
    expect(fs.files.has(`/cache/${INDEX_FILE}`)).toBe(true);

    docs.calls.length = 0;
    const idx2 = make();
    const r = await idx2.update(corpus(2), docs, { startedAt: clock.now() });
    expect(r).toMatchObject({ indexed: 2, built: 0, complete: true });
    expect(docs.calls).toEqual([]);
    expect(hitsOf(idx2, "追試", [url(1), url(2)])).toHaveLength(2);
  });

  it("壊れた索引ファイルは捨てて作り直し、stderr 向けの記録に残す", async () => {
    const fs = memoryFs();
    fs.files.set(`/cache/${INDEX_FILE}`, new TextEncoder().encode("{ not json"));
    const store = new FsIndexStore("/cache", fs);
    const { docs, make, clock, logs } = setup(2, { store });
    const r = await make().update(corpus(2), docs, { startedAt: clock.now() });
    expect(r).toMatchObject({ built: 2, complete: true });
    expect(logs.some((l) => /捨て/.test(l))).toBe(true);
    const saved = JSON.parse(new TextDecoder().decode(fs.files.get(`/cache/${INDEX_FILE}`)!)) as { docs: unknown[] };
    expect(saved.docs).toHaveLength(2);
  });

  it("何も変わらなければ保存し直さない", async () => {
    const fs = memoryFs();
    const store = new FsIndexStore("/cache", fs);
    const { docs, make, clock } = setup(1, { store });
    const idx = make();
    await idx.update(corpus(1), docs, { startedAt: clock.now() });
    const writes = fs.writes.length;
    await idx.update(corpus(1), docs, { startedAt: clock.now() });
    expect(fs.writes.length).toBe(writes);
  });
});
