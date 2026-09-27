import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserUnavailableError, acquireBrowser } from "../src/index.ts";
import { channelInstalled } from "./helpers.ts";

// テストイメージ（mcr.microsoft.com/playwright:v1.63.0-noble）は /ms-playwright にブラウザを持っている。
const IMAGE_BROWSERS = "/ms-playwright";
const hasImageBrowsers = existsSync(path.join(IMAGE_BROWSERS, "chromium_headless_shell-1243", "INSTALLATION_COMPLETE"));
const NET = process.env.NET === "1";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function collect() {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
}

describe.skipIf(!hasImageBrowsers)("acquireBrowser（テストイメージのブラウザで）", () => {
  it("disableChannels + browsersPath なら、ダウンロードせずに既存の headless shell で起動する", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const { lines, log } = collect();
    const r = await acquireBrowser({ disableChannels: true, browsersPath: IMAGE_BROWSERS, log });
    try {
      expect(r.via).toBe("download");
      expect(r.executablePath).toMatch(/^\/ms-playwright\/chromium_headless_shell-1243\/chrome-headless-shell-linux(64|-arm64)\/chrome-headless-shell$/);
      const page = await r.browser.newPage();
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
      expect(r.browser.version()).toMatch(/^153\./);
    } finally {
      await r.browser.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    const text = lines.join("\n");
    expect(text).toMatch(/channel.*省略/);
    expect(text).toMatch(/導入済み/);
    expect(text).toMatch(/via=download/);
  }, 60_000);

  it("log を渡さなければ stderr にだけ書く（stdout は MCP の transport 専用）", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const r = await acquireBrowser({ disableChannels: true, browsersPath: IMAGE_BROWSERS });
    await r.browser.close();
    expect(stdoutSpy).not.toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toMatch(/^\[csrc-browser\] /m);
    expect(written).toMatch(/via=download/);
  }, 60_000);

  it("channel が無いときは理由を残して次へ進み、最後はダウンロード経路で起動する", async () => {
    const { lines, log } = collect();
    const r = await acquireBrowser({ channels: ["chrome", "msedge"], browsersPath: IMAGE_BROWSERS, log });
    try {
      const text = lines.join("\n");
      if (channelInstalled("chrome")) {
        expect(r.via).toBe("chrome");
        return;
      }
      // chrome が無い（Linux arm64 には配布が無い）→ 理由を残して msedge へ
      expect(text).toMatch(/chrome: 失敗 \(\d+ms\): .+/);
      if (channelInstalled("msedge")) {
        expect(r.via).toBe("msedge");
        return;
      }
      expect(text).toMatch(/msedge: 失敗 \(\d+ms\): .+/);
      expect(r.via).toBe("download");
      // 試した順に並ぶ
      expect(text.indexOf("chrome: 失敗")).toBeLessThan(text.indexOf("msedge: 失敗"));
      expect(text.indexOf("msedge: 失敗")).toBeLessThan(text.indexOf("via=download"));
    } finally {
      await r.browser.close();
    }
  }, 120_000);

  it("channels の並びを守る（msedge だけ）", async () => {
    const { lines, log } = collect();
    const r = await acquireBrowser({ channels: ["msedge"], browsersPath: IMAGE_BROWSERS, log });
    await r.browser.close();
    const text = lines.join("\n");
    expect(text).not.toMatch(/chrome: /);
    expect(r.via).toBe(channelInstalled("msedge") ? "msedge" : "download");
  }, 120_000);
});

describe("acquireBrowser（すべて失敗したとき）", () => {
  it.skipIf(channelInstalled("msedge"))(
    "試した経路ごとの理由を持つ BrowserUnavailableError を投げる",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "brw-acquire-"));
      // 閉じたポートを mirror にして、ネットワークに出ずにダウンロードを失敗させる
      vi.stubEnv("PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST", "http://127.0.0.1:9");
      const { lines, log } = collect();
      try {
        const error = await acquireBrowser({ channels: ["msedge"], browsersPath: dir, installMode: "custom", log }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BrowserUnavailableError);
        const e = error as BrowserUnavailableError;
        expect(e.name).toBe("BrowserUnavailableError");
        expect(e.attempts.map((a) => a.via)).toEqual(["msedge", "download"]);
        for (const a of e.attempts) expect(a.reason.length).toBeGreaterThan(0);
        expect(e.attempts[1]!.reason).toMatch(/custom/);
        expect(e.message).toMatch(/msedge: /);
        expect(e.message).toMatch(/download: /);
        expect(lines.join("\n")).toMatch(/msedge: 失敗/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("disableChannels なら channel は試した経路に含めない", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "brw-acquire-"));
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST", "http://127.0.0.1:9");
    try {
      const error = await acquireBrowser({ disableChannels: true, browsersPath: dir, installMode: "custom", log: () => {} }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(BrowserUnavailableError);
      expect((error as BrowserUnavailableError).attempts.map((a) => a.via)).toEqual(["download"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

// 実際にダウンロードする（約 120 MB）。既定ではスキップし、NET=1 のときだけ動かす。
describe.skipIf(!NET)("acquireBrowser（NET=1: 実際のダウンロード）", () => {
  it("custom: CDN から取得して起動する", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "brw-net-"));
    const { lines, log } = collect();
    try {
      const r = await acquireBrowser({ disableChannels: true, browsersPath: dir, installMode: "custom", log });
      try {
        expect(r.via).toBe("download");
        expect(r.executablePath!.startsWith(dir)).toBe(true);
        expect(r.browser.version()).toMatch(/^153\./);
      } finally {
        await r.browser.close();
      }
      expect(lines.join("\n")).toMatch(/custom: .*cdn\.playwright\.dev/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 600_000);

  it("registry: playwright-core の registry で取得して起動する（子プロセスで置き場所を切り替える）", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "brw-net-"));
    const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "acquire-entry.ts");
    try {
      const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [entry], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dir, CSRC_DISABLE_CHANNELS: "1", CSRC_INSTALL_MODE: "registry" },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, stdout, stderr }));
      });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/registry: 成功/);
      expect(r.stderr).toMatch(/ACQUIRED via=download/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
