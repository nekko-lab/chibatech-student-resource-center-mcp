/**
 * Chromium（headless shell）の初回ダウンロード。
 *
 * 2 つの方式を持つ:
 *   - registry: playwright-core 自身の registry.install()。内部で JS ファイルを fork するため、
 *               コンパイル後のバイナリで動くかは検証対象（既知リスク 2）。
 *   - custom  : browsers.json の版から CDN の URL を組み立て、自前で取得・展開する代替。
 *               置き場所は Playwright と同じ ms-playwright キャッシュ（他の Playwright と共有できる）。
 *
 * CSRC_INSTALL_MODE=auto（既定）は registry を試し、失敗したら custom に落ちる。
 */
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
// playwright-core の exports に browsers.json は無いので、ファイルとして直接取り込む（バンドル時に埋め込まれる）。
import browsersJson from '../node_modules/playwright-core/browsers.json' with { type: 'json' };
import { ENV_INSTALL_MODE, USER_AGENT } from './config.ts';
import { log } from './log.ts';

export type InstallMode = 'registry' | 'custom';

export interface InstallResult {
  executablePath: string;
  mode: InstallMode | 'cached';
  /** 今回ダウンロードしたか（false ならキャッシュ済み）。 */
  downloaded: boolean;
  ms: number;
  browserDirectory: string;
  url?: string;
  zipBytes?: number;
  installedBytes?: number;
  attempts: { mode: InstallMode; ok: boolean; error?: string; ms: number }[];
}

type HostKey = 'linux-x64' | 'linux-arm64' | 'mac-x64' | 'mac-arm64' | 'win-x64';

/** registry の EXECUTABLE_PATHS['chromium-headless-shell'] と同じ並び。 */
const EXECUTABLE_PATHS: Record<HostKey, string[]> = {
  'linux-x64': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  'linux-arm64': ['chrome-headless-shell-linux-arm64', 'chrome-headless-shell'],
  'mac-x64': ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
  'mac-arm64': ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
  'win-x64': ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
};

/** registry の DOWNLOAD_PATHS（cftUrl）と同じ並び。 */
const CFT_SUFFIX: Record<HostKey, string> = {
  'linux-x64': 'linux64/chrome-headless-shell-linux64.zip',
  'linux-arm64': 'linux-arm64/chrome-headless-shell-linux-arm64.zip',
  'mac-x64': 'mac-x64/chrome-headless-shell-mac-x64.zip',
  'mac-arm64': 'mac-arm64/chrome-headless-shell-mac-arm64.zip',
  'win-x64': 'win64/chrome-headless-shell-win64.zip',
};

function hostKey(): HostKey {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `mac-${arch}`;
  if (process.platform === 'win32') return 'win-x64';
  return `linux-${arch}`;
}

function headlessShellDescriptor(): { revision: string; browserVersion: string } {
  const entry = browsersJson.browsers.find((b) => b.name === 'chromium-headless-shell');
  if (entry === undefined || entry.browserVersion === undefined) {
    throw new Error('browsers.json に chromium-headless-shell がありません');
  }
  return { revision: entry.revision, browserVersion: entry.browserVersion };
}

/** Playwright の registryDirectory と同じ規則。 */
export function registryDirectory(): string {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (env !== undefined && env !== '' && env !== '0') return env;
  let cache: string;
  if (process.platform === 'darwin') cache = path.join(os.homedir(), 'Library', 'Caches');
  else if (process.platform === 'win32') cache = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  else cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cache, 'ms-playwright');
}

export function headlessShellLocation(): { browserDirectory: string; executablePath: string; marker: string } {
  const { revision } = headlessShellDescriptor();
  const browserDirectory = path.join(registryDirectory(), `chromium_headless_shell-${revision}`);
  return {
    browserDirectory,
    executablePath: path.join(browserDirectory, ...EXECUTABLE_PATHS[hostKey()]),
    // registry の browserDirectoryToMarkerFilePath と同じ名前
    marker: path.join(browserDirectory, 'INSTALLATION_COMPLETE'),
  };
}

export async function ensureChromium(): Promise<InstallResult> {
  const started = Date.now();
  const loc = headlessShellLocation();
  if (existsSync(loc.marker) && existsSync(loc.executablePath)) {
    return {
      executablePath: loc.executablePath,
      mode: 'cached',
      downloaded: false,
      ms: Date.now() - started,
      browserDirectory: loc.browserDirectory,
      installedBytes: await dirSize(loc.browserDirectory),
      attempts: [],
    };
  }

  const requested = (process.env[ENV_INSTALL_MODE] ?? 'auto').toLowerCase();
  const order: InstallMode[] = requested === 'registry' ? ['registry'] : requested === 'custom' ? ['custom'] : ['registry', 'custom'];
  const attempts: InstallResult['attempts'] = [];

  for (const mode of order) {
    const t0 = Date.now();
    try {
      const extra = mode === 'registry' ? await installViaRegistry() : await installCustom();
      attempts.push({ mode, ok: true, ms: Date.now() - t0 });
      if (!existsSync(loc.executablePath)) throw new Error(`インストール後に実行ファイルがありません: ${loc.executablePath}`);
      return {
        executablePath: loc.executablePath,
        mode,
        downloaded: true,
        ms: Date.now() - started,
        browserDirectory: loc.browserDirectory,
        installedBytes: await dirSize(loc.browserDirectory),
        attempts,
        ...extra,
      };
    } catch (error) {
      const message = shortError(error);
      log(`install(${mode}) 失敗: ${message}`);
      attempts.push({ mode, ok: false, error: message, ms: Date.now() - t0 });
    }
  }
  const summary = attempts.map((a) => `${a.mode}: ${a.error}`).join(' / ');
  throw new Error(`Chromium を用意できませんでした（${summary}）`);
}

/** 方式 1: playwright-core の registry をそのまま使う。 */
async function installViaRegistry(): Promise<Partial<InstallResult>> {
  // coreBundle は playwright-core の exports に載っている公開パス（ただし内部 API）。
  const core = (await import('playwright-core/lib/coreBundle')) as any;
  const registry = core.registry.registry;
  const executable = registry.findExecutable('chromium-headless-shell');
  await registry.install([executable], { force: false });
  return {};
}

/** 方式 2: CDN から直接取得して展開する。 */
async function installCustom(): Promise<Partial<InstallResult>> {
  const { browserVersion } = headlessShellDescriptor();
  const loc = headlessShellLocation();
  const host = process.env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST || process.env.PLAYWRIGHT_DOWNLOAD_HOST || 'https://cdn.playwright.dev';
  const url = `${host.replace(/\/$/, '')}/builds/cft/${browserVersion}/${CFT_SUFFIX[hostKey()]}`;

  await mkdir(registryDirectory(), { recursive: true });
  const zipPath = path.join(registryDirectory(), `.csrc-download-${process.pid}.zip`);
  log(`custom install: ${url}`);
  try {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status} ${url}`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(zipPath));
    const zipBytes = (await stat(zipPath)).size;

    await rm(loc.browserDirectory, { recursive: true, force: true });
    await mkdir(loc.browserDirectory, { recursive: true });
    await extractZip(zipPath, loc.browserDirectory);
    if (process.platform !== 'win32') await chmod(loc.executablePath, 0o755);
    await writeFile(loc.marker, '');
    return { url, zipBytes };
  } finally {
    await rm(zipPath, { force: true });
  }
}

/** playwright-core が同梱する yauzl で展開する（追加の依存を増やさない）。実行ビットも復元する。 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const utils = (await import('playwright-core/lib/utilsBundle')) as any;
  const yauzl = utils.yauzl;
  const root = path.resolve(destDir);
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError: Error | null, zip: any) => {
      if (openError) return reject(openError);
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: any) => {
        const target = path.resolve(root, entry.fileName);
        if (!target.startsWith(root)) return reject(new Error(`zip の不正なパス: ${entry.fileName}`));
        const mode = (entry.externalFileAttributes >>> 16) & 0o7777;
        const isSymlink = ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
        if (entry.fileName.endsWith('/')) {
          mkdir(target, { recursive: true }).then(() => zip.readEntry(), reject);
          return;
        }
        zip.openReadStream(entry, (streamError: Error | null, stream: NodeJS.ReadableStream) => {
          if (streamError) return reject(streamError);
          (async () => {
            await mkdir(path.dirname(target), { recursive: true });
            if (isSymlink) {
              const chunks: Buffer[] = [];
              for await (const c of stream as any) chunks.push(Buffer.from(c));
              const { symlink } = await import('node:fs/promises');
              await symlink(Buffer.concat(chunks).toString('utf8'), target);
            } else {
              await pipeline(stream, createWriteStream(target));
              if (mode !== 0 && process.platform !== 'win32') await chmod(target, mode);
            }
          })().then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  });
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await stat(p)).size;
  }
  return total;
}

export function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n').slice(0, 3).join(' | ').slice(0, 400);
}
