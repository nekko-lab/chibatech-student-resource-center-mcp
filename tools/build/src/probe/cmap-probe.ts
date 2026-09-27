/**
 * 検証用のエントリ: 単一バイナリの中から、埋め込んだ CMap・標準フォントが setPdfAssets 経由で読めるかを確かめる。
 *
 * cli.ts でビルドすると、このモジュールより先に起動前処理（埋め込み資産の setPdfAssets）が評価される。
 * 合成 PDF（非埋め込みの日本語フォント + UniJIS-UCS2-H、Helvetica）をメモリ上で作って本文を抽出し、
 * 埋め込み資産ありでは日本語が読め、資産なし（noPdfAssets）では読めないことを比べる。
 * サイトにはアクセスしない。結果は JSON 1 行を stdout に出し、合否を終了コードで返す。
 */
import { extractText, getPdfAssets, noPdfAssets, setPdfAssets, type PdfAssets } from "@chibatech-src/pdf";

const EXPECTED = "学生資料室";
const LATIN = "Hello";

/** 非埋め込みの CID フォント（Adobe-Japan1）を UniJIS-UCS2-H で使う 1 ページの PDF。 */
function syntheticPdf(): Uint8Array {
  const hex = Array.from(EXPECTED, (c) => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join("");
  const content = `BT /F1 24 Tf 20 120 Td <${hex}> Tj ET\nBT /F2 12 Tf 20 60 Td (${LATIN}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /FontDescriptor 8 0 R /DW 1000 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // 本文は ASCII だけなので、1 文字 = 1 バイト
  return new TextEncoder().encode(body);
}

interface Requested {
  kind: "cMap" | "standardFont";
  name: string;
  bytes: number | null;
}

function recording(inner: PdfAssets, log: Requested[]): PdfAssets {
  const wrap = (kind: Requested["kind"], get: (n: string) => Promise<Uint8Array | undefined>) => async (name: string) => {
    const data = await get(name);
    log.push({ kind, name, bytes: data?.byteLength ?? null });
    return data;
  };
  return { cMap: wrap("cMap", (n) => inner.cMap(n)), standardFont: wrap("standardFont", (n) => inner.standardFont(n)) };
}

async function textWith(assets: PdfAssets): Promise<string> {
  setPdfAssets(assets);
  try {
    const pages = await extractText(syntheticPdf());
    return pages.map((p) => p.text).join("\n");
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main(): Promise<number> {
  // 起動前処理が setPdfAssets した資産（このモジュールの評価時点で差し替わっていること）
  const embedded = getPdfAssets();
  const direct: Record<string, number | null> = {};
  for (const name of ["UniJIS-UCS2-H.bcmap", "Adobe-Japan1-UCS2.bcmap"]) direct[name] = (await embedded.cMap(name))?.byteLength ?? null;
  for (const name of ["LiberationSans-Regular.ttf", "FoxitSerif.pfb"]) direct[name] = (await embedded.standardFont(name))?.byteLength ?? null;

  const requested: Requested[] = [];
  const withAssets = await textWith(recording(embedded, requested));
  const withoutAssets = await textWith(noPdfAssets);
  setPdfAssets(embedded);

  const checks = {
    directReads: Object.values(direct).every((n) => n !== null && n > 0),
    japaneseWithAssets: withAssets.includes(EXPECTED),
    latinWithAssets: withAssets.includes(LATIN),
    cMapRequested: requested.some((r) => r.kind === "cMap" && r.name === "UniJIS-UCS2-H.bcmap" && (r.bytes ?? 0) > 0),
    allRequestsServed: requested.length > 0 && requested.every((r) => r.bytes !== null && r.bytes > 0),
    japaneseMissingWithoutAssets: !withoutAssets.includes(EXPECTED),
  };
  const ok = Object.values(checks).every(Boolean);
  process.stdout.write(`${JSON.stringify({ ok, checks, direct, requested, withAssets, withoutAssets })}\n`);
  return ok ? 0 : 1;
}

// cli.ts は生成した入口からこのモジュールを import するので、import.meta.main は偽になる。条件を付けずに走らせる。
process.exit(await main());
