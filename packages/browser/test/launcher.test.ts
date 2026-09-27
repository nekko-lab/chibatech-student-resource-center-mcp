import { fork, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { detectLaunchRole, runLauncher } from "../src/index.ts";
import { createLauncher, type LauncherProcess } from "../src/launcher.ts";

const OOP = "/snapshot/node_modules/playwright-core/lib/entry/oopBrowserDownload.js";

describe("detectLaunchRole", () => {
  it.each([
    // [説明, argv, hasIpc, 期待]
    ["通常の起動", ["/usr/bin/csrc-mcp"], false, "server"],
    ["bun compile の argv（仮想 FS のパスが入る）", ["bun", "/$bunfs/root/csrc-mcp", "--stdio"], false, "server"],
    ["node で直接起動", ["/usr/bin/node", "/repo/server.ts"], false, "server"],
    ["registry の fork（argv 末尾が oopBrowserDownload.js）", ["/usr/bin/csrc-mcp", OOP], true, "download-worker"],
    ["registry の fork（bun の argv）", ["bun", "/$bunfs/root/csrc-mcp", OOP], true, "download-worker"],
    ["Windows のパス", ["C:\\csrc\\csrc-mcp.exe", "C:\\snap\\playwright-core\\lib\\entry\\oopBrowserDownload.js"], true, "download-worker"],
    ["IPC が無くても argv で判定する", ["/usr/bin/csrc-mcp", OOP], false, "download-worker"],
    ["想定外の IPC 付き起動", ["/usr/bin/csrc-mcp"], true, "unexpected-ipc"],
    ["名前が似ているだけのファイル", ["/usr/bin/csrc-mcp", "/x/oopBrowserDownload.js.map"], true, "unexpected-ipc"],
    ["名前が似ているだけのファイル（IPC なし）", ["/usr/bin/csrc-mcp", "/x/myoopBrowserDownload.jsx"], false, "server"],
    ["空の argv", [], false, "server"],
    ["空の argv（IPC あり）", [], true, "unexpected-ipc"],
  ] as const)("%s", (_label, argv, hasIpc, expected) => {
    expect(detectLaunchRole(argv, hasIpc)).toBe(expected);
  });

  it("argv を書き換えない（純関数）", () => {
    const argv = Object.freeze(["/usr/bin/csrc-mcp", OOP]);
    expect(detectLaunchRole(argv, true)).toBe("download-worker");
    expect(argv).toEqual(["/usr/bin/csrc-mcp", OOP]);
  });
});

function fakeProcess(argv: string[], hasIpc: boolean, env: Record<string, string | undefined> = {}) {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const exit = vi.fn((code: number): never => {
    throw new ExitCalled(code);
  });
  const proc: LauncherProcess = {
    argv,
    env,
    send: hasIpc ? () => true : undefined,
    exit,
    stderr: { write: (s: string) => (stderr.push(s), true) },
  };
  return { proc, stderr, stdout, exit };
}

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

describe("runLauncher（process を差し替えて）", () => {
  it("server なら main を 1 回だけ呼び、argv[1] を潰す", async () => {
    const { proc, exit } = fakeProcess(["bun", "/$bunfs/root/csrc-mcp"], false);
    const runOop = vi.fn();
    const launcher = createLauncher({ process: proc, runOopDownloadBrowserMain: runOop });
    const main = vi.fn(async () => {});
    await launcher(main);
    expect(main).toHaveBeenCalledTimes(1);
    expect(runOop).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(proc.argv[1]).not.toBe("/$bunfs/root/csrc-mcp");
  });

  it("2 回呼ばれても main は 1 回しか走らない", async () => {
    const { proc, stderr } = fakeProcess(["bun", "/$bunfs/root/csrc-mcp"], false);
    const launcher = createLauncher({ process: proc, runOopDownloadBrowserMain: vi.fn() });
    const main = vi.fn(async () => {});
    await launcher(main);
    await launcher(main);
    expect(main).toHaveBeenCalledTimes(1);
    expect(stderr.join("")).toMatch(/2 回目/);
  });

  it("main の失敗はそのまま呼び出し元へ伝える", async () => {
    const { proc } = fakeProcess(["/usr/bin/csrc-mcp"], false);
    const launcher = createLauncher({ process: proc, runOopDownloadBrowserMain: vi.fn() });
    await expect(launcher(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("download-worker なら Playwright のダウンロード処理に振り分け、main は呼ばない", async () => {
    const { proc, exit } = fakeProcess(["/usr/bin/csrc-mcp", OOP], true);
    const runOop = vi.fn();
    const launcher = createLauncher({ process: proc, runOopDownloadBrowserMain: runOop });
    const main = vi.fn(async () => {});
    await launcher(main);
    expect(runOop).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("想定外の IPC 付き起動は stderr に理由を書いて exit 3", async () => {
    const { proc, stderr, exit } = fakeProcess(["/usr/bin/csrc-mcp", "--x"], true);
    const launcher = createLauncher({ process: proc, runOopDownloadBrowserMain: vi.fn() });
    const main = vi.fn(async () => {});
    await expect(launcher(main)).rejects.toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledWith(3);
    expect(main).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(/想定外/);
  });

  it("CSRC_DISABLE_OOP_DISPATCH=1 なら振り分けを切る（custom への切り替えの確認用）", async () => {
    const { proc, exit } = fakeProcess(["/usr/bin/csrc-mcp", OOP], true, { CSRC_DISABLE_OOP_DISPATCH: "1" });
    const runOop = vi.fn();
    const launcher = createLauncher({ process: proc, runOopDownloadBrowserMain: runOop });
    await expect(launcher(async () => {})).rejects.toThrow(ExitCalled);
    expect(runOop).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(3);
  });

  it("runLauncher は関数として公開されている", () => {
    expect(runLauncher).toBeTypeOf("function");
  });
});

describe("runLauncher（子プロセスで）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entry = path.join(here, "fixtures", "launcher-entry.ts");

  function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string; messages: unknown[] }> {
    return new Promise((resolve, reject) => {
      // fork は IPC 付きで起動する。registry が oopBrowserDownload.js を fork するのと同じ形。
      const child = fork(entry, args, { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, CSRC_DISABLE_OOP_DISPATCH: "" } });
      let stdout = "";
      let stderr = "";
      const messages: unknown[] = [];
      child.stdout!.on("data", (d) => (stdout += d));
      child.stderr!.on("data", (d) => (stderr += d));
      child.on("message", (m) => messages.push(m));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr, messages }));
      // oop のワーカーは親との切断で終了する（runOopDownloadBrowserMain の約束）。
      setTimeout(() => child.connected && child.disconnect(), 1500);
    });
  }

  it("IPC なしで起動されたら main を 1 回だけ走らせ、stdout には何も書かない", async () => {
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [entry], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.match(/MAIN_RAN/g)).toHaveLength(1);
  }, 30_000);

  it("IPC 付きで起動されたら main を走らせずに exit 3", async () => {
    const r = await run([]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toMatch(/MAIN_RAN/);
    expect(r.stderr).toMatch(/想定外/);
  }, 30_000);

  it("argv が oopBrowserDownload.js なら Playwright のワーカーとして待ち、切断で 0 終了（main は走らない）", async () => {
    const r = await run([OOP]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toMatch(/MAIN_RAN/);
  }, 30_000);
});
