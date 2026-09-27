import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.ts";
import { formatSha256Sums, mcpbFileName } from "../src/report.ts";

const base = [
  "--entry",
  "packages/server/src/main.ts",
  "--out",
  "out",
  "--version",
  "1.2.3",
  "--tools",
  "tools.json",
  "--bun-license",
  "/opt/licenses/bun/LICENSE.md",
];

describe("parseCliArgs", () => {
  it("必須の 5 つと既定値", () => {
    expect(parseCliArgs(base)).toEqual({
      entry: "packages/server/src/main.ts",
      out: "out",
      version: "1.2.3",
      tools: "tools.json",
      name: "chibatech-src-mcp",
      targets: undefined,
      baseline: false,
      mcpb: true,
      bunLicense: "/opt/licenses/bun/LICENSE.md",
      license: "LICENSE",
    });
  });

  it("--targets はカンマ区切り。--baseline・--no-mcpb・--name・--license を受け付ける", () => {
    const got = parseCliArgs([...base, "--targets", "linux-x64, linux-arm64", "--baseline", "--no-mcpb", "--name", "probe", "--license", "/r/LICENSE"]);
    expect(got.targets).toEqual(["linux-x64", "linux-arm64"]);
    expect(got.baseline).toBe(true);
    expect(got.mcpb).toBe(false);
    expect(got.name).toBe("probe");
    expect(got.license).toBe("/r/LICENSE");
  });

  it("--tools は省ける（省くとサーバの toolDefinitions() から作る）。空の値は拒む", () => {
    const without = base.filter((_, i) => base[i] !== "--tools" && base[i - 1] !== "--tools");
    expect(without).not.toContain("tools.json");
    expect(parseCliArgs(without).tools).toBeUndefined();
    expect(() => parseCliArgs([...without, "--tools="])).toThrow(/--tools/);
  });

  it("--key=value の形も読む", () => {
    expect(parseCliArgs(["--entry=a.ts", "--out=o", "--version=0.0.0-dev.1", "--tools=t.json", "--bun-license=l"]).version).toBe(
      "0.0.0-dev.1",
    );
  });

  it("欠けた必須引数・値の無い引数・未知の引数・不正な値は拒む", () => {
    expect(() => parseCliArgs(base.slice(2))).toThrow(/--entry/);
    expect(() => parseCliArgs(base.slice(0, 8))).toThrow(/--bun-license/);
    expect(() => parseCliArgs(base.slice(0, 4))).toThrow(/--version/);
    expect(() => parseCliArgs([...base, "--targets"])).toThrow(/--targets/);
    expect(() => parseCliArgs([...base, "--fast"])).toThrow(/--fast/);
    expect(() => parseCliArgs([...base, "--darwin", "universal"])).toThrow(/--darwin/);
    expect(() => parseCliArgs([...base, "--darwin-sign", "adhoc"])).toThrow(/--darwin-sign/);
  });

  it("version は v を付けずに書く", () => {
    expect(() => parseCliArgs(["--entry", "a", "--out", "o", "--version", "v1.2.3", "--tools", "t", "--bun-license", "l"])).toThrow(
      /version/,
    );
  });
});

describe("formatSha256Sums", () => {
  it("sha256sum -c で検査できる形（ハッシュ・空白 2 つ・パス）でパス順に並べる", () => {
    expect(
      formatSha256Sums([
        { path: "mcpb/x-1.2.3.mcpb", sha256: "b".repeat(64) },
        { path: "bin/x-linux-x64", sha256: "a".repeat(64) },
        { path: "THIRD_PARTY_NOTICES.txt", sha256: "c".repeat(64) },
      ]),
    ).toBe(`${"c".repeat(64)}  THIRD_PARTY_NOTICES.txt\n${"a".repeat(64)}  bin/x-linux-x64\n${"b".repeat(64)}  mcpb/x-1.2.3.mcpb\n`);
  });

  it("Windows の区切りは / にそろえる", () => {
    expect(formatSha256Sums([{ path: "bin\\x.exe", sha256: "c".repeat(64) }])).toBe(`${"c".repeat(64)}  bin/x.exe\n`);
  });
});

describe("mcpbFileName", () => {
  it("<名前>-<version>.mcpb（全 OS 共通の 1 つ）", () => {
    expect(mcpbFileName("chibatech-src-mcp", "1.2.3")).toBe("chibatech-src-mcp-1.2.3.mcpb");
  });
});
