import { describe, expect, it } from "vitest";

describe("@chibatech-src/browser", () => {
  it("エントリを読み込める", async () => {
    const mod = await import("../src/index.ts");
    expect(mod).toBeTypeOf("object");
  });

  it("playwright-core を解決できる", async () => {
    const pw = await import("playwright-core");
    expect(pw.chromium).toBeDefined();
  });
});
