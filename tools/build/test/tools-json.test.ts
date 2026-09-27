import { toolDefinitions } from "@chibatech-src/server";
import { describe, expect, it } from "vitest";
import { buildManifest, parseToolsJson } from "../src/manifest.ts";
import { renderToolsJson, serverToolDefinitions } from "../src/tools-json.ts";

describe("renderToolsJson", () => {
  it("{ name, description } だけの配列にし、末尾に改行を付ける", () => {
    const text = renderToolsJson([{ name: "a_b", description: "x", inputSchema: {} } as { name: string; description: string }]);
    expect(text).toBe('[\n  {\n    "name": "a_b",\n    "description": "x"\n  }\n]\n');
  });

  it("空・重複・description の欠けは拒む", () => {
    expect(() => renderToolsJson([])).toThrow(/空/);
    expect(() =>
      renderToolsJson([
        { name: "a", description: "x" },
        { name: "a", description: "y" },
      ]),
    ).toThrow(/重複/);
    expect(() => renderToolsJson([{ name: "a", description: "" }])).toThrow(/description/);
  });
});

describe("サーバの toolDefinitions() から作る tools.json", () => {
  it("サーバのツールがすべて、同じ順で載る（本数は固定しない。ツールが増えても変えずに通る）", async () => {
    const defs = toolDefinitions();
    const tools = parseToolsJson(renderToolsJson(await serverToolDefinitions()));
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toEqual(defs.map((d) => ({ name: d.name, description: d.description })));
  });

  it("そのまま mcpb の manifest に載せられる（ツール名の形・重複・description の検査を通る）", async () => {
    const tools = parseToolsJson(renderToolsJson(await serverToolDefinitions()));
    const manifest = buildManifest({ name: "chibatech-src-mcp", version: "0.1.0-rc.1", tools });
    expect(manifest.tools.map((t) => t.name)).toEqual(tools.map((t) => t.name));
  });
});
