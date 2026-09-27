/**
 * テスト用の合成 PDF と、それを返す差し替え Fetcher。
 *
 * PDF は ASCII の本文だけを持つ最小構成（Helvetica・非埋め込み）。本文はすべて架空。
 */
import type { Fetcher } from "@chibatech-src/pdf";

/** 1 ページ 1 行ずつ、`pages[i]` を本文にした PDF を作る */
export function makePdf(pages: string[]): Uint8Array {
  const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/[()\\]/g, "");
  const n = pages.length;
  // 1: Catalog, 2: Pages, 3: Font, 4..: Page / Contents の組
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((text, i) => {
    const stream = `BT /F1 10 Tf 20 60 Td (${clean(text)}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export interface FakeFile {
  body: Uint8Array;
  contentType?: string;
  lastModified?: string;
}

export interface FakeFetcher {
  fetcher: Fetcher;
  /** 要求された URL（到着順） */
  requests: { url: string; headers: Record<string, string> }[];
  files: Map<string, FakeFile>;
}

/**
 * URL（クエリ込み・ハッシュ無し）→ ファイルの対応で応答する Fetcher。
 * 無い URL は `fallback` があればそれを、無ければ 404 を返す。If-Modified-Since が一致すれば 304。
 */
export function fakeFetcher(entries: Record<string, FakeFile> = {}, fallback?: (url: string) => FakeFile | undefined): FakeFetcher {
  const files = new Map(Object.entries(entries));
  const requests: FakeFetcher["requests"] = [];
  const fetcher: Fetcher = async (url, headers) => {
    requests.push({ url, headers });
    const f = files.get(url) ?? fallback?.(url);
    if (!f) return { status: 404, headers: { "content-type": "text/html" }, body: new TextEncoder().encode("not found") };
    const h: Record<string, string> = { "content-type": f.contentType ?? "application/pdf" };
    if (f.lastModified) h["last-modified"] = f.lastModified;
    const ims = Object.entries(headers).find(([k]) => k.toLowerCase() === "if-modified-since")?.[1];
    if (f.lastModified && ims === f.lastModified) return { status: 304, headers: h, body: new Uint8Array() };
    return { status: 200, headers: h, body: f.body };
  };
  return { fetcher, requests, files };
}
