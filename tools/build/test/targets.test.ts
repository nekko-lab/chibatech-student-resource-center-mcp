import { describe, expect, it } from "vitest";
import { DEFAULT_TARGET_KEYS, TARGETS, binaryFileName, resolveTargets } from "../src/targets.ts";

const byKey = Object.fromEntries(TARGETS.map((t) => [t.key, t]));

describe("TARGETS", () => {
  it("既定は darwin-arm64・windows-x64・linux-x64・linux-arm64（Intel Mac は対象外）", () => {
    expect(DEFAULT_TARGET_KEYS).toEqual(["darwin-arm64", "windows-x64", "linux-x64", "linux-arm64"]);
    expect(TARGETS.some((t) => t.key.startsWith("darwin-x64"))).toBe(false);
  });

  it("Bun の target 名・.exe の有無・macOS かどうかを持つ", () => {
    expect(byKey["darwin-arm64"]).toMatchObject({ bunTarget: "bun-darwin-arm64", exe: "", darwin: true, baseline: false });
    expect(byKey["windows-x64"]).toMatchObject({ bunTarget: "bun-windows-x64", exe: ".exe", darwin: false });
    expect(byKey["linux-x64"]).toMatchObject({ bunTarget: "bun-linux-x64", exe: "" });
    expect(byKey["linux-arm64"]).toMatchObject({ bunTarget: "bun-linux-arm64", exe: "" });
  });

  it("-baseline 版は Windows と Linux の x64 だけ", () => {
    expect(TARGETS.filter((t) => t.baseline).map((t) => [t.key, t.bunTarget])).toEqual([
      ["windows-x64-baseline", "bun-windows-x64-baseline"],
      ["linux-x64-baseline", "bun-linux-x64-baseline"],
    ]);
  });
});

describe("resolveTargets", () => {
  const keys = (ts: { key: string }[]) => ts.map((t) => t.key);

  it("指定が無ければ既定の 4 つ（baseline は出さない）", () => {
    expect(keys(resolveTargets(undefined, false))).toEqual([...DEFAULT_TARGET_KEYS]);
  });

  it("--baseline で、選んだ Windows / Linux の x64 に baseline 版を足す", () => {
    expect(keys(resolveTargets(["darwin-arm64", "windows-x64"], true))).toEqual(["darwin-arm64", "windows-x64", "windows-x64-baseline"]);
    expect(keys(resolveTargets(undefined, true))).toHaveLength(6);
  });

  it("baseline 版を直接指定できる。重複はまとめる", () => {
    expect(keys(resolveTargets(["linux-x64-baseline", "linux-x64", "linux-x64"], false))).toEqual(["linux-x64-baseline", "linux-x64"]);
  });

  it("未知のターゲット（darwin-x64 を含む）と空の指定は拒否する", () => {
    expect(() => resolveTargets(["darwin-x64"], false)).toThrow(/darwin-x64/);
    expect(() => resolveTargets(["darwin-universal"], false)).toThrow(/darwin-universal/);
    expect(() => resolveTargets([], false)).toThrow();
  });
});

describe("binaryFileName", () => {
  it("<名前>-<target>[.exe]", () => {
    expect(binaryFileName("chibatech-src-mcp", byKey["windows-x64"]!)).toBe("chibatech-src-mcp-windows-x64.exe");
    expect(binaryFileName("chibatech-src-mcp", byKey["darwin-arm64"]!)).toBe("chibatech-src-mcp-darwin-arm64");
  });
});
