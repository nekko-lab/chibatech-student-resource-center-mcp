/// <reference path="./playwright-internals.d.ts" />
/**
 * 単一バイナリの入口での振り分け。
 *
 * 1. playwright-core の registry.install は `child_process.fork(<lib>/entry/oopBrowserDownload.js)` で
 *    ダウンロード用の子を起こす。単一バイナリでは fork が「バイナリ自身」を起動するため、何もしないと
 *    子が MCP サーバとして立ち上がり、親は永久に待つ。argv が oopBrowserDownload.js で終わる起動は
 *    Playwright のダウンロード処理（registry.runOopDownloadBrowserMain）に振り分ける。
 * 2. それ以外の IPC 付き起動（想定外の fork）は、サーバを立ち上げずに exit 3 で終える。
 *    Bun の fork は NODE_CHANNEL_FD を設定しないので、IPC の有無は process.send の有無で見る。
 * 3. bun compile の中では「import.meta.url と process.argv[1] の比較」が真になり main が二重に走る
 *    既知の問題がある。main は必ず runLauncher から 1 回だけ呼び、argv[1] は潰しておく。
 */

export type LaunchRole = "server" | "download-worker" | "unexpected-ipc";

const OOP_DOWNLOAD_ENTRY = /(^|[\\/])oopBrowserDownload\.js$/;

/** 起動の役割を決める（純関数）。argv に oopBrowserDownload.js で終わる引数があれば、IPC の有無によらず download-worker。 */
export function detectLaunchRole(argv: readonly string[], hasIpc: boolean): LaunchRole {
  if (argv.some((arg) => OOP_DOWNLOAD_ENTRY.test(arg))) return "download-worker";
  if (hasIpc) return "unexpected-ipc";
  return "server";
}

/** runLauncher が触る process の部分（テストで差し替える）。 */
export interface LauncherProcess {
  argv: string[];
  env: Record<string, string | undefined>;
  send?: unknown;
  exit(code: number): never;
  stderr: { write(chunk: string): boolean };
}

export interface LauncherDeps {
  process: LauncherProcess;
  /** 既定は playwright-core の registry.runOopDownloadBrowserMain。 */
  runOopDownloadBrowserMain: () => void | Promise<void>;
}

/** 振り分けの検証用: CSRC_DISABLE_OOP_DISPATCH=1 で 1 の対処を切り、registry が失敗して custom に切り替わることを確かめる。 */
export const ENV_DISABLE_OOP_DISPATCH = "CSRC_DISABLE_OOP_DISPATCH";

const NEUTRAL_ARGV1 = "csrc-launcher";

/** 依存を差し替えられる runLauncher を作る。main は何度呼ばれても 1 回しか走らない。 */
export function createLauncher(deps: LauncherDeps): (main: () => Promise<void>) => Promise<void> {
  let started = false;
  return async (main) => {
    const proc = deps.process;
    let role = detectLaunchRole(proc.argv, typeof proc.send === "function");
    if (role === "download-worker" && proc.env[ENV_DISABLE_OOP_DISPATCH] === "1") role = "unexpected-ipc";

    if (role === "download-worker") {
      // 子の stdout は親と共有される（MCP の transport を汚さないよう、進捗は IPC で親へ送られる）。
      await deps.runOopDownloadBrowserMain();
      return;
    }
    if (role === "unexpected-ipc") {
      proc.stderr.write(`[csrc-browser] 想定外の IPC 付き起動のため終了します: ${JSON.stringify(proc.argv.slice(1))}\n`);
      proc.exit(3);
    }
    if (started) {
      proc.stderr.write("[csrc-browser] runLauncher の 2 回目の呼び出しは無視しました（main は 1 回だけ走らせます）\n");
      return;
    }
    started = true;
    if (proc.argv.length > 1) proc.argv[1] = NEUTRAL_ARGV1;
    await main();
  };
}

async function defaultRunOopDownloadBrowserMain(): Promise<void> {
  const core = await import("playwright-core/lib/coreBundle");
  core.registry.runOopDownloadBrowserMain();
}

let defaultLauncher: ((main: () => Promise<void>) => Promise<void>) | undefined;

/**
 * 単一バイナリの入口。detectLaunchRole(process.argv, typeof process.send === "function") で振り分け、
 * server なら main を 1 回だけ呼ぶ。main は必ずここから呼ぶこと。
 */
export function runLauncher(main: () => Promise<void>): Promise<void> {
  defaultLauncher ??= createLauncher({
    process: process as unknown as LauncherProcess,
    runOopDownloadBrowserMain: defaultRunOopDownloadBrowserMain,
  });
  return defaultLauncher(main);
}
