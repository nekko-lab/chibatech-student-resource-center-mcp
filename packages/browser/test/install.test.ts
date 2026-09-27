import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { access, constants, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headlessShellLayout } from "../src/index.ts";
import { ensureHeadlessShell, type InstallContext } from "../src/install.ts";
import { makeZip } from "./helpers.ts";

const BROWSERS_JSON = {
  browsers: [{ name: "chromium-headless-shell", revision: "9999", browserVersion: "999.0.0.1" }],
};
const PLATFORM = "linux";
const ARCH = "x64";
const EXE_DIR = "chrome-headless-shell-linux64";
const URL_PATH = "/builds/cft/999.0.0.1/linux64/chrome-headless-shell-linux64.zip";

let dir: string;
let logs: string[];
let server: Server | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "brw-install-"));
  logs = [];
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

function ctx(extra: Partial<InstallContext> = {}): InstallContext {
  return {
    browsersDir: dir,
    browsersJson: BROWSERS_JSON,
    platform: PLATFORM,
    arch: ARCH,
    installMode: "custom",
    log: (m) => logs.push(m),
    ...extra,
  };
}

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function isExecutable(p: string): Promise<boolean> {
  return access(p, constants.X_OK).then(
    () => true,
    () => false,
  );
}

describe("ensureHeadlessShell", () => {
  it("導入済み（INSTALLATION_COMPLETE と実行ファイルがある）ならダウンロードしない", async () => {
    const layout = headlessShellLayout({ browsersJson: BROWSERS_JSON, platform: PLATFORM, arch: ARCH, browsersDir: dir });
    await mkdir(path.dirname(layout.executablePath), { recursive: true });
    await writeFile(layout.executablePath, "#!/bin/sh\n");
    await writeFile(layout.marker, "");
    const fetchImpl = vi.fn(async () => new Response("x"));
    const r = await ensureHeadlessShell(ctx({ fetch: fetchImpl as unknown as typeof fetch, installMode: "auto" }));
    expect(r.source).toBe("cached");
    expect(r.executablePath).toBe(layout.executablePath);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("custom: mirror から取得して展開し、実行ビットと INSTALLATION_COMPLETE を付ける", async () => {
    const zip = await makeZip([
      { name: `${EXE_DIR}/chrome-headless-shell`, content: "#!/bin/sh\necho fake\n", mode: 0o644 },
      { name: `${EXE_DIR}/locales/ja.pak`, content: "pak" },
      { name: `${EXE_DIR}/tool`, content: "#!/bin/sh\n", mode: 0o755 },
    ]);
    const requests: { url?: string; ua?: string }[] = [];
    const host = await serve((req, res) => {
      requests.push({ url: req.url, ua: req.headers["user-agent"] });
      if (req.url !== URL_PATH) return res.writeHead(404).end();
      res.writeHead(200, { "content-length": String(zip.length) }).end(zip);
    });

    const r = await ensureHeadlessShell(ctx({ hostOverride: host }));
    const layout = headlessShellLayout({ browsersJson: BROWSERS_JSON, platform: PLATFORM, arch: ARCH, browsersDir: dir });
    expect(r.source).toBe("custom");
    expect(r.url).toBe(`${host}${URL_PATH}`);
    expect(r.executablePath).toBe(layout.executablePath);
    expect(await readFile(layout.executablePath, "utf8")).toContain("echo fake");
    expect(await isExecutable(layout.executablePath)).toBe(true);
    expect(await isExecutable(path.join(layout.browserDirectory, EXE_DIR, "tool"))).toBe(true);
    expect(await readFile(path.join(layout.browserDirectory, EXE_DIR, "locales", "ja.pak"), "utf8")).toBe("pak");
    expect((await stat(layout.marker)).isFile()).toBe(true);
    // 一時ファイル（zip・展開途中のディレクトリ）を残さない
    expect(await readdir(dir)).toEqual([path.basename(layout.browserDirectory)]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.ua).toMatch(/unofficial/);
    expect(logs.join("\n")).toContain(r.url!);
  });

  it("custom: 途中で止まった導入（INSTALLATION_COMPLETE が無い）は置き換える", async () => {
    const layout = headlessShellLayout({ browsersJson: BROWSERS_JSON, platform: PLATFORM, arch: ARCH, browsersDir: dir });
    await mkdir(layout.browserDirectory, { recursive: true });
    await writeFile(path.join(layout.browserDirectory, "garbage"), "x");
    const zip = await makeZip([{ name: `${EXE_DIR}/chrome-headless-shell`, content: "#!/bin/sh\n" }]);
    const host = await serve((_req, res) => res.writeHead(200).end(zip));
    const r = await ensureHeadlessShell(ctx({ hostOverride: host }));
    expect(r.source).toBe("custom");
    expect(await readdir(layout.browserDirectory)).not.toContain("garbage");
  });

  it("custom: HTTP エラーは状態コード付きで失敗し、何も残さない", async () => {
    const host = await serve((_req, res) => res.writeHead(404).end("nope"));
    await expect(ensureHeadlessShell(ctx({ hostOverride: host }))).rejects.toThrow(/custom.*HTTP 404/s);
    expect(await readdir(dir)).toEqual([]);
  });

  it("custom: zip に実行ファイルが無ければ失敗する", async () => {
    const zip = await makeZip([{ name: "other/file", content: "x" }]);
    const host = await serve((_req, res) => res.writeHead(200).end(zip));
    await expect(ensureHeadlessShell(ctx({ hostOverride: host }))).rejects.toThrow(/実行ファイル/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("custom: 受信が止まったら stallTimeoutMs で打ち切る", async () => {
    const host = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "1000000" });
      res.write(Buffer.alloc(10));
      // 以後は何も送らない
    });
    const t0 = Date.now();
    await expect(ensureHeadlessShell(ctx({ hostOverride: host, stallTimeoutMs: 300 }))).rejects.toThrow(/受信が止まった/);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("registry: registry の置き場所が指定と違えば、理由を残して使わない", async () => {
    await expect(ensureHeadlessShell(ctx({ installMode: "registry" }))).rejects.toThrow(/registry.*置き場所/s);
  });

  it("auto: registry が使えなければ custom に切り替え、両方の経過を log に残す", async () => {
    const zip = await makeZip([{ name: `${EXE_DIR}/chrome-headless-shell`, content: "#!/bin/sh\n" }]);
    const host = await serve((_req, res) => res.writeHead(200).end(zip));
    const r = await ensureHeadlessShell(ctx({ installMode: "auto", hostOverride: host }));
    expect(r.source).toBe("custom");
    const text = logs.join("\n");
    expect(text).toMatch(/registry.*失敗/);
    expect(text).toMatch(/custom/);
  });

  it("auto: 両方失敗したら方式ごとの理由をまとめて投げる", async () => {
    const host = await serve((_req, res) => res.writeHead(500).end());
    const error = await ensureHeadlessShell(ctx({ installMode: "auto", hostOverride: host })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/registry: .*置き場所/);
    expect((error as Error).message).toMatch(/custom: .*HTTP 500/);
  });

  it("process.exitCode を汚さない", async () => {
    const before = process.exitCode;
    await ensureHeadlessShell(ctx({ installMode: "registry" })).catch(() => undefined);
    expect(process.exitCode).toBe(before);
  });
});
