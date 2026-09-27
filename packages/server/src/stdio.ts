/**
 * stdio transport での起動。stdout は MCP の transport 専用にする。
 */
import { Writable, type Readable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeServer, createServer, stderrLog } from "./server.ts";
import type { ServerDeps } from "./types.ts";
import { SERVER_NAME, VERSION } from "./version.ts";

type WriteFn = (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;

/**
 * stdout を MCP 専用にする。playwright-core や pdfjs が console.log / stdout に書くと JSON-RPC が壊れるので、
 * `process.stdout.write` と `console.log` / `console.info` / `console.debug` は stderr に向け、
 * transport だけが本物の stdout に書く Writable を返す。restore で元に戻す。
 */
export function reserveStdout(): { out: Writable; restore: () => void } {
  const stdout = process.stdout as unknown as { write: WriteFn };
  const realWrite = stdout.write.bind(process.stdout) as WriteFn;
  const saved = { write: stdout.write, log: console.log, info: console.info, debug: console.debug };
  const out = new Writable({
    write(chunk, encoding, callback) {
      realWrite(chunk, encoding, callback);
    },
  });
  stdout.write = process.stderr.write.bind(process.stderr) as WriteFn;
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  return {
    out,
    restore: () => {
      stdout.write = saved.write;
      console.log = saved.log;
      console.info = saved.info;
      console.debug = saved.debug;
    },
  };
}

/**
 * stdio transport で起動する。stdin が閉じるか SIGINT / SIGTERM を受けたら、接続とブラウザを閉じて resolve する
 * （シグナルのときはそのあと exit code 0 でプロセスを終える）。
 */
export async function runStdio(deps: ServerDeps): Promise<void> {
  const log = deps.log ?? stderrLog;
  const { out, restore } = reserveStdout();
  const server = createServer({ ...deps, log });
  const transport = new StdioServerTransport(process.stdin as Readable, out);

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  let closing: Promise<void> | undefined;
  const shutdown = (reason: string): Promise<void> => {
    // closeServer は同期的に transport.onclose を呼び返すので、先に印を付けてから閉じる
    if (closing) return closing;
    let finish!: () => void;
    closing = new Promise<void>((r) => (finish = r));
    log(`shutting down (${reason})`);
    void closeServer(server)
      .catch((e: unknown) => log(`shutdown error: ${String(e)}`))
      .finally(() => {
        restore();
        resolveDone();
        finish();
      });
    return closing;
  };

  const onSignal = (sig: NodeJS.Signals) => {
    void shutdown(sig).then(() => process.exit(0));
  };
  process.stdin.once("end", () => void shutdown("stdin closed"));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  transport.onclose = () => void shutdown("transport closed");

  await server.connect(transport);
  const runtime = typeof (globalThis as { Bun?: { version: string } }).Bun !== "undefined"
    ? `bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version}`
    : `node ${process.version}`;
  log(`${SERVER_NAME} ${VERSION} ready (${runtime}, ${process.platform}-${process.arch})`);
  await done;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}
