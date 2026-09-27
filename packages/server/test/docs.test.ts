import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryPdfCache } from "@chibatech-src/pdf";
import { PortalError } from "@chibatech-src/portal";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentService } from "../src/docs.ts";
import { fakeFetcher, makePdf } from "./helpers/pdf.ts";

const BASE = "https://portal.example.test/portal/";
const PDF = `${BASE}common_2099/life.pdf`;
const LM = "Wed, 01 Apr 2099 00:00:00 GMT";

function service(opts: { maxPages?: number; maxChars?: number; downloadDir?: string } = {}) {
  const pages = Array.from({ length: 12 }, (_, i) => `Fictional page ${i + 1} body`);
  const f = fakeFetcher({
    [PDF]: { body: makePdf(pages), lastModified: LM },
    [`${BASE}whole/web_manual/form.xlsx`]: { body: new TextEncoder().encode("FAKE XLSX"), contentType: "application/octet-stream" },
  });
  const svc = new DocumentService({
    getFetcher: async () => f.fetcher,
    cache: new MemoryPdfCache(),
    userAgent: "test-agent",
    baseUrl: BASE,
    minIntervalMs: 0,
    ...(opts.downloadDir ? { downloadDir: opts.downloadDir } : {}),
    limits: { maxPages: opts.maxPages ?? 5, maxChars: opts.maxChars ?? 10_000 },
  });
  return { svc, f };
}

describe("DocumentService.readText", () => {
  it("指定したページ範囲だけを返し、出典に必要な値を持つ", async () => {
    const { svc, f } = service();
    const r = await svc.readText(`${PDF}#page=3`, { from: 3, to: 4 });
    expect(r.url).toBe(PDF);
    expect(r.title).toBe("life.pdf");
    expect(r.pageCount).toBe(12);
    expect(r.lastModified).toBe(LM);
    expect(r.pages.map((p) => p.page)).toEqual([3, 4]);
    expect(r.pages[0]!.text).toContain("Fictional page 3 body");
    expect(r.next).toBeUndefined();
    expect(f.requests[0]!.headers["User-Agent"]).toBe("test-agent");
  });

  it("相対 URL はベース URL から解決する", async () => {
    const { svc } = service();
    const r = await svc.readText("common_2099/life.pdf", { from: 1, to: 1 });
    expect(r.url).toBe(PDF);
  });

  it("1 回の上限ページ数を超えたら切り、続きの指定方法を返す", async () => {
    const { svc } = service({ maxPages: 5 });
    const r = await svc.readText(PDF, { from: 2 });
    expect(r.pages.map((p) => p.page)).toEqual([2, 3, 4, 5, 6]);
    expect(r.next).toEqual({ from: 7, to: 12 });
    expect(r.truncated).toBe(true);
  });

  it("文字数の上限を超えたらページ単位で切る。1 ページ目で超えたら charOffset で続きを示す", async () => {
    const { svc } = service({ maxChars: 30 });
    const r = await svc.readText(PDF, { from: 1, to: 3 });
    expect(r.pages.map((p) => p.page)).toEqual([1]);
    expect(r.next).toEqual({ from: 2, to: 3 });

    const { svc: tiny } = service({ maxChars: 10 });
    const t = await tiny.readText(PDF, { from: 1, to: 1 });
    expect(t.pages).toEqual([{ page: 1, text: "Fictional " }]);
    expect(t.next).toEqual({ from: 1, to: 1, charOffset: 10 });
    const t2 = await tiny.readText(PDF, { from: 1, to: 1, charOffset: 10 });
    expect(t2.pages[0]!.text.startsWith("page 1 bod")).toBe(true);
  });

  it("範囲外のページは VALIDATION（ページ数を details に）", async () => {
    const { svc } = service();
    const e = await svc.readText(PDF, { from: 20 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PortalError);
    expect((e as PortalError).code).toBe("VALIDATION");
    expect((e as PortalError).details).toMatchObject({ pageCount: 12 });
  });

  it("ポータル以外のホストは取得しない", async () => {
    const { svc, f } = service();
    const e = await svc.readText("https://evil.example.com/x.pdf", {}).catch((x: unknown) => x);
    expect((e as PortalError).code).toBe("VALIDATION");
    expect(f.requests).toHaveLength(0);
  });

  it("2 回目は条件付き GET で、304 ならキャッシュを使う", async () => {
    const { svc, f } = service();
    await svc.readText(PDF, { from: 1, to: 1 });
    const r = await svc.readText(PDF, { from: 2, to: 2 });
    expect(f.requests[1]!.headers["If-Modified-Since"]).toBe(LM);
    expect(r.pages[0]!.text).toContain("page 2");
  });
});

describe("DocumentService.download", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("downloadDir にファイル名で保存し、パスを返す", async () => {
    dir = await mkdtemp(join(tmpdir(), "srv_dl_"));
    const { svc } = service({ downloadDir: dir });
    const r = await svc.download(`${PDF}#page=2`);
    expect(r.path).toBe(join(dir, "life.pdf"));
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.lastModified).toBe(LM);
    expect((await readFile(r.path)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("PDF 以外も保存でき、ファイル名の指定はパスを含めない", async () => {
    dir = await mkdtemp(join(tmpdir(), "srv_dl_"));
    const { svc } = service({ downloadDir: dir });
    const r = await svc.download(`${BASE}whole/web_manual/form.xlsx`, { filename: "../../etc/申請様式.xlsx" });
    expect(r.path).toBe(join(dir, "申請様式.xlsx"));
    expect(await readFile(r.path, "utf8")).toBe("FAKE XLSX");
  });

  it("保存先が未設定なら VALIDATION", async () => {
    const { svc } = service();
    const e = await svc.download(PDF).catch((x: unknown) => x);
    expect((e as PortalError).code).toBe("VALIDATION");
    expect((e as PortalError).message).toMatch(/CSRC_DOWNLOAD_DIR/);
  });

  it("404 は FETCH 相当の例外にする", async () => {
    dir = await mkdtemp(join(tmpdir(), "srv_dl_"));
    const { svc } = service({ downloadDir: dir });
    const e = await svc.download(`${BASE}nothing.pdf`).catch((x: unknown) => x);
    expect((e as Error).name).toBe("PdfFetchError");
  });
});
