/**
 * MCP サーバの組み立て。
 */
import { FsPdfCache, MemoryPdfCache } from "@chibatech-src/pdf";
import { DEFAULT_BASE_URL } from "@chibatech-src/portal";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DocumentService } from "./docs.ts";
import type { MacroEnv } from "./macros/ports.ts";
import { PortalService } from "./portal-port.ts";
import { Responder, describeError } from "./respond.ts";
import { Session } from "./session.ts";
import { TOOLS, type ToolContext } from "./tools.ts";
import type { ServerDeps } from "./types.ts";
import { SERVER_NAME, VERSION } from "./version.ts";

const INSTRUCTIONS =
  "千葉工業大学「学生資料室」ポータル（ログイン不要の公開ページ）を操作する非公式のツールです。大学の公式情報ではありません。" +
  "学生の質問には、まずマクロ（find_department_page / lookup_requirements / lookup_handbook_topic / get_academic_calendar / " +
  "get_bus_schedule / find_class_teacher / find_manual / get_absence_form / find_contact）を使ってください。" +
  "status が needs_clarification のときは candidates を学生に示して聞き返してください。" +
  "回答には sources（資料名・URL・ページ・Last-Modified）を添え、正式な手続きは原本で確認するよう伝えてください。" +
  "error.code が LAYOUT_CHANGED のときは推測で補わず、サイトの構造が変わった可能性がある旨を伝えてください。";

export function stderrLog(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

/** ベース URL を末尾 `/` に揃える */
function normalizeBase(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.href;
}

const sessions = new WeakMap<McpServer, Session>();

/** サーバの接続を閉じ、ブラウザも閉じる（終わるまで待つ） */
export async function closeServer(server: McpServer): Promise<void> {
  await server.close().catch(() => undefined);
  await sessions.get(server)?.close();
}

export function createServer(deps: ServerDeps): McpServer {
  const log = deps.log ?? stderrLog;
  const baseUrl = normalizeBase(deps.baseUrl ?? DEFAULT_BASE_URL);
  const session = new Session({ getBrowser: deps.getBrowser, userAgent: deps.userAgent, log });
  const fetcher = deps.fetcher;
  const docs = new DocumentService({
    getFetcher: fetcher ? async () => fetcher : () => session.fetcher(),
    cache: deps.cacheDir ? new FsPdfCache(deps.cacheDir) : new MemoryPdfCache(),
    userAgent: deps.userAgent,
    baseUrl,
    ...(deps.downloadDir ? { downloadDir: deps.downloadDir } : {}),
  });
  const env: MacroEnv = {
    portal: new PortalService(session, baseUrl),
    docs,
    now: deps.now ?? (() => new Date()),
    profile: deps.profile ?? {},
  };
  const ctx: ToolContext = { session, docs, env, baseUrl };
  const responder = new Responder();

  const server = new McpServer({ name: SERVER_NAME, version: VERSION }, { instructions: INSTRUCTIONS });
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, async (args: unknown) => {
      const t0 = Date.now();
      try {
        const outcome = await session.run(() => t.run(ctx, (args ?? {}) as Record<string, unknown>));
        log(`${t.name} ${outcome.status} ${Date.now() - t0}ms`);
        return responder.success(outcome);
      } catch (e) {
        const err = describeError(e);
        log(`${t.name} error ${err.code}: ${err.message}`);
        return responder.failure(e);
      }
    });
  }
  sessions.set(server, session);
  const prev = server.server.onclose;
  server.server.onclose = () => {
    prev?.();
    void session.close();
  };
  return server;
}

/** mcpb manifest の tools 生成用。サーバもブラウザも起動しない */
export function toolDefinitions(): { name: string; description: string }[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description }));
}
