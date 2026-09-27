/** 出力物の名前・SHA256SUMS・build-report.json の形（純関数）。 */
import type { PdfAssetSummary } from "./assets.ts";

/** 全 OS 共通の 1 つ: `<名前>-<version>.mcpb` */
export function mcpbFileName(name: string, version: string): string {
  return `${name}-${version}.mcpb`;
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

export interface TargetReport {
  target: string;
  bunTarget: string;
  compileMs: number;
  binary: BuiltFile;
}

export interface BuildReport {
  name: string;
  version: string;
  bun: string;
  entry: string;
  /** macOS 用の署名。Bun が付ける ad-hoc 署名のまま（公証なし） */
  darwinSigning: "bun-adhoc";
  /** playwright-core の書き換えを当てたファイル（エントリが playwright-core を含まなければ空） */
  playwrightCorePatched: string[];
  /** 版を --version に差し替えたファイル（packages/server/src/version.ts。含まれなければ空） */
  versionPatched: string[];
  pdfAssets: PdfAssetSummary;
  targets: TargetReport[];
  /** mcpb の tools に載せた一覧（<out>/tools.json）。source はサーバの toolDefinitions() か --tools のパス。mcpb を作らなければ null */
  tools: { path: string; source: string; count: number; names: string[] } | null;
  mcpb: (BuiltFile & { contents: { path: string; from: string; bytes: number }[] }) | null;
  /** THIRD_PARTY_NOTICES.txt と、載せた節の見出し */
  notices: BuiltFile & { sections: string[] };
  /** リポジトリの LICENSE（無ければ null。警告して続ける） */
  license: BuiltFile | null;
}
