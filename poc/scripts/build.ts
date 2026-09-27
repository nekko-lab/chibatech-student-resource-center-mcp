/**
 * 全ターゲットのクロスコンパイルと mcpb（binary 型）の組み立て。
 *
 *   out/csrc-poc-server-<os>-<arch>[.exe]   MCP サーバ本体（単一バイナリ）
 *   out/csrc-poc-smoke-<os>-<arch>[.exe]    スモーク検査（これも単一バイナリ。ランナーに追加導入不要）
 *   out/csrc-poc-server-<host>-nopatch      playwright-core を無加工でバンドルした比較用（既知リスク 3 の確認）
 *   out/mcpb/csrc-poc-<os>-<arch>.mcpb       mcpb パッケージ
 *   out/build-report.json                   サイズなどの記録
 *
 * 使い方: bun run scripts/build.ts [--only linux-arm64,linux-x64] [--no-mcpb]
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'out');

interface Target {
  key: string;
  bunTarget: string;
  platform: 'linux' | 'darwin' | 'win32';
  exe: string;
}

const TARGETS: Target[] = [
  { key: 'linux-x64', bunTarget: 'bun-linux-x64', platform: 'linux', exe: '' },
  { key: 'linux-arm64', bunTarget: 'bun-linux-arm64', platform: 'linux', exe: '' },
  { key: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', platform: 'darwin', exe: '' },
  { key: 'darwin-x64', bunTarget: 'bun-darwin-x64', platform: 'darwin', exe: '' },
  { key: 'windows-x64', bunTarget: 'bun-windows-x64', platform: 'win32', exe: '.exe' },
];

/**
 * 既知リスク 3 の回避: playwright-core の coreBundle.js は package.json と browsers.json を
 * `require(path.join(packageRoot, "..."))` という実行時パスで読む。単一バイナリの中では
 * packageRoot が仮想 FS を指すため読めない。静的な require に書き換えてバンドラに埋め込ませる。
 * 置換が 1 件ずつ当たらなければビルドを止める（playwright-core の更新で黙って壊れないように）。
 */
const patchPlaywrightCore: BunPlugin = {
  name: 'patch-playwright-core-static-json',
  setup(build) {
    build.onLoad({ filter: /playwright-core[\\/]lib[\\/]coreBundle\.js$/ }, async (args) => {
      let source = await Bun.file(args.path).text();
      const rules: [RegExp, string][] = [
        [/require\(import_path\d+\.default\.join\(packageRoot, "package\.json"\)\)/g, 'require("../package.json")'],
        [/require\(import_path\d+\.default\.join\(packageRoot, "browsers\.json"\)\)/g, 'require("../browsers.json")'],
      ];
      for (const [pattern, replacement] of rules) {
        const hits = source.match(pattern)?.length ?? 0;
        if (hits !== 1) throw new Error(`coreBundle.js の書き換え対象 ${pattern} が ${hits} 件（1 件を期待）`);
        source = source.replace(pattern, replacement);
      }
      return { contents: source, loader: 'js' };
    });
  },
};

async function compile(entry: string, target: Target, outfile: string, patch: boolean): Promise<void> {
  const result = await Bun.build({
    entrypoints: [path.join(ROOT, entry)],
    compile: { target: target.bunTarget as any, outfile },
    minify: true,
    sourcemap: 'none',
    plugins: patch ? [patchPlaywrightCore] : [],
    // playwright-core は chromium-bidi を同梱せず、BiDi 経路（Firefox 等）でだけ遅延 require する。
    // Chromium は CDP で動かすので外部扱いにして、バンドル時の未解決エラーを避ける。
    external: ['chromium-bidi', 'chromium-bidi/*'],
  } as any);
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error(`compile 失敗: ${entry} (${target.key})`);
  }
  if (!existsSync(outfile)) throw new Error(`出力がありません: ${outfile}`);
  if (target.platform !== 'win32') chmodSync(outfile, 0o755);
}

function hostTarget(): Target {
  const key = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const t = TARGETS.find((x) => x.key === key);
  if (!t) throw new Error(`未対応のホスト: ${key}`);
  return t;
}

const TOOLS = [
  { name: 'portal_search', description: '（非公式）区分・入学年度・学科で検索し、遷移先 URL と節の数を返す' },
  { name: 'portal_list_sections', description: '（非公式）現在の学科ページの節と PDF リンクを返す' },
  { name: 'document_read_text', description: '（非公式）PDF の指定ページの本文を抽出する' },
];

function writeMcpb(target: Target, serverFile: string): string {
  const stage = path.join(OUT, 'mcpb', `.stage-${target.key}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(path.join(stage, 'server'), { recursive: true });
  const binName = `csrc-poc-server${target.exe}`;
  copyFileSync(serverFile, path.join(stage, 'server', binName));
  if (target.platform !== 'win32') chmodSync(path.join(stage, 'server', binName), 0o755);
  const manifest = {
    manifest_version: '0.2',
    name: 'chibatech-src-mcp-poc',
    display_name: '千葉工業大学 学生資料室 MCP（非公式・PoC）',
    version: '0.0.0',
    description: '非公式ツールの成立性検証版。大学とは無関係です。学生資料室の検索と PDF 本文の抽出を行います。',
    author: { name: 'nekko-lab' },
    repository: { type: 'git', url: 'https://github.com/nekko-lab/chibatech-student-resource-center-mcp' },
    server: {
      type: 'binary',
      entry_point: `server/${binName}`,
      mcp_config: { command: `\${__dirname}/server/${binName}`, args: [] as string[] },
    },
    tools: TOOLS,
    compatibility: { platforms: [target.platform] },
  };
  writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const mcpbPath = path.join(OUT, 'mcpb', `csrc-poc-${target.key}.mcpb`);
  rmSync(mcpbPath, { force: true });
  const zip = spawnSync('zip', ['-q', '-r', '-X', mcpbPath, 'manifest.json', 'server'], { cwd: stage, stdio: 'inherit' });
  if (zip.status !== 0) throw new Error(`zip 失敗 (${target.key})`);
  rmSync(stage, { recursive: true, force: true });
  return mcpbPath;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const onlyIndex = argv.indexOf('--only');
  const only = onlyIndex >= 0 ? new Set(argv[onlyIndex + 1].split(',')) : undefined;
  const withMcpb = !argv.includes('--no-mcpb');
  const targets = TARGETS.filter((t) => only === undefined || only.has(t.key));

  mkdirSync(path.join(OUT, 'mcpb'), { recursive: true });
  const report: Record<string, unknown>[] = [];

  for (const target of targets) {
    const server = path.join(OUT, `csrc-poc-server-${target.key}${target.exe}`);
    const smoke = path.join(OUT, `csrc-poc-smoke-${target.key}${target.exe}`);
    const t0 = Date.now();
    await compile('src/launcher.ts', target, server, true);
    const serverMs = Date.now() - t0;
    await compile('smoke/smoke.ts', target, smoke, false);
    const entry: Record<string, unknown> = {
      target: target.key,
      bunTarget: target.bunTarget,
      serverBytes: statSync(server).size,
      smokeBytes: statSync(smoke).size,
      compileMs: serverMs,
    };
    if (withMcpb) {
      const mcpb = writeMcpb(target, server);
      entry.mcpbBytes = statSync(mcpb).size;
    }
    report.push(entry);
    console.log(`built ${target.key}: server ${(Number(entry.serverBytes) / 1e6).toFixed(1)} MB`);
  }

  // 比較用: 無加工バンドル（ホスト向けのみ）
  const host = hostTarget();
  const nopatch = path.join(OUT, `csrc-poc-server-${host.key}-nopatch${host.exe}`);
  await compile('src/launcher.ts', host, nopatch, false);
  report.push({ target: `${host.key}-nopatch`, serverBytes: statSync(nopatch).size });

  writeFileSync(path.join(OUT, 'build-report.json'), `${JSON.stringify({ bun: Bun.version, report }, null, 2)}\n`);
}

await main();
