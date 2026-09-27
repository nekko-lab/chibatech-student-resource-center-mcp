/**
 * THIRD_PARTY_NOTICES.txt の生成。単一バイナリに同梱した依存のライセンス本文と著作権表示を集める。
 *
 * - 対象は、バンドルの入力（Bun.build の metafile）のうち node_modules の中にあるファイルのパッケージ。
 *   ワークスペース（packages/*）と poc/ の自前のコードは対象外。
 * - 各パッケージの直下にある LICENSE / NOTICE / COPYING / ThirdPartyNotices の類をそのまま載せる。
 *   1 つも無いパッケージがあれば、呼び出し側でビルドを止める（missing）。
 * - 埋め込んだ pdfjs の CMap（Adobe）と標準フォント（Foxit・Liberation）は、pdfjs-dist の各ディレクトリの
 *   ライセンスファイルを別の節として載せる。
 * - Bun ランタイムは Bun の配布物のライセンス（LICENSE.md）を載せる（cli.ts が --bun-license で受け取る）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export interface NoticeFile {
  name: string;
  text: string;
}

export interface NoticeSection {
  title: string;
  license: string;
  files: NoticeFile[];
}

/** ファイル読み取りの差し替え口（テスト用） */
export interface NoticeFs {
  readdir(dir: string): string[];
  readText(file: string): string;
}

export const nodeNoticeFs: NoticeFs = {
  readdir: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  readText: (file) => readFileSync(file, "utf8"),
};

/** 入力ファイルのパスから、それを含む node_modules のパッケージを求める。 */
export function packageOfPath(file: string): { name: string; root: string } | undefined {
  const norm = file.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const at = norm.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = norm.slice(at + marker.length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0];
  if (name === undefined || name.length === 0 || name.endsWith("/")) return undefined;
  return { name, root: `${norm.slice(0, at + marker.length)}${name}` };
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|third[-_]?party[-_]?notices?)([._-][^/]*)?$/i;

export function isLicenseFileName(name: string): boolean {
  return LICENSE_FILE.test(name) && !/\.(js|mjs|cjs|ts|json)$/i.test(name);
}

function licenseFiles(dir: string, fs: NoticeFs): NoticeFile[] {
  return fs
    .readdir(dir)
    .filter(isLicenseFileName)
    .sort()
    .map((name) => ({ name, text: fs.readText(path.posix.join(dir, name)) }));
}

/** バンドルの入力からパッケージごとの節を作る。ライセンスファイルの無いものは missing に `name@version` で挙げる。 */
export function collectNotices(inputs: readonly string[], fs: NoticeFs = nodeNoticeFs): { sections: NoticeSection[]; missing: string[] } {
  const roots = new Map<string, string>();
  for (const input of inputs) {
    const pkg = packageOfPath(input);
    if (pkg !== undefined && !roots.has(pkg.root)) roots.set(pkg.root, pkg.name);
  }
  const sections: NoticeSection[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const [root, fallbackName] of roots) {
    let meta: { name?: string; version?: string; license?: unknown } = {};
    try {
      meta = JSON.parse(fs.readText(path.posix.join(root, "package.json"))) as typeof meta;
    } catch {
      // package.json の無い入れ子のディレクトリ（dist/esm/package.json だけ等）は名前だけで扱う
    }
    const title = `${meta.name ?? fallbackName}@${meta.version ?? "unknown"}`;
    if (seen.has(title)) continue;
    seen.add(title);
    const license = typeof meta.license === "string" ? meta.license : "UNKNOWN";
    const files = licenseFiles(root, fs);
    if (files.length === 0) missing.push(title);
    else sections.push({ title, license, files });
  }
  sections.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  missing.sort();
  return { sections, missing };
}

/** 埋め込んだ CMap と標準フォントのライセンス。無ければ止める。 */
export function pdfjsAssetLicenseSections(pdfjsDistDir: string, fs: NoticeFs = nodeNoticeFs): NoticeSection[] {
  const dir = pdfjsDistDir.replace(/\\/g, "/");
  const cmaps = licenseFiles(`${dir}/cmaps`, fs);
  const fonts = licenseFiles(`${dir}/standard_fonts`, fs);
  if (cmaps.length === 0) throw new Error(`pdfjs-dist/cmaps のライセンスファイルがありません: ${dir}/cmaps`);
  if (fonts.length === 0) throw new Error(`pdfjs-dist/standard_fonts のライセンスファイルがありません: ${dir}/standard_fonts`);
  return [
    { title: "pdfjs-dist cmaps（埋め込んだ CMap。Adobe）", license: "BSD-3-Clause", files: cmaps },
    { title: "pdfjs-dist standard_fonts（埋め込んだ標準フォント。Foxit・Liberation）", license: "see files", files: fonts },
  ];
}

const RULE = "=".repeat(78);

export function renderNotices(sections: readonly NoticeSection[]): string {
  const out: string[] = [
    "THIRD PARTY NOTICES",
    "",
    "千葉工業大学 学生資料室 MCP（非公式）の単一バイナリ・mcpb に同梱しているソフトウェアのライセンスと著作権表示です。",
    "このツールは非公式で、千葉工業大学および学生資料室の運営者とは関係ありません。",
    "This file lists the licenses and copyright notices of third-party software bundled in this unofficial tool.",
    "",
  ];
  for (const s of sections) {
    out.push(RULE, s.title, `License: ${s.license}`, RULE, "");
    for (const f of s.files) {
      out.push(`--- ${f.name} ---`, "", f.text.replace(/\s+$/, ""), "");
    }
  }
  return `${out.join("\n").replace(/\s+$/, "")}\n`;
}
