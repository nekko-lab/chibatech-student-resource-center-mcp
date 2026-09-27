/**
 * ブラウザの調達: channel "chrome" → "msedge" → Chrome Headless Shell（導入済みを使うか、初回にダウンロード）。
 * 試した経路と失敗理由は log に残し、すべて失敗したら経路ごとの理由を持つ BrowserUnavailableError を投げる。
 */
import os from "node:os";
import { chromium, type Browser } from "playwright-core";
import { browsersDirectory, bundledBrowsersJson } from "./download-url.ts";
import { ensureHeadlessShell } from "./install.ts";
import { shortError } from "./log.ts";
import { resolveOptions, type AcquireOptions, type Via } from "./options.ts";

export interface AcquireAttempt {
  via: Via;
  reason: string;
}

export class BrowserUnavailableError extends Error {
  override readonly name = "BrowserUnavailableError";
  /** 試した順。disableChannels のときは channel を含まない。 */
  readonly attempts: readonly AcquireAttempt[];

  constructor(attempts: readonly AcquireAttempt[]) {
    super(`ブラウザを起動できませんでした（${attempts.map((a) => `${a.via}: ${a.reason}`).join(" / ")}）`);
    this.attempts = attempts;
  }
}

/** registry の hostPlatform と同じく、macOS は CPU が Apple なら arm64 とみなす（Rosetta 上の x64 でも arm64 版を使う）。 */
function hostArch(): string {
  if (process.platform === "darwin" && os.cpus().some((cpu) => cpu.model.includes("Apple"))) return "arm64";
  return process.arch;
}

export async function acquireBrowser(
  opts: AcquireOptions = {},
): Promise<{ browser: Browser; via: Via; executablePath?: string }> {
  const o = resolveOptions(opts, process.env);
  const started = Date.now();
  const attempts: AcquireAttempt[] = [];
  const launched = (browser: Browser, via: Via) =>
    o.log(`ブラウザを起動しました: via=${via} version=${browser.version()} (${Date.now() - started}ms)`);

  if (o.disableChannels) {
    o.log("channel（chrome / msedge）の起動は省略しました（disableChannels）");
  } else {
    for (const channel of o.channels) {
      const t0 = Date.now();
      try {
        const browser = await chromium.launch({ channel, headless: o.headless, timeout: o.launchTimeoutMs });
        o.log(`${channel}: 成功 (${Date.now() - t0}ms)`);
        launched(browser, channel);
        return { browser, via: channel };
      } catch (error) {
        const reason = shortError(error);
        o.log(`${channel}: 失敗 (${Date.now() - t0}ms): ${reason}`);
        attempts.push({ via: channel, reason });
      }
    }
  }

  const t0 = Date.now();
  try {
    const env = process.env;
    const hostOverride = env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST || env.PLAYWRIGHT_DOWNLOAD_HOST;
    const installed = await ensureHeadlessShell({
      browsersDir: browsersDirectory({
        ...(o.browsersPath === undefined ? {} : { browsersPath: o.browsersPath }),
        platform: process.platform,
        env,
        homedir: os.homedir(),
        cwd: process.cwd(),
      }),
      browsersJson: bundledBrowsersJson,
      platform: process.platform,
      arch: hostArch(),
      installMode: o.installMode,
      ...(hostOverride ? { hostOverride } : {}),
      log: o.log,
    });
    if (!o.headless) o.log("download: Chrome Headless Shell は画面を持たないため headless で起動します");
    const browser = await chromium.launch({ executablePath: installed.executablePath, headless: true, timeout: o.launchTimeoutMs });
    o.log(`download: 成功 (${Date.now() - t0}ms, ${installed.source})`);
    launched(browser, "download");
    return { browser, via: "download", executablePath: installed.executablePath };
  } catch (error) {
    const reason = shortError(error);
    o.log(`download: 失敗 (${Date.now() - t0}ms): ${reason}`);
    attempts.push({ via: "download", reason });
  }

  throw new BrowserUnavailableError(attempts);
}
