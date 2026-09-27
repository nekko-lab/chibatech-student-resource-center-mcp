import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsPdfCache, MemoryPdfCache, nodeFsAdapter, type PdfCache, type PdfCacheEntry } from "../src/index.ts";
import { MemoryFs } from "./helpers/memory-fs.ts";

const URL_A = "https://portal.example.test/portal/a.pdf";
const URL_B = "https://portal.example.test/portal/b.pdf?20260611_01";

function entry(text: string, extra: Partial<PdfCacheEntry> = {}): PdfCacheEntry {
  return { bytes: new TextEncoder().encode(text), fetchedAt: 1_700_000_000_000, ...extra };
}

function contract(name: string, make: () => Promise<PdfCache>) {
  describe(`${name}（PdfCache の共通契約）`, () => {
    it("未登録の URL は undefined", async () => {
      const cache = await make();
      expect(await cache.get(URL_A)).toBeUndefined();
    });

    it("put したものを get で取り出せる（メタデータ込み）", async () => {
      const cache = await make();
      const e = entry("%PDF-1.7 a", { lastModified: "Wed, 10 Jun 2026 00:00:00 GMT", etag: '"abc"' });
      await cache.put(URL_A, e);
      const got = await cache.get(URL_A);
      expect(got).toBeDefined();
      expect(Array.from(got!.bytes)).toEqual(Array.from(e.bytes));
      expect(got!.lastModified).toBe(e.lastModified);
      expect(got!.etag).toBe(e.etag);
      expect(got!.fetchedAt).toBe(e.fetchedAt);
    });

    it("URL ごとに別々に保持し、上書きできる", async () => {
      const cache = await make();
      await cache.put(URL_A, entry("A1"));
      await cache.put(URL_B, entry("B1"));
      await cache.put(URL_A, entry("A2", { fetchedAt: 5 }));
      expect(new TextDecoder().decode((await cache.get(URL_A))!.bytes)).toBe("A2");
      expect((await cache.get(URL_A))!.fetchedAt).toBe(5);
      expect(new TextDecoder().decode((await cache.get(URL_B))!.bytes)).toBe("B1");
    });

    it("lastModified / etag が無いエントリも扱える", async () => {
      const cache = await make();
      await cache.put(URL_A, entry("x"));
      const got = await cache.get(URL_A);
      expect(got!.lastModified).toBeUndefined();
      expect(got!.etag).toBeUndefined();
    });

    it("put 後に呼び出し側が配列を書き換えてもキャッシュは変わらない", async () => {
      const cache = await make();
      const e = entry("abc");
      await cache.put(URL_A, e);
      e.bytes[0] = 0;
      expect(new TextDecoder().decode((await cache.get(URL_A))!.bytes)).toBe("abc");
    });
  });
}

contract("MemoryPdfCache", async () => new MemoryPdfCache());
contract("FsPdfCache + MemoryFs", async () => new FsPdfCache("/cache/pdf", new MemoryFs()));

const tmpDirs: string[] = [];
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});
contract("FsPdfCache + 実ファイルシステム", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pdfx_cache_"));
  tmpDirs.push(dir);
  return new FsPdfCache(join(dir, "nested", "pdf"));
});

describe("FsPdfCache の保存形式", () => {
  it("URL をそのままファイル名にせず、ハッシュ名の .pdf と .json を dir 直下に置く", async () => {
    const fs = new MemoryFs();
    const cache = new FsPdfCache("/cache/pdf/", fs);
    await cache.put(URL_B, entry("%PDF-"));
    const names = [...fs.files.keys()].sort();
    expect(names).toHaveLength(2);
    for (const n of names) expect(n).toMatch(/^\/cache\/pdf\/[0-9a-f]{64}\.(pdf|json)$/);
    expect(fs.dirs.has("/cache/pdf")).toBe(true);
  });

  it("一時ファイルに書いてから改名し、メタデータ（.json）を最後に確定させる", async () => {
    const fs = new MemoryFs();
    await new FsPdfCache("/c", fs).put(URL_A, entry("%PDF-"));
    const renames = fs.log.filter((l) => l.startsWith("rename"));
    expect(renames).toHaveLength(2);
    expect(renames[0]).toMatch(/\.pdf$/);
    expect(renames[1]).toMatch(/\.json$/);
  });

  it("メタデータが壊れている・本体が欠けている・サイズが食い違うときは未登録として扱う", async () => {
    const fs = new MemoryFs();
    const cache = new FsPdfCache("/c", fs);
    await cache.put(URL_A, entry("%PDF-1"));
    const json = [...fs.files.keys()].find((k) => k.endsWith(".json"))!;
    const pdf = [...fs.files.keys()].find((k) => k.endsWith(".pdf"))!;

    fs.files.set(pdf, new TextEncoder().encode("%PDF-1 truncated?"));
    expect(await cache.get(URL_A)).toBeUndefined();

    fs.files.delete(pdf);
    expect(await cache.get(URL_A)).toBeUndefined();

    await cache.put(URL_A, entry("%PDF-1"));
    fs.files.set(json, new TextEncoder().encode("{not json"));
    expect(await cache.get(URL_A)).toBeUndefined();
  });

  it("ハッシュが衝突したとしても、記録された URL が違えば返さない", async () => {
    const fs = new MemoryFs();
    const cache = new FsPdfCache("/c", fs);
    await cache.put(URL_A, entry("%PDF-1"));
    const json = [...fs.files.keys()].find((k) => k.endsWith(".json"))!;
    const meta = JSON.parse(new TextDecoder().decode(fs.files.get(json)!));
    fs.files.set(json, new TextEncoder().encode(JSON.stringify({ ...meta, url: URL_B })));
    expect(await cache.get(URL_A)).toBeUndefined();
  });

  it("nodeFsAdapter は実ディレクトリに 2 ファイルだけを残す（一時ファイルを残さない）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdfx_cache_"));
    tmpDirs.push(dir);
    const cache = new FsPdfCache(dir, nodeFsAdapter());
    await cache.put(URL_A, entry("%PDF-1"));
    await cache.put(URL_A, entry("%PDF-2"));
    expect((await readdir(dir)).length).toBe(2);
  });
});
