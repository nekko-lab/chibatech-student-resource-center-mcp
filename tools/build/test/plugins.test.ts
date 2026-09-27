import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COREBUNDLE_FILTER,
  EXTERNALS,
  PLAYWRIGHT_CORE_RULES,
  patchPlaywrightCoreSource,
} from "../src/plugins.ts";

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
