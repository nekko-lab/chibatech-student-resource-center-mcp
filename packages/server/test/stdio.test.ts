import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reserveStdout } from "../src/stdio.ts";

const HOOKS = new URL("./helpers/ts-resolve-hooks.mjs", import.meta.url).href;
const CHILD = fileURLToPath(new URL("./helpers/stdio-child.ts", import.meta.url));

describe("reserveStdout", () => {
  it("process.stdout.write と console.log を stderr に向け、戻せる", () => {
    const origOut = process.stdout.write;
    const origLog = console.log;
    const { out, restore } = reserveStdout();
    try {
      expect(process.stdout.write).not.toBe(origOut);
      expect(console.log).toBe(console.error);
      expect(out.writable).toBe(true);
    } finally {
      restore();
    }
    expect(process.stdout.write).toBe(origOut);
    expect(console.log).toBe(origLog);
  });
});

describe("runStdio（子プロセス）", () => {
  it("stdout には JSON-RPC だけが出て、stdin が閉じたらブラウザを閉じて終わる", async () => {
    const child = spawn(process.execPath, ["--import", HOOKS, CHILD], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (s: string) => (stdout += s));
    child.stderr.setEncoding("utf8").on("data", (s: string) => (stderr += s));
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));

    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    const waitFor = async (id: number) => {
      for (let i = 0; i < 600; i++) {
        if (stdout.split("\n").some((l) => l.includes(`"id":${id}`))) return;
        if (child.exitCode !== null) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`応答 ${id} が来ない\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "srv-test", version: "0" } },
    });
    await waitFor(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "portal_open_home", arguments: {} } });
    // pdfjs は警告を console.log に出すので、PDF の本文抽出も通しておく
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "document_read_text", arguments: { url: "whole/gakubu/calendar.pdf" } } });
    await waitFor(4);
    child.stdin.end();
    const code = await exited;

    const lines = stdout.split("\n").filter((l) => l.trim() !== "");
    for (const l of lines) {
      const m = JSON.parse(l) as { jsonrpc?: string };
      expect(m.jsonrpc).toBe("2.0");
    }
    const byId = new Map(lines.map((l) => JSON.parse(l) as { id?: number; result?: { tools?: unknown[]; isError?: boolean } }).map((m) => [m.id, m]));
    expect(byId.get(2)?.result?.tools?.length).toBe(24);
    expect(byId.get(3)?.result?.isError).toBeUndefined();
    expect(byId.get(4)?.result?.isError).toBeUndefined();
    expect(stderr).toContain("srv-noise console.log");
    expect(stderr).toContain("srv-noise stdout.write");
    expect(stderr).toContain("srv-child done browserConnected=false");
    expect(code).toBe(0);
  }, 60_000);
});
