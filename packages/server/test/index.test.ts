import { describe, expect, it } from "vitest";

// 枠の段階で、登録した依存がワークスペース経由で解決でき、
// server の tsconfig で各パッケージのソースを型検査できることを確かめる。
describe("@chibatech-src/server", () => {
  it("エントリを読み込める", async () => {
    const mod = await import("../src/index.ts");
    expect(mod).toBeTypeOf("object");
  });

  it("ワークスペースのパッケージを解決できる", async () => {
    const [browser, match, parsers, pdf, portal, portalTesting] = await Promise.all([
      import("@chibatech-src/browser"),
      import("@chibatech-src/match"),
      import("@chibatech-src/parsers"),
      import("@chibatech-src/pdf"),
      import("@chibatech-src/portal"),
      import("@chibatech-src/portal/testing"),
    ]);
    expect(browser).toBeTypeOf("object");
    expect(match.normalizeJa).toBeTypeOf("function");
    expect(parsers.parseBusSchedule).toBeTypeOf("function");
    expect(pdf.parsePdfLink).toBeTypeOf("function");
    expect(portal.DEFAULT_BASE_URL).toBeTypeOf("string");
    expect(portalTesting).toBeTypeOf("object");
  });

  it("MCP SDK と zod を解決できる", async () => {
    const [{ McpServer }, { z }] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("zod"),
    ]);
    expect(McpServer).toBeTypeOf("function");
    expect(z.string().parse("ok")).toBe("ok");
  });
});
