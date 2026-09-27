/**
 * `bun build --compile` に渡すプラグインと external の設定。
 *
 * playwright-core の coreBundle.js は package.json と browsers.json を
 * `require(path.join(packageRoot, "..."))` という実行時のパスで読む。バンドルするとビルド機の絶対パスが
 * 埋め込まれ、ビルドした機械では動くのに他の機械では起動できない（poc/README.md の既知リスク 3）。
 * 静的な require に書き換えて、バンドラに JSON を埋め込ませる。
 * 置換が 1 件ずつ当たらなければビルドを止める（playwright-core の更新で黙って壊れないように）。
 */
import { readFile } from "node:fs/promises";
import type { BunPlugin } from "bun";

export interface ReplaceRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

export const PLAYWRIGHT_CORE_RULES: readonly ReplaceRule[] = [
  {
    pattern: /require\(import_path\d+\.default\.join\(packageRoot, "package\.json"\)\)/g,
    replacement: 'require("../package.json")',
  },
  {
    pattern: /require\(import_path\d+\.default\.join\(packageRoot, "browsers\.json"\)\)/g,
    replacement: 'require("../browsers.json")',
  },
];

/** 書き換え対象のファイル（区切りは / と \ の両方）。 */
export const COREBUNDLE_FILTER = /[\\/]playwright-core[\\/]lib[\\/]coreBundle\.js$/;

/**
 * playwright-core は chromium-bidi を同梱せず、BiDi 経路（Firefox など）でだけ遅延 require する。
 * Chromium は CDP で動かすので外部扱いにして、バンドル時の未解決エラーを避ける。
 */
export const EXTERNALS: readonly string[] = ["chromium-bidi", "chromium-bidi/*"];

/** 規則を 1 件ずつ当てる。当たった数が 1 でなければ例外。 */
export function applyRules(source: string, rules: readonly ReplaceRule[], label: string): string {
  let out = source;
  for (const { pattern, replacement } of rules) {
    const hits = out.match(pattern)?.length ?? 0;
    if (hits !== 1) throw new Error(`${label} の書き換え対象 ${pattern} が ${hits} 件（1 件を期待）`);
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function patchPlaywrightCoreSource(source: string): string {
  return applyRules(source, PLAYWRIGHT_CORE_RULES, "coreBundle.js");
}

/** 書き換えたファイルの数を数えられるようにして返す（build-report に残す）。 */
export function playwrightCorePlugin(): { plugin: BunPlugin; patched: () => string[] } {
  const patched: string[] = [];
  const plugin: BunPlugin = {
    name: "patch-playwright-core-static-json",
    setup(build) {
      build.onLoad({ filter: COREBUNDLE_FILTER }, async (args) => {
        const source = await readFile(args.path, "utf8");
        const contents = patchPlaywrightCoreSource(source);
        patched.push(args.path);
        return { contents, loader: "js" };
      });
    },
  };
  return { plugin, patched: () => [...patched] };
}
