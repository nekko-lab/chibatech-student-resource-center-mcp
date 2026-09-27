import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectNotices,
  isLicenseFileName,
  packageOfPath,
  pdfjsAssetLicenseSections,
  renderNotices,
  type NoticeSection,
} from "../src/notices.ts";

describe("packageOfPath", () => {
  it("最後の node_modules の直下をパッケージとみなす（scope 付きも）", () => {
    expect(packageOfPath("/repo/node_modules/zod/v4/index.js")).toEqual({ name: "zod", root: "/repo/node_modules/zod" });
    expect(packageOfPath("/repo/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js")).toEqual({
      name: "@modelcontextprotocol/sdk",
      root: "/repo/node_modules/@modelcontextprotocol/sdk",
    });
    expect(packageOfPath("/repo/node_modules/a/node_modules/b/index.js")).toEqual({
      name: "b",
      root: "/repo/node_modules/a/node_modules/b",
    });
  });

  it("Windows の区切りも読む", () => {
    expect(packageOfPath("C:\\repo\\node_modules\\zod\\index.js")?.name).toBe("zod");
  });

  it("node_modules の外（ワークスペースや poc の自前のコード）は undefined", () => {
    expect(packageOfPath("/repo/packages/pdf/src/index.ts")).toBeUndefined();
    expect(packageOfPath("/repo/poc/src/server.ts")).toBeUndefined();
  });
});

describe("isLicenseFileName", () => {
  it("LICENSE / NOTICE / COPYING / ThirdPartyNotices と、その派生の名前", () => {
    for (const n of ["LICENSE", "LICENSE.md", "license.txt", "LICENCE", "LICENSE-MIT", "LICENSE_FOXIT", "NOTICE", "COPYING", "ThirdPartyNotices.txt"]) {
      expect(isLicenseFileName(n)).toBe(true);
    }
    for (const n of ["README.md", "package.json", "licenses.js", "index.js"]) {
      expect(isLicenseFileName(n)).toBe(false);
    }
  });
});

describe("renderNotices", () => {
  const sections: NoticeSection[] = [
    { title: "zod@4.6.5", license: "MIT", files: [{ name: "LICENSE", text: "MIT License\nCopyright (c) Z\n" }] },
    { title: "Bun 1.4.2", license: "MIT (and statically linked libraries)", files: [{ name: "LICENSE.md", text: "Bun itself is MIT-licensed." }] },
  ];

  it("見出しに非公式である旨と、節ごとの名前・ライセンス・本文を並べる", () => {
    const text = renderNotices(sections);
    expect(text).toContain("非公式");
    expect(text).toContain("zod@4.6.5");
    expect(text).toContain("License: MIT");
    expect(text).toContain("--- LICENSE ---");
    expect(text).toContain("Copyright (c) Z");
    expect(text.indexOf("zod@4.6.5")).toBeLessThan(text.indexOf("Bun 1.4.2"));
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("collectNotices（依存の node_modules）", () => {
  const require = createRequire(import.meta.url);
  const root = (spec: string) => path.dirname(require.resolve(`${spec}/package.json`));

  it("入力ファイルからパッケージを集め、LICENSE と NOTICE を読む", () => {
    const pw = root("playwright-core");
    const zod = root("zod");
    const { sections, missing } = collectNotices([
      path.join(pw, "lib", "coreBundle.js"),
      path.join(zod, "index.js"),
      path.join(zod, "v4", "index.js"),
      "/repo/packages/pdf/src/index.ts",
    ]);
    expect(missing).toEqual([]);
    expect(sections.map((s) => s.title)).toEqual(["playwright-core@1.63.0", `zod@${require("zod/package.json").version}`]);
    const pwFiles = sections[0]!.files.map((f) => f.name);
    expect(pwFiles).toEqual(expect.arrayContaining(["LICENSE", "NOTICE", "ThirdPartyNotices.txt"]));
    expect(sections[0]!.license).toBe("Apache-2.0");
  });

  it("ライセンスファイルの無いパッケージは missing に挙げる", () => {
    const fs = {
      readdir: (dir: string) => (dir === "/r/node_modules/x" ? ["package.json", "index.js"] : []),
      readText: (p: string) => (p === "/r/node_modules/x/package.json" ? '{"name":"x","version":"1.0.0","license":"MIT"}' : ""),
    };
    expect(collectNotices(["/r/node_modules/x/index.js"], fs).missing).toEqual(["x@1.0.0"]);
  });
});

describe("pdfjsAssetLicenseSections（埋め込んだ CMap・標準フォント）", () => {
  it("cmaps の LICENSE と standard_fonts の LICENSE_FOXIT・LICENSE_LIBERATION を読む", () => {
    const require = createRequire(import.meta.url);
    const dir = path.dirname(require.resolve("pdfjs-dist/package.json"));
    const sections = pdfjsAssetLicenseSections(dir);
    expect(sections.map((s) => s.files.map((f) => f.name))).toEqual([["LICENSE"], ["LICENSE_FOXIT", "LICENSE_LIBERATION"]]);
    expect(sections.every((s) => s.files.every((f) => f.text.length > 100))).toBe(true);
  });

  it("無ければ止める", () => {
    expect(() => pdfjsAssetLicenseSections("/nowhere", { readdir: () => [], readText: () => "" })).toThrow(/cmaps/);
  });
});
