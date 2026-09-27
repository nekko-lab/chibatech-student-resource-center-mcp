/**
 * Chrome Headless Shell の取得先と置き場所（純関数）。
 *
 * playwright-core 1.63.0 の registry（DOWNLOAD_PATHS / EXECUTABLE_PATHS["chromium-headless-shell"]、
 * readDescriptors、registryDirectory）と同じ規則で組み立てる。registry の install が単一バイナリで
 * 動かないときの代替（custom）と、導入済みかどうかの確認に使う。
 */
import path from "node:path";
// playwright-core の exports に browsers.json は無いので、ファイルとして直接取り込む。
// ワークスペースの node_modules はルートに 1 つだけ（docker/test.Dockerfile で機械的に確かめている）。
// 単一バイナリではバンドル時に埋め込まれるので、実行時に node_modules は要らない。
import browsersJsonFile from "../../../node_modules/playwright-core/browsers.json" with { type: "json" };

/** 同梱の playwright-core 1.63.0 の browsers.json。 */
export const bundledBrowsersJson: unknown = browsersJsonFile;

const HEADLESS_SHELL = "chromium-headless-shell";
const DEFAULT_MIRROR = "https://cdn.playwright.dev";

type ShortPlatform = "linux-x64" | "linux-arm64" | "mac-x64" | "mac-arm64" | "win-x64";

/** registry の DOWNLOAD_PATHS["chromium-headless-shell"] の cftUrl(...) 部分。 */
const CFT_SUFFIX: Record<ShortPlatform, string> = {
  "linux-x64": "linux64/chrome-headless-shell-linux64.zip",
  "linux-arm64": "linux-arm64/chrome-headless-shell-linux-arm64.zip",
  "mac-x64": "mac-x64/chrome-headless-shell-mac-x64.zip",
  "mac-arm64": "mac-arm64/chrome-headless-shell-mac-arm64.zip",
  "win-x64": "win64/chrome-headless-shell-win64.zip",
};

/** registry の EXECUTABLE_PATHS["chromium-headless-shell"]。 */
const EXECUTABLE_TOKENS: Record<ShortPlatform, readonly string[]> = {
  "linux-x64": ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  "linux-arm64": ["chrome-headless-shell-linux-arm64", "chrome-headless-shell"],
  "mac-x64": ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
  "mac-arm64": ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
  "win-x64": ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
};

/** registry の hostPlatform → shortPlatform と同じ対応。Windows は arch によらず win64。 */
function shortPlatform(platform: string, arch: string): ShortPlatform {
  if (platform === "win32") return "win-x64";
  if ((platform === "darwin" || platform === "linux") && (arch === "x64" || arch === "arm64")) {
    return `${platform === "darwin" ? "mac" : "linux"}-${arch}`;
  }
  throw new Error(`Chrome Headless Shell の配布が無い未対応の環境です: ${platform} ${arch}`);
}

function headlessShellDescriptor(browsersJson: unknown): { revision: string; browserVersion: string } {
  const browsers = (browsersJson as { browsers?: unknown } | null)?.browsers;
  if (!Array.isArray(browsers)) throw new Error("browsers.json の形式が不正です（browsers が配列ではありません）");
  const entry = browsers.find((b: unknown) => (b as { name?: unknown } | null)?.name === HEADLESS_SHELL) as
    | { revision?: unknown; browserVersion?: unknown }
    | undefined;
  if (entry === undefined) throw new Error(`browsers.json に ${HEADLESS_SHELL} がありません`);
  const { revision, browserVersion } = entry;
  if (typeof revision !== "string" || revision === "") throw new Error(`browsers.json の ${HEADLESS_SHELL} に revision がありません`);
  if (typeof browserVersion !== "string" || browserVersion === "") {
    throw new Error(`browsers.json の ${HEADLESS_SHELL} に browserVersion がありません`);
  }
  return { revision, browserVersion };
}

/**
 * browsers.json の版から Chrome Headless Shell の zip の URL を組み立てる（純関数）。
 * hostOverride は PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST / PLAYWRIGHT_DOWNLOAD_HOST と同じ意味（mirror の差し替え）。
 */
export function customDownloadUrl(input: {
  browsersJson: unknown;
  platform: string;
  arch: string;
  hostOverride?: string;
}): { url: string; revision: string; browserVersion: string } {
  const { revision, browserVersion } = headlessShellDescriptor(input.browsersJson);
  const suffix = CFT_SUFFIX[shortPlatform(input.platform, input.arch)];
  const mirror = input.hostOverride ? input.hostOverride.replace(/\/+$/, "") : DEFAULT_MIRROR;
  return { url: `${mirror}/builds/cft/${browserVersion}/${suffix}`, revision, browserVersion };
}

export interface HeadlessShellLayout {
  /** <browsersDir>/chromium_headless_shell-<revision> */
  browserDirectory: string;
  executablePath: string;
  /** 導入完了の印（registry の browserDirectoryToMarkerFilePath と同じ名前）。 */
  marker: string;
  revision: string;
}

/** Chrome Headless Shell の置き場所（純関数）。registry と同じディレクトリ名なので、他の Playwright と共有できる。 */
export function headlessShellLayout(input: {
  browsersJson: unknown;
  platform: string;
  arch: string;
  browsersDir: string;
}): HeadlessShellLayout {
  const { revision } = headlessShellDescriptor(input.browsersJson);
  const browserDirectory = path.join(input.browsersDir, `${HEADLESS_SHELL.replace(/-/g, "_")}-${revision}`);
  return {
    browserDirectory,
    executablePath: path.join(browserDirectory, ...EXECUTABLE_TOKENS[shortPlatform(input.platform, input.arch)]),
    marker: path.join(browserDirectory, "INSTALLATION_COMPLETE"),
    revision,
  };
}

/**
 * ブラウザの置き場所（純関数）。registry の registryDirectory と同じ規則。
 * browsersPath が空か "0" のときは既定のキャッシュを使う（"0" は Playwright ではパッケージ内の .local-browsers だが、
 * 単一バイナリにはパッケージのディレクトリが無いため）。
 */
export function browsersDirectory(input: {
  browsersPath?: string;
  platform: string;
  env: Record<string, string | undefined>;
  homedir: string;
  cwd: string;
}): string {
  const { browsersPath, platform, env, homedir, cwd } = input;
  if (browsersPath !== undefined && browsersPath !== "" && browsersPath !== "0") return path.resolve(cwd, browsersPath);
  let cache: string;
  if (platform === "darwin") cache = path.join(homedir, "Library", "Caches");
  else if (platform === "win32") cache = env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
  else cache = env.XDG_CACHE_HOME || path.join(homedir, ".cache");
  return path.join(cache, "ms-playwright");
}
