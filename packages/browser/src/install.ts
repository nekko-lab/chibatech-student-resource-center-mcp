/// <reference path="./playwright-internals.d.ts" />
/**
 * Chrome Headless Shell の用意（導入済みならそのまま使い、無ければダウンロードする）。
 *
 *   registry: playwright-core 自身の registry.install。単一バイナリでは launcher.ts の振り分けが前提。
 *   custom  : browsers.json の版から CDN の URL を組み立て、自前で取得・展開する代替。
 *             置き場所は registry と同じなので、他の Playwright と共有できる。
 *
 * installMode=auto は registry を試し、失敗したら custom に切り替える。
 * stdout は MCP の transport 専用なので、registry が console.log に出す進捗も log に回す。
 */
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { customDownloadUrl, headlessShellLayout, type HeadlessShellLayout } from "./download-url.ts";
import { shortError } from "./log.ts";
import type { InstallMode } from "./options.ts";

export interface InstallContext {
  /** 解決済みの置き場所（browsersDirectory の結果）。 */
  browsersDir: string;
  browsersJson: unknown;
  platform: string;
  arch: string;
  installMode: InstallMode;
  /** PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST / PLAYWRIGHT_DOWNLOAD_HOST と同じ意味（custom の mirror）。 */
  hostOverride?: string;
  log: (message: string) => void;
  /** テスト用の差し替え。 */
  fetch?: typeof fetch;
  /** custom の受信がこの時間止まったら打ち切る。既定 60 秒。 */
  stallTimeoutMs?: number;
}

export interface InstallResult {
  executablePath: string;
  source: "cached" | "registry" | "custom";
  ms: number;
  url?: string;
  bytes?: number;
}

/** サイトではなく Playwright の CDN に送る User-Agent。非公式であることを明示する。 */
const USER_AGENT = "chibatech-src-mcp (unofficial; +https://github.com/nekko-lab/chibatech-student-resource-center-mcp)";
const DEFAULT_STALL_TIMEOUT_MS = 60_000;

export function isInstalled(layout: HeadlessShellLayout): boolean {
  return existsSync(layout.marker) && existsSync(layout.executablePath);
}

export async function ensureHeadlessShell(ctx: InstallContext): Promise<InstallResult> {
  const started = Date.now();
  const layout = headlessShellLayout({
    browsersJson: ctx.browsersJson,
    platform: ctx.platform,
    arch: ctx.arch,
    browsersDir: ctx.browsersDir,
  });
  if (isInstalled(layout)) {
    ctx.log(`Chrome Headless Shell は導入済み: ${layout.executablePath}`);
    return { executablePath: layout.executablePath, source: "cached", ms: Date.now() - started };
  }

  const order: ("registry" | "custom")[] =
    ctx.installMode === "registry" ? ["registry"] : ctx.installMode === "custom" ? ["custom"] : ["registry", "custom"];
  const failures: string[] = [];
  for (const mode of order) {
    const t0 = Date.now();
    ctx.log(`Chrome Headless Shell を導入します（${mode}）: ${layout.browserDirectory}`);
    try {
      const result =
        mode === "registry"
          ? { executablePath: await installViaRegistry(ctx, layout) }
          : { executablePath: layout.executablePath, ...(await installCustom(ctx, layout)) };
      if (!existsSync(result.executablePath)) throw new Error(`導入後に実行ファイルがありません: ${result.executablePath}`);
      ctx.log(`${mode}: 成功 (${Date.now() - t0}ms)`);
      return { ...result, source: mode, ms: Date.now() - started };
    } catch (error) {
      const reason = shortError(error);
      ctx.log(`${mode}: 失敗 (${Date.now() - t0}ms): ${reason}`);
      failures.push(`${mode}: ${reason}`);
    }
  }
  throw new Error(`Chrome Headless Shell を用意できませんでした（${failures.join(" / ")}）`);
}

/** 方式 1: playwright-core の registry をそのまま使う。 */
async function installViaRegistry(ctx: InstallContext, layout: HeadlessShellLayout): Promise<string> {
  const core = await import("playwright-core/lib/coreBundle");
  const reg = core.registry;
  // registry の置き場所は playwright-core の読み込み時に PLAYWRIGHT_BROWSERS_PATH から決まり、後から変えられない。
  if (path.resolve(reg.registryDirectory) !== path.resolve(ctx.browsersDir)) {
    throw new Error(`registry の置き場所 (${reg.registryDirectory}) が指定の置き場所 (${ctx.browsersDir}) と異なるため使えません`);
  }
  const executable = reg.registry.findExecutable("chromium-headless-shell");
  if (executable === undefined) throw new Error("registry に chromium-headless-shell がありません");

  // registry は失敗時に process.exitCode = 1 を立て、進捗を console.log（stdout）に書く。どちらも元に戻す。
  const exitCode = process.exitCode;
  const original = { log: console.log, info: console.info };
  const toLog = (...args: unknown[]) => ctx.log(args.map(String).join(" "));
  console.log = toLog;
  console.info = toLog;
  try {
    // gc: false — 他の Playwright が入れたブラウザを、このプロセスの判断で消さない
    await reg.registry.install([executable], { force: false, gc: false });
  } finally {
    console.log = original.log;
    console.info = original.info;
    process.exitCode = exitCode;
  }
  return executable.executablePath() ?? layout.executablePath;
}

/** 方式 2: CDN から直接取得して展開する。展開は一時ディレクトリで行い、完成してから置き換える。 */
async function installCustom(ctx: InstallContext, layout: HeadlessShellLayout): Promise<{ url: string; bytes: number }> {
  const { url } = customDownloadUrl({
    browsersJson: ctx.browsersJson,
    platform: ctx.platform,
    arch: ctx.arch,
    ...(ctx.hostOverride === undefined ? {} : { hostOverride: ctx.hostOverride }),
  });
  ctx.log(`custom: ${url}`);
  await mkdir(ctx.browsersDir, { recursive: true });
  const tag = `${process.pid}-${Date.now().toString(36)}`;
  const zipPath = path.join(ctx.browsersDir, `.csrc-download-${tag}.zip`);
  const staging = `${layout.browserDirectory}.csrc-staging-${tag}`;
  try {
    const bytes = await download(ctx, url, zipPath);
    await mkdir(staging, { recursive: true });
    await extractZip(zipPath, staging);
    const stagedExecutable = path.join(staging, path.relative(layout.browserDirectory, layout.executablePath));
    if (!existsSync(stagedExecutable)) {
      throw new Error(`zip に実行ファイルがありません: ${path.relative(layout.browserDirectory, layout.executablePath)}`);
    }
    if (ctx.platform !== "win32") await chmod(stagedExecutable, 0o755);
    await writeFile(path.join(staging, path.basename(layout.marker)), "");

    // 別のプロセスが先に導入を終えていたら、そちらを使う
    if (isInstalled(layout)) return { url, bytes };
    await rm(layout.browserDirectory, { recursive: true, force: true });
    try {
      await rename(staging, layout.browserDirectory);
    } catch (error) {
      if (!isInstalled(layout)) throw error;
    }
    return { url, bytes };
  } finally {
    await rm(zipPath, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

async function download(ctx: InstallContext, url: string, zipPath: string): Promise<number> {
  const stallMs = ctx.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(`受信が止まったため打ち切りました（${stallMs}ms）`)), stallMs);
  };
  arm();
  try {
    const response = await (ctx.fetch ?? fetch)(url, { headers: { "user-agent": USER_AGENT }, signal: controller.signal });
    if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status} ${url}`);
    const total = Number(response.headers.get("content-length") ?? 0);
    let received = 0;
    let nextReport = 0.1;
    const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      arm();
      received += chunk.length;
      if (total > 0 && received / total >= nextReport) {
        ctx.log(`custom: ${Math.floor((received / total) * 100)}% (${toMegabytes(received)} / ${toMegabytes(total)})`);
        while (received / total >= nextReport) nextReport += 0.1;
      }
    });
    await pipeline(body, createWriteStream(zipPath));
    return (await stat(zipPath)).size;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** playwright-core が同梱する yauzl で展開する（依存を増やさない）。実行ビットと symlink も復元する。 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { yauzl } = await import("playwright-core/lib/utilsBundle");
  const root = path.resolve(destDir);
  const inside = (target: string) => {
    const rel = path.relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const fail = (error: unknown) => {
        zip.close();
        reject(error);
      };
      zip.on("error", reject);
      zip.on("end", () => resolve());
      zip.on("entry", (entry) => {
        const target = path.resolve(root, entry.fileName);
        if (!inside(target)) return fail(new Error(`zip に不正なパスがあります: ${entry.fileName}`));
        const attrs = entry.externalFileAttributes >>> 16;
        const mode = attrs & 0o7777;
        const isSymlink = (attrs & 0o170000) === 0o120000;
        if (entry.fileName.endsWith("/")) {
          mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail);
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          (async () => {
            await mkdir(path.dirname(target), { recursive: true });
            if (isSymlink) {
              const chunks: Buffer[] = [];
              for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
              const linkTarget = Buffer.concat(chunks).toString("utf8");
              if (!inside(path.resolve(path.dirname(target), linkTarget))) {
                throw new Error(`zip の symlink が展開先の外を指しています: ${entry.fileName} -> ${linkTarget}`);
              }
              await symlink(linkTarget, target);
            } else {
              await pipeline(stream, createWriteStream(target));
              if (mode !== 0 && process.platform !== "win32") await chmod(target, mode);
            }
          })().then(() => zip.readEntry(), fail);
        });
      });
      zip.readEntry();
    });
  });
}
