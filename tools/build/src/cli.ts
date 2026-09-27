/**
 * 単一バイナリと mcpb（binary 型）のビルド。Bun で実行する。
 *
 *   bun run tools/build/src/cli.ts --entry <file> --out <dir> --version <x.y.z> --tools <tools.json> \
 *     --bun-license <LICENSE.md> [--targets a,b] [--baseline] [--name <名前>] [--no-mcpb] [--license <LICENSE>]
 *
 * 出力:
 *   <out>/bin/<名前>-<target>[.exe]    単体バイナリ（既定: darwin-arm64・windows-x64・linux-x64・linux-arm64）
 *   <out>/mcpb/<名前>-<version>.mcpb  mcpb（全 OS 共通の 1 つ。darwin-arm64 + windows-x64）
 *   <out>/THIRD_PARTY_NOTICES.txt     同梱物のライセンス本文と著作権表示（mcpb のルートにも入れる）
 *   <out>/LICENSE                     リポジトリのライセンス（mcpb のルートにも入れる。無ければ警告して続ける）
 *   <out>/SHA256SUMS                  上のすべてのハッシュ（sha256sum -c で検査できる）
 *   <out>/build-report.json           サイズ・埋め込んだ資産・書き換え・ライセンス表記の記録
 *
 * エントリの前に、pdfjs の CMap・標準フォントを埋め込んで setPdfAssets へ渡す起動前処理を差し込む。
 * エントリ自身は何も import しなくてよい（生成した入口が「起動前処理 → エントリ」の順に import する）。
 * そのためエントリは import.meta.main で起動を条件付けず、読み込まれたら起動すること。
 *
 * packages/server/src/version.ts の VERSION は --version の値に差し替える（plugins.ts。ソースは変えない）。
 * macOS 用（darwin-arm64）は Bun が付ける ad-hoc 署名のまま（公証なし）。mcpb の組み立てに zip が要る。
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
import { buildManifest, mcpbLayout, parseToolsJson, type ToolEntry } from "./manifest.ts";
import { collectNotices, pdfjsAssetLicenseSections, renderNotices, type NoticeSection } from "./notices.ts";
import { EXTERNALS, playwrightCorePlugin, serverVersionPlugin } from "./plugins.ts";
import { formatSha256Sums, mcpbFileName, type BuildReport, type BuiltFile, type TargetReport } from "./report.ts";
import { binaryFileName, resolveTargets, type Target } from "./targets.ts";

/** 出力のルートと mcpb のルートに置くファイル */
const NOTICES = "THIRD_PARTY_NOTICES.txt";
const LICENSE = "LICENSE";

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
  return { wrapper, assets: summarizePdfAssets(files), pdfjsDir };
}

/** コンパイルし、バンドルの入力ファイル（絶対パス）を返す。 */
async function compile(
  entry: string,
  target: Target,
  outfile: string,
  plugins: Bun.BunPlugin[],
): Promise<string[]> {
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entry],
      compile: { target: target.bunTarget as Bun.Build.CompileTarget, outfile },
      minify: true,
      sourcemap: "none",
      plugins,
      external: [...EXTERNALS],
      metafile: true,
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
  const inputs = Object.keys(result.metafile?.inputs ?? {});
  if (inputs.length === 0) throw new Error(`metafile に入力がありません（${target.key}）。ライセンス表記を作れません`);
  return inputs.map((p) => path.resolve(process.cwd(), p.replace(/^file:/, "")));
}

/** 同梱物のライセンス表記を作る。ライセンスの見つからないパッケージがあれば一覧を出して止める。 */
function buildNotices(inputs: Iterable<string>, pdfjsDir: string, bunLicense: string): { text: string; sections: NoticeSection[] } {
  const { sections, missing } = collectNotices([...inputs]);
  if (missing.length > 0) {
    throw new Error(`ライセンスファイルの見つからない同梱パッケージがあります（${missing.length} 件）:\n- ${missing.join("\n- ")}`);
  }
  if (!existsSync(bunLicense)) throw new Error(`Bun のライセンスがありません: ${bunLicense}`);
  const bun: NoticeSection = {
    title: `Bun ${Bun.version}（単一バイナリに同梱するランタイム）`,
    license: "MIT（静的にリンクしたライブラリは各ライセンス）",
    files: [{ name: path.basename(bunLicense), text: readFileSync(bunLicense, "utf8") }],
  };
  const all = [bun, ...sections, ...pdfjsAssetLicenseSections(pdfjsDir)];
  return { text: renderNotices(all), sections: all };
}

/** mcpb のルートに置くファイル（manifest.json 以外） */
interface RootFile {
  name: string;
  file: string;
}

function writeMcpb(
  opts: CliOptions,
  tools: readonly ToolEntry[],
  binaries: Map<string, string>,
  rootFiles: readonly RootFile[],
  mcpbDir: string,
) {
  const manifest = buildManifest({ name: opts.name, version: opts.version, tools });
  const stage = mkdtempSync(path.join(tmpdir(), "csrc-mcpb-"));
  try {
    mkdirSync(path.join(stage, "server"));
    const contents: { path: string; from: string; bytes: number }[] = [];
    for (const entry of mcpbLayout(opts.name)) {
      const src = binaries.get(entry.from);
      if (src === undefined) throw new Error(`mcpb に要る ${entry.from} がビルドされていません`);
      const dest = path.join(stage, entry.path);
      copyFileSync(src, dest);
      chmodSync(dest, entry.executable ? 0o755 : 0o644);
      contents.push({ path: entry.path, from: entry.from, bytes: statSync(dest).size });
    }
    for (const r of rootFiles) {
      copyFileSync(r.file, path.join(stage, r.name));
      contents.push({ path: r.name, from: r.name, bytes: statSync(r.file).size });
    }
    writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const file = path.join(mcpbDir, mcpbFileName(opts.name, opts.version));
    rmSync(file, { force: true });
    // -D: ディレクトリの項目を入れない（mcpb の公式 CLI の unpack は "server/" の項目があると EISDIR で失敗する）
    const zip = spawnSync("zip", ["-q", "-r", "-X", "-D", file, "manifest.json", ...rootFiles.map((r) => r.name), "server"], {
      cwd: stage,
      stdio: "inherit",
    });
    if (zip.status !== 0) throw new Error("zip 失敗。zip コマンドが要ります");
    return { file, contents };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  const targets = resolveTargets(opts.targets, opts.baseline);
  if (opts.mcpb) {
    const missing = mcpbLayout(opts.name).filter((e) => !targets.some((t) => t.key === e.from));
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
    const { wrapper, assets, pdfjsDir } = prepareEntry(entry, genDir);
    console.log(
      `pdf assets: cmaps ${assets.cMaps.count} files (${assets.cMaps.bytes} B), standard fonts ${assets.standardFonts.count} files (${assets.standardFonts.bytes} B)`,
    );
    const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
    const pw = playwrightCorePlugin();
    // packages/server の VERSION（serverInfo.version と User-Agent）を --version にする
    const ver = serverVersionPlugin(opts.version);

    // 1. コンパイル
    const binaries = new Map<string, string>();
    const reports: TargetReport[] = [];
    const inputs = new Set<string>();
    for (const target of targets) {
      const file = path.join(binDir, binaryFileName(opts.name, target));
      const t0 = Date.now();
      for (const p of await compile(wrapper, target, file, [pw.plugin, ver.plugin])) inputs.add(p);
      binaries.set(target.key, file);
      const report: TargetReport = { target: target.key, bunTarget: target.bunTarget, compileMs: Date.now() - t0, binary: built(out, file) };
      reports.push(report);
      console.log(`built ${target.key}: ${mb(report.binary.bytes)}`);
    }

    // 2. 同梱物のライセンス表記と、リポジトリの LICENSE
    const noticesFile = path.join(out, NOTICES);
    const notices = buildNotices(inputs, pdfjsDir, opts.bunLicense);
    writeFileSync(noticesFile, notices.text);
    console.log(`${NOTICES}: ${notices.sections.length} sections, ${statSync(noticesFile).size} B`);
    const rootFiles: RootFile[] = [{ name: NOTICES, file: noticesFile }];
    let license: BuiltFile | null = null;
    const licenseSrc = path.resolve(opts.license);
    if (existsSync(licenseSrc)) {
      const dest = path.join(out, LICENSE);
      copyFileSync(licenseSrc, dest);
      rootFiles.push({ name: LICENSE, file: dest });
      license = built(out, dest);
    } else {
      console.warn(`warning: リポジトリの LICENSE がありません（${licenseSrc}）。mcpb と Release に入れずに続けます`);
    }

    // 3. mcpb（全 OS 共通の 1 つ）
    let mcpb: BuildReport["mcpb"] = null;
    if (opts.mcpb) {
      const mcpbDir = path.join(out, "mcpb");
      mkdirSync(mcpbDir, { recursive: true });
      const { file, contents } = writeMcpb(opts, tools, binaries, rootFiles, mcpbDir);
      mcpb = { ...built(out, file), contents };
      console.log(`mcpb ${path.basename(file)}: ${mb(mcpb.bytes)}`);
    }

    const noticesBuilt = built(out, noticesFile);
    const sums = [...reports.map((r) => r.binary), ...(mcpb ? [mcpb] : []), noticesBuilt, ...(license ? [license] : [])];
    writeFileSync(path.join(out, "SHA256SUMS"), formatSha256Sums(sums));
    const rel = (p: string) => path.relative(process.cwd(), p).replace(/\\/g, "/");
    const report: BuildReport = {
      name: opts.name,
      version: opts.version,
      bun: Bun.version,
      entry: rel(entry),
      darwinSigning: "bun-adhoc",
      playwrightCorePatched: [...new Set(pw.patched().map(rel))],
      versionPatched: [...new Set(ver.patched().map(rel))],
      pdfAssets: assets,
      targets: reports,
      mcpb,
      notices: { ...noticesBuilt, sections: notices.sections.map((x) => x.title) },
      license,
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
