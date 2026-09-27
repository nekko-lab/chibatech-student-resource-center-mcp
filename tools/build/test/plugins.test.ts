import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COREBUNDLE_FILTER,
  EXTERNALS,
  PLAYWRIGHT_CORE_RULES,
  SERVER_VERSION_FILTER,
  patchPlaywrightCoreSource,
  patchServerVersionSource,
} from "../src/plugins.ts";

describe("patchServerVersionSource（packages/server/src/version.ts の版をビルドの版にする）", () => {
  // dev の packages/server/src/version.ts と同じ形
  const source = [
    "/** サーバの版。package.json の version と揃える（テストで照合している） */",
    'export const VERSION = "0.1.0";',
    "",
    'export const SERVER_NAME = "chibatech-src-mcp";',
    "export const USER_AGENT = `${SERVER_NAME}/${VERSION} (unofficial)`;",
  ].join("\n");

  it("VERSION の値だけを差し替える（User-Agent はそこから作られる）", () => {
    const out = patchServerVersionSource(source, "1.2.3-rc.1");
    expect(out).toContain('export const VERSION = "1.2.3-rc.1";');
    expect(out).not.toContain('"0.1.0"');
    expect(out).toContain("export const USER_AGENT = `${SERVER_NAME}/${VERSION} (unofficial)`;");
  });

  it("対象が 1 件でなければ止める", () => {
    expect(() => patchServerVersionSource("export const NAME = 1;", "1.2.3")).toThrow(/0 件/);
    expect(() => patchServerVersionSource(`${source}\n${source}`, "1.2.3")).toThrow(/2 件/);
  });

  it("semver でない版は拒む", () => {
    expect(() => patchServerVersionSource(source, '1.2.3"; evil()')).toThrow(/semver/);
  });

  it("packages/server/src/version.ts だけに当たる", () => {
    expect(SERVER_VERSION_FILTER.test("/repo/packages/server/src/version.ts")).toBe(true);
    expect(SERVER_VERSION_FILTER.test("C:\\repo\\packages\\server\\src\\version.ts")).toBe(true);
    expect(SERVER_VERSION_FILTER.test("/repo/packages/browser/src/version.ts")).toBe(false);
  });
});

const sample = [
  'const packageJson = require(import_path3.default.join(packageRoot, "package.json"));',
  'const browsersJson = require(import_path12.default.join(packageRoot, "browsers.json"));',
].join("\n");

describe("patchPlaywrightCoreSource", () => {
  it("package.json と browsers.json の実行時パスの require を静的な require に書き換える", () => {
    const out = patchPlaywrightCoreSource(sample);
    expect(out).toContain('require("../package.json")');
    expect(out).toContain('require("../browsers.json")');
    expect(out).not.toContain("packageRoot");
  });

  it("対象が 0 件ならビルドを止める", () => {
    expect(() => patchPlaywrightCoreSource(sample.split("\n")[0]!)).toThrow(/browsers\\\.json.*0 件/);
  });

  it("対象が 2 件以上でもビルドを止める", () => {
    expect(() => patchPlaywrightCoreSource(`${sample}\n${sample}`)).toThrow(/2 件/);
  });

  it("規則は 2 つ", () => {
    expect(PLAYWRIGHT_CORE_RULES).toHaveLength(2);
  });
});

describe("COREBUNDLE_FILTER", () => {
  it("playwright-core の coreBundle.js だけに当たる（区切りは / と \\ の両方）", () => {
    expect(COREBUNDLE_FILTER.test("/repo/node_modules/playwright-core/lib/coreBundle.js")).toBe(true);
    expect(COREBUNDLE_FILTER.test("C:\\repo\\node_modules\\playwright-core\\lib\\coreBundle.js")).toBe(true);
    expect(COREBUNDLE_FILTER.test("/repo/node_modules/playwright-core/lib/server/index.js")).toBe(false);
    expect(COREBUNDLE_FILTER.test("/repo/node_modules/playwright/lib/coreBundle.js")).toBe(false);
  });
});

describe("EXTERNALS", () => {
  it("chromium-bidi を外部扱いにする", () => {
    expect(EXTERNALS).toEqual(["chromium-bidi", "chromium-bidi/*"]);
  });
});

describe("固定版の playwright-core（1.63.0）", () => {
  it("coreBundle.js に置換規則が 1 件ずつ当たる", () => {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("playwright-core/package.json");
    const version = (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
    expect(version).toBe("1.63.0");
    const source = readFileSync(path.join(path.dirname(pkg), "lib", "coreBundle.js"), "utf8");
    const out = patchPlaywrightCoreSource(source);
    expect(out).toContain('require("../package.json")');
    expect(out).toContain('require("../browsers.json")');
  });
});
