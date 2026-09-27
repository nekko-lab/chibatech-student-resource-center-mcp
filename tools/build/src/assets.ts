/**
 * pdfjs の付属データ（定義済み CMap・標準フォント）を単一バイナリに埋め込む。
 *
 * 単一バイナリの中では pdfjs-dist の場所を引けず、日本語 PDF の本文が欠ける（学生便覧で約 12%）。
 * `pdfjs-dist/cmaps/` と `standard_fonts/` のファイルを `with { type: "file" }` で import する
 * 起動前処理モジュールを生成し、起動時に `@chibatech-src/pdf` の `setPdfAssets` へ渡す。
 * 読むのは要求された時点（pdfjs が必要とした CMap だけ）なので、起動時間はほとんど変わらない。
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export type PdfAssetKind = "cMap" | "standardFont";

export interface PdfAssetFile {
  readonly kind: PdfAssetKind;
  readonly name: string;
  /** ビルド機での絶対パス（import の指定子に使う） */
  readonly path: string;
  readonly bytes: number;
}

export interface ListedFile {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
}

/** 日本語の本文抽出に必須の CMap。これが無い pdfjs-dist では止める。 */
export const REQUIRED_CMAPS: readonly string[] = ["UniJIS-UCS2-H.bcmap", "Adobe-Japan1-UCS2.bcmap"];

const CMAP_EXT = /\.bcmap$/;
const FONT_EXT = /\.(pfb|ttf)$/;

/** 付属データのうち埋め込む対象だけを選び、種類 → 名前の順に並べる。LICENSE などは除く。 */
export function selectPdfAssets(listing: { cMaps: readonly ListedFile[]; standardFonts: readonly ListedFile[] }): PdfAssetFile[] {
  const pick = (kind: PdfAssetKind, files: readonly ListedFile[], ext: RegExp): PdfAssetFile[] =>
    files
      .filter((f) => ext.test(f.name))
      .map((f) => ({ kind, name: f.name, path: f.path, bytes: f.bytes }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const cMaps = pick("cMap", listing.cMaps, CMAP_EXT);
  const fonts = pick("standardFont", listing.standardFonts, FONT_EXT);
  const names = new Set(cMaps.map((f) => f.name));
  const missing = REQUIRED_CMAPS.filter((n) => !names.has(n));
  if (missing.length > 0) throw new Error(`pdfjs-dist に必要な CMap がありません: ${missing.join(", ")}`);
  if (fonts.length === 0) throw new Error("pdfjs-dist に標準フォントがありません");
  return [...cMaps, ...fonts];
}

/** pdfjs-dist のパッケージディレクトリから列挙する（ビルド機の上で動く）。 */
export function collectPdfAssets(pdfjsDistDir: string): PdfAssetFile[] {
  const list = (sub: string): ListedFile[] => {
    const dir = path.resolve(pdfjsDistDir, sub);
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => {
        const p = path.join(dir, d.name);
        return { name: d.name, path: p, bytes: statSync(p).size };
      });
  };
  return selectPdfAssets({ cMaps: list("cmaps"), standardFonts: list("standard_fonts") });
}

export interface PdfAssetSummary {
  cMaps: { count: number; bytes: number };
  standardFonts: { count: number; bytes: number };
  totalBytes: number;
  files: { kind: PdfAssetKind; name: string; bytes: number }[];
}

export function summarizePdfAssets(files: readonly PdfAssetFile[]): PdfAssetSummary {
  const sum = (kind: PdfAssetKind) => {
    const of = files.filter((f) => f.kind === kind);
    return { count: of.length, bytes: of.reduce((n, f) => n + f.bytes, 0) };
  };
  const cMaps = sum("cMap");
  const standardFonts = sum("standardFont");
  return {
    cMaps,
    standardFonts,
    totalBytes: cMaps.bytes + standardFonts.bytes,
    files: files.map((f) => ({ kind: f.kind, name: f.name, bytes: f.bytes })),
  };
}

export interface PreambleOptions {
  /** `@chibatech-src/pdf` の実体（ビルド機での絶対パス）。エントリ側と同じモジュールに解決されること */
  pdfModule: string;
  /** `runtime-assets.ts` の絶対パス */
  runtimeModule: string;
  files: readonly PdfAssetFile[];
}

/**
 * 起動前処理モジュールのソースを作る。エントリより先に評価されるよう、
 * 生成した入口（cli.ts）で最初に import する。
 */
export function renderPreamble(opts: PreambleOptions): string {
  const q = (s: string) => JSON.stringify(s);
  const lines: string[] = [
    "// 自動生成（tools/build/src/assets.ts）。pdfjs の CMap・標準フォントを単一バイナリに埋め込み、起動時に setPdfAssets へ渡す。",
    'import { readFile } from "node:fs/promises";',
    `import { setPdfAssets } from ${q(opts.pdfModule)};`,
    `import { embeddedPdfAssets } from ${q(opts.runtimeModule)};`,
  ];
  opts.files.forEach((f, i) => lines.push(`import asset${i} from ${q(f.path)} with { type: "file" };`));
  const table = (kind: PdfAssetKind) =>
    opts.files
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.kind === kind)
      .map(({ f, i }) => `    ${q(f.name)}: asset${i},`);
  lines.push(
    "",
    "setPdfAssets(embeddedPdfAssets({",
    "  cMaps: {",
    ...table("cMap"),
    "  },",
    "  standardFonts: {",
    ...table("standardFont"),
    "  },",
    "}, (p) => readFile(p)));",
    "",
  );
  return lines.join("\n");
}
