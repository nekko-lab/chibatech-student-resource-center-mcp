/**
 * 単一バイナリと mcpb（binary 型）のビルド。Bun で実行する。
 *
 *   bun run tools/build/src/cli.ts --entry <file> --out <dir> --version <x.y.z> --tools <tools.json> \
 *     [--targets a,b] [--baseline] [--name <名前>] [--no-mcpb] [--darwin universal|launcher] [--keep-slices]
 *
 * 出力:
 *   <out>/bin/<名前>-<出力>[.exe]      単体バイナリ（既定: darwin-universal・windows-x64・linux-x64・linux-arm64）
 *   <out>/mcpb/<名前>-<version>.mcpb  mcpb（全 OS 共通の 1 つ。macOS のユニバーサル + Windows x64）
 *   <out>/SHA256SUMS                  上の 2 種類のハッシュ（sha256sum -c で検査できる）
 *   <out>/build-report.json           サイズ・埋め込んだ資産・書き換え・lipo の記録
 *   <out>/slices/                     --keep-slices のときだけ。lipo 前の 2 つと launch.sh（代替の検証用）
 *
 * エントリの前に、pdfjs の CMap・標準フォントを埋め込んで setPdfAssets へ渡す起動前処理を差し込む。
 * エントリ自身は何も import しなくてよい（生成した入口が「起動前処理 → エントリ」の順に import する）。
 * そのためエントリは import.meta.main で起動を条件付けず、読み込まれたら起動すること。
 *
 * macOS のユニバーサル化には llvm-lipo を使う（環境変数 CSRC_LIPO で差し替え可）。zip も要る。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCliArgs, type CliOptions } from "./args.ts";
import { collectPdfAssets, renderPreamble, summarizePdfAssets } from "./assets.ts";
import { buildManifest, mcpbLayout, parseToolsJson, renderDarwinLauncher, type ToolEntry } from "./manifest.ts";
import { EXTERNALS, playwrightCorePlugin } from "./plugins.ts";
import {
  formatSha256Sums,
  mcpbFileName,
  parseLipoArchs,
  type BuildReport,
  type BuiltFile,
  type CompileReport,
  type OutputReport,
} from "./report.ts";
import { binaryFileName, compileTargetsOf, resolveOutputs, type CompileTarget } from "./targets.ts";

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function built(out: string, file: string): BuiltFile {
  return { path: path.relative(out, file).replace(/\\/g, "/"), bytes: statSync(file).size, sha256: sha256(file) };
}

/** 生成した入口（起動前処理 → エントリ）を作る。戻り値は入口のパスと、埋め込む資産の要約。 */
function prepareEntry(entry: string, genDir: string) {
  const pdfModule = realpathSync(Bun.resolveSync("@chibatech-src/pdf", import.meta.dir));
  const pdfjsDir = path.dirname(realpathSync(Bun.resolveSync("pdfjs-dist/package.json", path.dirname(pdfModule))));
  const files = collectPdfAssets(pdfjsDir);
  const preamble = path.join(genDir, "pdf-assets.ts");
  writeFileSync(
    preamble,
    renderPreamble({ pdfModule, runtimeModule: realpathSync(path.join(import.meta.dir, "runtime-assets.ts")), files }),
  );
  const wrapper = path.join(genDir, "entry.ts");
  // ESM は import を書いた順に評価するので、エントリより先に setPdfAssets が済む
  writeFileSync(wrapper, `import ${JSON.stringify(preamble)};\nimport ${JSON.stringify(entry)};\n`);
  return { wrapper, assets: summarizePdfAssets(files) };
}

async function compile(entry: string, target: CompileTarget, outfile: string, plugin: ReturnType<typeof playwrightCorePlugin>["plugin"]) {
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
    entrypoints: [entry],
    compile: { target: target.bunTarget as Bun.Build.CompileTarget, outfile },
    minify: true,
    sourcemap: "none",
    plugins: [plugin],
    external: [...EXTERNALS],
    });
  } catch (error) {
    // Bun.build は失敗時に AggregateError を投げる（中身がバンドラのメッセージ）
    const inner = error instanceof AggregateError ? error.errors : [error];
    for (const e of inner) console.error(e);
    throw new Error(`compile 失敗: ${target.key}`);
  }
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error(`compile 失敗: ${target.key}`);
  }
  if (!existsSync(outfile)) throw new Error(`出力がありません: ${outfile}`);
  if (target.exe === "") chmodSync(outfile, 0o755);
}

function run(command: string, args: string[]): string {
  const r = spawnSync(command, args, { encoding: "utf8" });
  if (r.error !== undefined) throw new Error(`${command} を起動できません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${command} ${args.join(" ")} が失敗しました（${r.status}）\n${r.stderr}`);
  return r.stdout;
}

/** arm64 と x64 の Mach-O を 1 つにまとめ、両方の slice があることを確かめる。 */
function lipo(parts: string[], outfile: string): string[] {
  const cmd = process.env.CSRC_LIPO ?? "llvm-lipo";
  rmSync(outfile, { force: true });
  run(cmd, ["-create", ...parts, "-output", outfile]);
  chmodSync(outfile, 0o755);
  const archs = parseLipoArchs(run(cmd, ["-archs", outfile]));
  for (const a of ["arm64", "x86_64"]) if (!archs.includes(a)) throw new Error(`lipo の結果に ${a} がありません: ${archs.join(" ")}`);
  return archs;
}

function writeMcpb(opts: CliOptions, tools: readonly ToolEntry[], binaries: Map<string, string>, mcpbDir: string) {
  const manifest = buildManifest({ name: opts.name, version: opts.version, tools, darwin: opts.darwin });
  const layout = mcpbLayout(opts.name, opts.darwin);
  const stage = mkdtempSync(path.join(tmpdir(), "csrc-mcpb-"));
  try {
    mkdirSync(path.join(stage, "server"));
    const contents: { path: string; from: string; bytes: number }[] = [];
    for (const entry of layout.entries) {
      const src = binaries.get(entry.from);
      if (src === undefined) throw new Error(`mcpb に要る ${entry.from} がビルドされていません`);
      const dest = path.join(stage, entry.path);
      copyFileSync(src, dest);
      chmodSync(dest, entry.executable ? 0o755 : 0o644);
      contents.push({ path: entry.path, from: entry.from, bytes: statSync(dest).size });
    }
    if (layout.launcher !== undefined) {
      const dest = path.join(stage, layout.launcher);
      writeFileSync(dest, renderDarwinLauncher(opts.name));
      chmodSync(dest, 0o755);
      contents.push({ path: layout.launcher, from: "launch.sh", bytes: statSync(dest).size });
    }
    writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const file = path.join(mcpbDir, mcpbFileName(opts.name, opts.version));
    rmSync(file, { force: true });
    // -D: ディレクトリの項目を入れない（mcpb の公式 CLI の unpack は "server/" の項目があると EISDIR で失敗する）
    const zip = spawnSync("zip", ["-q", "-r", "-X", "-D", file, "manifest.json", "server"], { cwd: stage, stdio: "inherit" });
    if (zip.status !== 0) throw new Error("zip 失敗。zip コマンドが要ります");
    return { file, contents };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

const LAUNCHER_OUTPUT_KEYS = ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64", "linux-arm64"];

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  const outputs = resolveOutputs(opts.targets ?? (opts.darwin === "launcher" ? LAUNCHER_OUTPUT_KEYS : undefined), opts.baseline);
  if (opts.mcpb) {
    const missing = mcpbLayout(opts.name, opts.darwin).entries.filter((e) => !outputs.some((o) => o.key === e.from));
    if (missing.length > 0) {
      throw new Error(`mcpb には ${missing.map((e) => e.from).join(", ")} が要ります（--targets に足すか、--no-mcpb で省略）`);
    }
  }
  const entry = path.resolve(opts.entry);
  if (!existsSync(entry)) throw new Error(`エントリがありません: ${entry}`);
  const tools = parseToolsJson(readFileSync(path.resolve(opts.tools), "utf8"));
  const out = path.resolve(opts.out);
  const binDir = path.join(out, "bin");
  mkdirSync(binDir, { recursive: true });

  const genDir = mkdtempSync(path.join(tmpdir(), "csrc-build-"));
  try {
    const { wrapper, assets } = prepareEntry(entry, genDir);
    console.log(
      `pdf assets: cmaps ${assets.cMaps.count} files (${assets.cMaps.bytes} B), standard fonts ${assets.standardFonts.count} files (${assets.standardFonts.bytes} B)`,
    );
    const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
    const pw = playwrightCorePlugin();

    // 1. コンパイル（1 回のコンパイルを複数の出力で使い回す）
    const compiled = new Map<string, string>();
    const compiles: CompileReport[] = [];
    mkdirSync(path.join(genDir, "compile"));
    for (const target of compileTargetsOf(outputs)) {
      const file = path.join(genDir, "compile", binaryFileName(opts.name, target));
      const t0 = Date.now();
      await compile(wrapper, target, file, pw.plugin);
      compiled.set(target.key, file);
      compiles.push({ target: target.key, bunTarget: target.bunTarget, compileMs: Date.now() - t0, bytes: statSync(file).size });
      console.log(`compiled ${target.key}: ${mb(statSync(file).size)}`);
    }

    // 2. 出力（darwin-universal は lipo でまとめる）
    const binaries = new Map<string, string>();
    const outputReports: OutputReport[] = [];
    for (const o of outputs) {
      const file = path.join(binDir, binaryFileName(opts.name, o));
      const parts = o.parts.map((p) => compiled.get(p.key)!);
      let archs: string[] | undefined;
      if (parts.length === 1) {
        copyFileSync(parts[0]!, file);
        if (o.exe === "") chmodSync(file, 0o755);
      } else {
        archs = lipo(parts, file);
      }
      binaries.set(o.key, file);
      const report: OutputReport = { output: o.key, parts: o.parts.map((p) => p.key), binary: built(out, file) };
      if (archs !== undefined) report.archs = archs;
      outputReports.push(report);
      console.log(`output ${o.key}: ${mb(report.binary.bytes)}${archs ? ` (${archs.join(" ")})` : ""}`);
    }

    // 3. 代替（起動スクリプト）の検証用に、lipo 前の 2 つを残す
    if (opts.keepSlices) {
      const slices = path.join(out, "slices");
      mkdirSync(slices, { recursive: true });
      for (const [key, suffix] of [["darwin-arm64", "arm64"], ["darwin-x64", "x64"]] as const) {
        const src = compiled.get(key);
        if (src === undefined) continue;
        const dest = path.join(slices, `${opts.name}-${suffix}`);
        copyFileSync(src, dest);
        chmodSync(dest, 0o755);
      }
      writeFileSync(path.join(slices, "launch.sh"), renderDarwinLauncher(opts.name));
      chmodSync(path.join(slices, "launch.sh"), 0o755);
    }

    // 4. mcpb（全 OS 共通の 1 つ）
    let mcpb: BuildReport["mcpb"] = null;
    if (opts.mcpb) {
      const mcpbDir = path.join(out, "mcpb");
      mkdirSync(mcpbDir, { recursive: true });
      const { file, contents } = writeMcpb(opts, tools, binaries, mcpbDir);
      mcpb = { ...built(out, file), contents };
      console.log(`mcpb ${path.basename(file)}: ${mb(mcpb.bytes)}`);
    }

    const sums = [...outputReports.map((r) => r.binary), ...(mcpb ? [mcpb] : [])];
    writeFileSync(path.join(out, "SHA256SUMS"), formatSha256Sums(sums));
    const rel = (p: string) => path.relative(process.cwd(), p).replace(/\\/g, "/");
    const report: BuildReport = {
      name: opts.name,
      version: opts.version,
      bun: Bun.version,
      entry: rel(entry),
      darwin: opts.darwin,
      playwrightCorePatched: [...new Set(pw.patched().map(rel))],
      pdfAssets: assets,
      compiles,
      outputs: outputReports,
      mcpb,
    };
    writeFileSync(path.join(out, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    rmSync(genDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
