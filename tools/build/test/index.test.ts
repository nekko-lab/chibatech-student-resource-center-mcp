import { describe, expect, it } from "vitest";

describe("@chibatech-src/build", () => {
  it("エントリを読み込める", async () => {
    const mod = await import("../src/index.ts");
    expect(mod).toBeTypeOf("object");
  });
});
