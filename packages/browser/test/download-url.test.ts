import path from "node:path";
import { describe, expect, it } from "vitest";
import { browsersDirectory, customDownloadUrl, headlessShellLayout } from "../src/index.ts";
import { bundledBrowsersJson } from "../src/download-url.ts";

// playwright-core 1.63.0 の browsers.json と同じ版。期待値は registry の DOWNLOAD_PATHS["chromium-headless-shell"]
// （cftUrl(...) と mirror "https://cdn.playwright.dev"）から導いた。
const BROWSERS_JSON = {
  comment: "fixture",
  browsers: [
    { name: "chromium", revision: "1243", installByDefault: true, browserVersion: "153.0.8010.12" },
    { name: "chromium-headless-shell", revision: "1243", installByDefault: true, browserVersion: "153.0.8010.12" },
    { name: "firefox", revision: "1543", installByDefault: true, browserVersion: "155.0" },
  ],
};
const CDN = "https://cdn.playwright.dev/builds/cft/153.0.8010.12";

describe("customDownloadUrl", () => {
  it.each([
    ["darwin", "arm64", `${CDN}/mac-arm64/chrome-headless-shell-mac-arm64.zip`],
    ["darwin", "x64", `${CDN}/mac-x64/chrome-headless-shell-mac-x64.zip`],
    ["win32", "x64", `${CDN}/win64/chrome-headless-shell-win64.zip`],
    ["linux", "x64", `${CDN}/linux64/chrome-headless-shell-linux64.zip`],
    ["linux", "arm64", `${CDN}/linux-arm64/chrome-headless-shell-linux-arm64.zip`],
  ])("%s %s", (platform, arch, url) => {
    expect(customDownloadUrl({ browsersJson: BROWSERS_JSON, platform, arch })).toEqual({
      url,
      revision: "1243",
      browserVersion: "153.0.8010.12",
    });
  });

  it("Windows は arch によらず win64（registry の hostPlatform と同じ）", () => {
    expect(customDownloadUrl({ browsersJson: BROWSERS_JSON, platform: "win32", arch: "arm64" }).url).toBe(
      `${CDN}/win64/chrome-headless-shell-win64.zip`,
    );
  });

  it("hostOverride で mirror を差し替える（末尾のスラッシュは 1 つにまとめる）", () => {
    const expected = "http://127.0.0.1:8080/mirror/builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip";
    for (const hostOverride of ["http://127.0.0.1:8080/mirror", "http://127.0.0.1:8080/mirror/", "http://127.0.0.1:8080/mirror//"]) {
      expect(customDownloadUrl({ browsersJson: BROWSERS_JSON, platform: "linux", arch: "x64", hostOverride }).url).toBe(expected);
    }
  });

  it("空の hostOverride は無視する", () => {
    expect(customDownloadUrl({ browsersJson: BROWSERS_JSON, platform: "linux", arch: "x64", hostOverride: "" }).url).toBe(
      `${CDN}/linux64/chrome-headless-shell-linux64.zip`,
    );
  });

  it.each([
    ["freebsd", "x64"],
    ["linux", "ia32"],
    ["linux", "riscv64"],
    ["darwin", "ppc64"],
    ["aix", "ppc64"],
  ])("未対応の %s %s は理由付きで投げる", (platform, arch) => {
    expect(() => customDownloadUrl({ browsersJson: BROWSERS_JSON, platform, arch })).toThrow(/未対応/);
  });

  it.each([
    ["null", null],
    ["配列でない browsers", { browsers: {} }],
    ["headless shell が無い", { browsers: [{ name: "chromium", revision: "1", browserVersion: "1.0" }] }],
    ["browserVersion が無い", { browsers: [{ name: "chromium-headless-shell", revision: "1243" }] }],
    ["revision が文字列でない", { browsers: [{ name: "chromium-headless-shell", revision: 1243, browserVersion: "1.0" }] }],
  ])("browsers.json が不正（%s）なら投げる", (_label, browsersJson) => {
    expect(() => customDownloadUrl({ browsersJson, platform: "linux", arch: "x64" })).toThrow(/browsers\.json/);
  });

  it("同梱の browsers.json（playwright-core 1.63.0）から組み立てられる", () => {
    const r = customDownloadUrl({ browsersJson: bundledBrowsersJson, platform: "linux", arch: "x64" });
    expect(r.revision).toBe("1243");
    expect(r.browserVersion).toBe("153.0.8010.12");
    expect(r.url).toBe(`${CDN}/linux64/chrome-headless-shell-linux64.zip`);
  });

  it("この機械では playwright-core の registry が出す URL と一致する", async () => {
    const core = await import("playwright-core/lib/coreBundle");
    const exe = core.registry.registry.findExecutable("chromium-headless-shell");
    expect(exe).toBeDefined();
    const env = process.env;
    const hostOverride = env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST || env.PLAYWRIGHT_DOWNLOAD_HOST;
    const ours = customDownloadUrl({ browsersJson: bundledBrowsersJson, platform: process.platform, arch: process.arch, hostOverride });
    expect(exe!.downloadURLs).toEqual([ours.url]);
    expect(exe!.revision).toBe(ours.revision);
    expect(exe!.browserVersion).toBe(ours.browserVersion);
  });
});

describe("headlessShellLayout", () => {
  it.each([
    ["darwin", "arm64", ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"]],
    ["darwin", "x64", ["chrome-headless-shell-mac-x64", "chrome-headless-shell"]],
    ["win32", "x64", ["chrome-headless-shell-win64", "chrome-headless-shell.exe"]],
    ["linux", "x64", ["chrome-headless-shell-linux64", "chrome-headless-shell"]],
    ["linux", "arm64", ["chrome-headless-shell-linux-arm64", "chrome-headless-shell"]],
  ])("%s %s の置き場所は registry と同じ", (platform, arch, tokens) => {
    const layout = headlessShellLayout({ browsersJson: BROWSERS_JSON, platform, arch, browsersDir: "/pw" });
    const dir = path.join("/pw", "chromium_headless_shell-1243");
    expect(layout).toEqual({
      browserDirectory: dir,
      executablePath: path.join(dir, ...tokens),
      marker: path.join(dir, "INSTALLATION_COMPLETE"),
      revision: "1243",
    });
  });

  it("この機械では registry の executablePath と一致する", async () => {
    const core = await import("playwright-core/lib/coreBundle");
    const exe = core.registry.registry.findExecutable("chromium-headless-shell")!;
    const layout = headlessShellLayout({
      browsersJson: bundledBrowsersJson,
      platform: process.platform,
      arch: process.arch,
      browsersDir: core.registry.registryDirectory,
    });
    expect(layout.browserDirectory).toBe(exe.directory);
    expect(layout.executablePath).toBe(exe.executablePath());
  });
});

describe("browsersDirectory", () => {
  const home = "/home/u";
  it("browsersPath を優先する（相対パスは cwd から解決）", () => {
    expect(browsersDirectory({ browsersPath: "/pw", platform: "linux", env: {}, homedir: home, cwd: "/w" })).toBe("/pw");
    expect(browsersDirectory({ browsersPath: "rel/pw", platform: "linux", env: {}, homedir: home, cwd: "/w" })).toBe(
      path.resolve("/w", "rel/pw"),
    );
  });

  it("Linux は XDG_CACHE_HOME、無ければ ~/.cache", () => {
    expect(browsersDirectory({ platform: "linux", env: {}, homedir: home, cwd: "/" })).toBe(path.join(home, ".cache", "ms-playwright"));
    expect(browsersDirectory({ platform: "linux", env: { XDG_CACHE_HOME: "/xdg" }, homedir: home, cwd: "/" })).toBe(
      path.join("/xdg", "ms-playwright"),
    );
  });

  it("macOS は ~/Library/Caches", () => {
    expect(browsersDirectory({ platform: "darwin", env: {}, homedir: "/Users/u", cwd: "/" })).toBe(
      path.join("/Users/u", "Library", "Caches", "ms-playwright"),
    );
  });

  it("Windows は LOCALAPPDATA、無ければ ~/AppData/Local", () => {
    expect(browsersDirectory({ platform: "win32", env: { LOCALAPPDATA: "/lad" }, homedir: home, cwd: "/" })).toBe(
      path.join("/lad", "ms-playwright"),
    );
    expect(browsersDirectory({ platform: "win32", env: {}, homedir: home, cwd: "/" })).toBe(
      path.join(home, "AppData", "Local", "ms-playwright"),
    );
  });

  it("browsersPath が空か \"0\" のときは既定の置き場所（単一バイナリには .local-browsers が無いため）", () => {
    for (const browsersPath of ["", "0"]) {
      expect(browsersDirectory({ browsersPath, platform: "linux", env: {}, homedir: home, cwd: "/" })).toBe(
        path.join(home, ".cache", "ms-playwright"),
      );
    }
  });
});
