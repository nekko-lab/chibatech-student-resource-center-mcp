import { stderrLog } from "./log.ts";

export type Via = "chrome" | "msedge" | "download";
export type Channel = "chrome" | "msedge";
export type InstallMode = "auto" | "registry" | "custom";

export interface AcquireOptions {
  /** 試す channel の並び。既定 ["chrome", "msedge"]。 */
  channels?: Channel[];
  /** true なら channel を試さず、ダウンロード経路に直行する。 */
  disableChannels?: boolean;
  /** 既定 auto（registry を試し、失敗したら custom）。 */
  installMode?: InstallMode;
  /** PLAYWRIGHT_BROWSERS_PATH と同じ意味。未指定なら process.env.PLAYWRIGHT_BROWSERS_PATH、それも無ければ既定のキャッシュ。 */
  browsersPath?: string;
  /** 既定 true。ダウンロード経路（headless shell）は常に headless で起動する。 */
  headless?: boolean;
  /** 既定 60000。 */
  launchTimeoutMs?: number;
  /** 既定は stderr。stdout には何も書かない。 */
  log?: (message: string) => void;
}

export interface ResolvedOptions {
  channels: Channel[];
  disableChannels: boolean;
  installMode: InstallMode;
  browsersPath: string | undefined;
  headless: boolean;
  launchTimeoutMs: number;
  log: (message: string) => void;
}

export const DEFAULT_CHANNELS: readonly Channel[] = ["chrome", "msedge"];
export const DEFAULT_LAUNCH_TIMEOUT_MS = 60_000;

const CHANNELS: readonly string[] = ["chrome", "msedge"];
const INSTALL_MODES: readonly string[] = ["auto", "registry", "custom"];

/**
 * 環境変数から AcquireOptions を作る（純関数）。設定されていない項目は含めない（既定値は acquireBrowser が補う）。
 *
 * - CSRC_CHANNELS: "msedge" / "chrome,msedge" など。未知の名前は捨て、有効なものが残らなければ既定に任せる
 * - CSRC_DISABLE_CHANNELS: "1" または "true" で有効
 * - CSRC_INSTALL_MODE: auto / registry / custom（未知の値は無視）
 * - PLAYWRIGHT_BROWSERS_PATH: browsersPath
 */
export function optionsFromEnv(env: Record<string, string | undefined>): AcquireOptions {
  const out: AcquireOptions = {};

  const rawChannels = env.CSRC_CHANNELS;
  if (rawChannels !== undefined) {
    const channels: Channel[] = [];
    for (const token of rawChannels.split(",")) {
      const name = token.trim().toLowerCase();
      if (CHANNELS.includes(name) && !channels.includes(name as Channel)) channels.push(name as Channel);
    }
    if (channels.length > 0) out.channels = channels;
  }

  const disable = env.CSRC_DISABLE_CHANNELS?.trim().toLowerCase();
  if (disable === "1" || disable === "true") out.disableChannels = true;

  const mode = env.CSRC_INSTALL_MODE?.trim().toLowerCase();
  if (mode !== undefined && INSTALL_MODES.includes(mode)) out.installMode = mode as InstallMode;

  const browsersPath = env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath !== undefined && browsersPath !== "") out.browsersPath = browsersPath;

  return out;
}

/** 既定値を補う（純関数）。browsersPath が無ければ env.PLAYWRIGHT_BROWSERS_PATH を使う（registry と同じ解釈にするため）。 */
export function resolveOptions(opts: AcquireOptions, env: Record<string, string | undefined>): ResolvedOptions {
  const envPath = env.PLAYWRIGHT_BROWSERS_PATH;
  return {
    channels: [...(opts.channels ?? DEFAULT_CHANNELS)],
    disableChannels: opts.disableChannels ?? false,
    installMode: opts.installMode ?? "auto",
    browsersPath: opts.browsersPath ?? (envPath === undefined || envPath === "" ? undefined : envPath),
    headless: opts.headless ?? true,
    launchTimeoutMs: opts.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
    log: opts.log ?? stderrLog,
  };
}
