import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.ts";
import { formatSha256Sums, mcpbFileName, parseLipoArchs } from "../src/report.ts";

const base = ["--entry", "poc/src/launcher.ts", "--out", "out", "--version", "1.2.3", "--tools", "tools.json"];

describe("parseCliArgs", () => {
  it("必須の 4 つと既定値", () => {
    expect(parseCliArgs(base)).toEqual({
      entry: "poc/src/launcher.ts",
      out: "out",
      version: "1.2.3",
      tools: "tools.json",
      name: "chibatech-src-mcp",
      targets: undefined,
      baseline: false,
      mcpb: true,
      darwin: "universal",
      keepSlices: false,
    });
  });

  it("--targets はカンマ区切り。--baseline・--no-mcpb・--name・--darwin・--keep-slices を受け付ける", () => {
    const got = parseCliArgs([
      ...base,
      "--targets",
      "linux-x64, linux-arm64",
      "--baseline",
      "--no-mcpb",
      "--name",
      "probe",
      "--darwin",
      "launcher",
      "--keep-slices",
    ]);
    expect(got.targets).toEqual(["linux-x64", "linux-arm64"]);
    expect(got.baseline).toBe(true);
    expect(got.mcpb).toBe(false);
    expect(got.name).toBe("probe");
    expect(got.darwin).toBe("launcher");
    expect(got.keepSlices).toBe(true);
  });

  it("--key=value の形も読む", () => {
    expect(parseCliArgs(["--entry=a.ts", "--out=o", "--version=0.0.0-dev.1", "--tools=t.json"]).version).toBe("0.0.0-dev.1");
  });

  it("欠けた必須引数・値の無い引数・未知の引数・不正な値は拒む", () => {
    expect(() => parseCliArgs(base.slice(2))).toThrow(/--entry/);
    expect(() => parseCliArgs([...base, "--targets"])).toThrow(/--targets/);
    expect(() => parseCliArgs([...base, "--fast"])).toThrow(/--fast/);
    expect(() => parseCliArgs([...base, "--darwin", "fat"])).toThrow(/--darwin/);
  });

  it("version は v を付けずに書く", () => {
    expect(() => parseCliArgs(["--entry", "a", "--out", "o", "--version", "v1.2.3", "--tools", "t"])).toThrow(/version/);
  });
});

describe("formatSha256Sums", () => {
  it("sha256sum -c で検査できる形（ハッシュ・空白 2 つ・パス）でパス順に並べる", () => {
    expect(
      formatSha256Sums([
        { path: "mcpb/x-1.2.3.mcpb", sha256: "b".repeat(64) },
        { path: "bin/x-linux-x64", sha256: "a".repeat(64) },
      ]),
    ).toBe(`${"a".repeat(64)}  bin/x-linux-x64\n${"b".repeat(64)}  mcpb/x-1.2.3.mcpb\n`);
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

describe("parseLipoArchs", () => {
  it("llvm-lipo -archs の出力を配列にする", () => {
    expect(parseLipoArchs("x86_64 arm64\n")).toEqual(["x86_64", "arm64"]);
    expect(parseLipoArchs("")).toEqual([]);
  });
});
