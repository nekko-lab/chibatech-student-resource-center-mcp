import { describe, expect, it } from "vitest";
import {
  COMPILE_TARGETS,
  DEFAULT_OUTPUT_KEYS,
  OUTPUTS,
  binaryFileName,
  compileTargetsOf,
  resolveOutputs,
} from "../src/targets.ts";

const byKey = <T extends { key: string }>(list: readonly T[]) => Object.fromEntries(list.map((t) => [t.key, t]));

describe("COMPILE_TARGETS", () => {
  it("Bun の target 名と .exe の有無を持つ", () => {
    const t = byKey(COMPILE_TARGETS);
    expect(t["darwin-arm64"]).toMatchObject({ bunTarget: "bun-darwin-arm64", exe: "", baseline: false });
    expect(t["darwin-x64"]).toMatchObject({ bunTarget: "bun-darwin-x64", exe: "" });
    expect(t["windows-x64"]).toMatchObject({ bunTarget: "bun-windows-x64", exe: ".exe" });
    expect(t["linux-x64"]).toMatchObject({ bunTarget: "bun-linux-x64", exe: "" });
    expect(t["linux-arm64"]).toMatchObject({ bunTarget: "bun-linux-arm64", exe: "" });
  });

  it("-baseline 版は Windows と Linux の x64 だけ", () => {
    expect(COMPILE_TARGETS.filter((t) => t.baseline).map((t) => [t.key, t.bunTarget])).toEqual([
      ["windows-x64-baseline", "bun-windows-x64-baseline"],
      ["linux-x64-baseline", "bun-linux-x64-baseline"],
    ]);
  });
});

describe("OUTPUTS", () => {
  it("既定は macOS ユニバーサル・Windows x64・Linux x64・Linux arm64 の 4 つ", () => {
    expect(DEFAULT_OUTPUT_KEYS).toEqual(["darwin-universal", "windows-x64", "linux-x64", "linux-arm64"]);
  });

  it("darwin-universal は arm64 と x64 の 2 つを lipo でまとめる", () => {
    const u = byKey(OUTPUTS)["darwin-universal"]!;
    expect(u.parts.map((p) => p.key)).toEqual(["darwin-arm64", "darwin-x64"]);
    expect(u.exe).toBe("");
  });

  it("そのほかの出力は 1 つのターゲットをそのまま使う", () => {
    for (const o of OUTPUTS.filter((x) => x.key !== "darwin-universal")) {
      expect(o.parts.map((p) => p.key)).toEqual([o.key]);
    }
  });
});

describe("resolveOutputs", () => {
  const keys = (ts: { key: string }[]) => ts.map((t) => t.key);

  it("指定が無ければ既定の 4 つ（baseline は出さない）", () => {
    expect(keys(resolveOutputs(undefined, false))).toEqual([...DEFAULT_OUTPUT_KEYS]);
  });

  it("--baseline で、選んだ Windows / Linux の x64 に baseline 版を足す", () => {
    expect(keys(resolveOutputs(["darwin-universal", "windows-x64"], true))).toEqual([
      "darwin-universal",
      "windows-x64",
      "windows-x64-baseline",
    ]);
    expect(keys(resolveOutputs(undefined, true))).toHaveLength(6);
  });

  it("個別の darwin-arm64 / darwin-x64 と baseline 版を直接指定できる。重複はまとめる", () => {
    expect(keys(resolveOutputs(["darwin-arm64", "linux-x64-baseline", "darwin-arm64"], false))).toEqual([
      "darwin-arm64",
      "linux-x64-baseline",
    ]);
  });

  it("未知の出力と空の指定は拒否する", () => {
    expect(() => resolveOutputs(["linux-riscv64"], false)).toThrow(/linux-riscv64/);
    expect(() => resolveOutputs([], false)).toThrow();
  });
});

describe("compileTargetsOf", () => {
  it("出力に要るターゲットを重複なく並べる", () => {
    const outs = resolveOutputs(["darwin-universal", "darwin-arm64", "windows-x64"], false);
    expect(compileTargetsOf(outs).map((t) => t.key)).toEqual(["darwin-arm64", "darwin-x64", "windows-x64"]);
  });
});

describe("binaryFileName", () => {
  it("<名前>-<出力>[.exe]", () => {
    const o = byKey(OUTPUTS);
    expect(binaryFileName("chibatech-src-mcp", o["windows-x64"]!)).toBe("chibatech-src-mcp-windows-x64.exe");
    expect(binaryFileName("chibatech-src-mcp", o["darwin-universal"]!)).toBe("chibatech-src-mcp-darwin-universal");
  });
});
