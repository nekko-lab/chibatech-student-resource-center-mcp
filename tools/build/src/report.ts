/** 出力物の名前・SHA256SUMS・build-report.json の形（純関数）。 */
import type { PdfAssetSummary } from "./assets.ts";

/** 全 OS 共通の 1 つ: `<名前>-<version>.mcpb` */
export function mcpbFileName(name: string, version: string): string {
  return `${name}-${version}.mcpb`;
}

/** `llvm-lipo -archs` の出力（空白区切り） */
export function parseLipoArchs(stdout: string): string[] {
  return stdout.split(/\s+/).filter((s) => s.length > 0);
}

export interface SumEntry {
  /** 出力ディレクトリからの相対パス */
  path: string;
  sha256: string;
}

/** `sha256sum -c SHA256SUMS` で検査できる形。パスは / 区切りでパス順。 */
export function formatSha256Sums(entries: readonly SumEntry[]): string {
  return entries
    .map((e) => ({ path: e.path.replace(/\\/g, "/"), sha256: e.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.path}\n`)
    .join("");
}

export interface BuiltFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface CompileReport {
  target: string;
  bunTarget: string;
  compileMs: number;
  bytes: number;
}

export interface OutputReport {
  output: string;
  /** 元になったコンパイル（darwin-universal なら 2 つ） */
  parts: string[];
  /** lipo でまとめた場合の `llvm-lipo -archs` */
  archs?: string[];
  binary: BuiltFile;
}

export interface BuildReport {
  name: string;
  version: string;
  bun: string;
  entry: string;
  darwin: "universal" | "launcher";
  /** playwright-core の書き換えを当てたファイル（エントリが playwright-core を含まなければ空） */
  playwrightCorePatched: string[];
  pdfAssets: PdfAssetSummary;
  compiles: CompileReport[];
  outputs: OutputReport[];
  mcpb: (BuiltFile & { contents: { path: string; from: string; bytes: number }[] }) | null;
}
