import { describe, expect, it } from "vitest";
import { FsIndexStore, INDEX_FILE, MemoryIndexStore, decodeIndex, encodeIndex, type StoredDoc } from "../src/search/store.ts";
import { memoryFs } from "./helpers/memfs.ts";

const DOC: StoredDoc = {
  url: "https://portal.example.test/portal/fic/a.pdf",
  lastModified: "Wed, 01 Apr 2099 00:00:00 GMT",
  etag: null,
  checkedAt: 1000,
  pageCount: 2,
  pages: ["架空の一ページ目", "架空の二ページ目"],
};

describe("encodeIndex / decodeIndex", () => {
  it("往復で同じ中身に戻る", () => {
    expect(decodeIndex(encodeIndex([DOC]))).toEqual([DOC]);
  });

  it.each([
    ["JSON でない", new TextEncoder().encode("{ broken")],
    ["版が違う", new TextEncoder().encode(JSON.stringify({ v: 999, docs: [] }))],
    ["docs が配列でない", new TextEncoder().encode(JSON.stringify({ v: 1, kind: "csrc-search-index", docs: {} }))],
    ["ページが文字列でない", new TextEncoder().encode(JSON.stringify({ v: 1, kind: "csrc-search-index", docs: [{ ...DOC, pages: [1] }] }))],
    ["url が無い", new TextEncoder().encode(JSON.stringify({ v: 1, kind: "csrc-search-index", docs: [{ ...DOC, url: undefined }] }))],
  ])("壊れた索引は undefined（%s）", (_, bytes) => {
    expect(decodeIndex(bytes)).toBeUndefined();
  });
});

describe("FsIndexStore", () => {
  it("ディレクトリに JSON で保存し、読み戻せる（一時ファイルに書いてから改名する）", async () => {
    const fs = memoryFs();
    const store = new FsIndexStore("/cache/", fs);
    expect(store.location).toBe(`/cache/${INDEX_FILE}`);
    expect(await store.load()).toEqual({ docs: [] });
    await store.save([DOC]);
    expect(fs.dirs.has("/cache")).toBe(true);
    expect([...fs.files.keys()]).toEqual([`/cache/${INDEX_FILE}`]);
    expect(fs.writes[0]).toMatch(/\.tmp$/);
    expect(await new FsIndexStore("/cache", fs).load()).toEqual({ docs: [DOC] });
  });

  it("壊れた索引ファイルは捨てて空から始め、理由を返す", async () => {
    const fs = memoryFs();
    fs.files.set(`/cache/${INDEX_FILE}`, new TextEncoder().encode("\u0000garbage"));
    const r = await new FsIndexStore("/cache", fs).load();
    expect(r.docs).toEqual([]);
    expect(r.discarded).toMatch(/読めない/);
  });
});

describe("MemoryIndexStore", () => {
  it("保存したものを返す（複製して持つ）", async () => {
    const store = new MemoryIndexStore();
    const docs = [{ ...DOC, pages: [...DOC.pages] }];
    await store.save(docs);
    docs[0]!.pages[0] = "書き換え";
    expect((await store.load()).docs).toEqual([DOC]);
    expect(store.location).toBeNull();
  });
});
