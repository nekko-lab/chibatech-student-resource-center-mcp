/**
 * 非公式 PoC: 千葉工業大学 学生資料室を操作する MCP サーバ（stdio）。
 *
 * ツールは成立性検証に必要な 3 つだけ。結果は「事実の確認」に必要な値（URL・件数・文字数）に
 * とどめ、サイトの本文はほとんど返さない（document_read_text の先頭 40 文字のみ）。
 */
import { Writable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { closeSession, getSession } from './browser.ts';
import { PORTAL_BASE_URL, TOOL_NAME, TOOL_VERSION } from './config.ts';
import { shortError } from './install.ts';
import { log } from './log.ts';

const PORTAL_HOST = new URL(PORTAL_BASE_URL).hostname;

function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function fail(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: shortError(error) }) }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: TOOL_NAME, version: TOOL_VERSION });

  server.registerTool(
    'portal_search',
    {
      description: '（非公式）学生資料室のホームで区分・入学年度・学科を選んで検索し、遷移先 URL と節の数を返す',
      inputSchema: {
        kind: z.enum(['undergrad', 'graduate']).describe('undergrad=学部生, graduate=大学院生'),
        year: z.number().int().describe('入学年度（例: 2026）'),
        dept: z.string().describe('学科コード（例: G1）'),
      },
    },
    async ({ kind, year, dept }) => {
      try {
        const s = await getSession();
        const { page } = s;
        const dialogs: string[] = [];
        const onDialog = (d: import('playwright-core').Dialog) => {
          dialogs.push(d.message().slice(0, 40));
          void d.dismiss().catch(() => undefined);
        };
        page.on('dialog', onDialog);
        const t0 = Date.now();
        try {
          await page.goto(PORTAL_BASE_URL, { waitUntil: 'domcontentloaded' });
          await page.check(kind === 'graduate' ? '#rdo_graduate' : '#rdo_gakubu');
          await page.selectOption('#slt_year', String(year));
          // 学科の選択肢はサイト自身の JS が年度の change で生成する
          const option = page.locator(`#slt_dept option[value="${dept.replace(/"/g, '')}"]`);
          await option.waitFor({ state: 'attached', timeout: 10_000 });
          const deptOptionCount = await page.locator('#slt_dept option').count();
          await page.selectOption('#slt_dept', dept);
          const before = page.url();
          await Promise.all([page.waitForURL((u) => u.href !== before, { timeout: 30_000 }), page.click('#btn_submit')]);
          await page.waitForLoadState('domcontentloaded');
          const sectionCount = await page.locator('.collapse').count();
          return ok({
            url: page.url(),
            sectionCount,
            deptOptionFound: true,
            deptOptionCount,
            dialogs,
            ms: Date.now() - t0,
            browser: s.info,
          });
        } finally {
          page.off('dialog', onDialog);
        }
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'portal_list_sections',
    {
      description: '（非公式）現在開いている学科ページの節の数と、各節の PDF リンク（URL）を返す',
      inputSchema: {},
    },
    async () => {
      try {
        const { page } = await getSession();
        const sections = await page.$$eval('.collapse', (nodes) =>
          nodes.map((node, index) => {
            const links = Array.from(node.querySelectorAll('.collapse__detail a[href]')) as HTMLAnchorElement[];
            const pdfs = links.map((a) => a.href).filter((href) => /\.pdf(#|$)/i.test(href));
            return { index, pdfLinkCount: pdfs.length, pdfUrls: pdfs };
          }),
        );
        return ok({
          url: page.url(),
          sectionCount: sections.length,
          pdfLinkCount: sections.reduce((n, s) => n + s.pdfLinkCount, 0),
          sections,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'document_read_text',
    {
      description: '（非公式）学生資料室の PDF を取得し、指定ページの本文の文字数と先頭 40 文字を返す',
      inputSchema: {
        url: z.string().describe('PDF の URL（ポータルからの相対パスも可）'),
        page: z.number().int().min(1).describe('ページ番号（1 始まり）'),
      },
    },
    async ({ url, page: pageNumber }) => {
      try {
        const target = new URL(url, PORTAL_BASE_URL);
        target.hash = '';
        if (target.hostname !== PORTAL_HOST) throw new Error(`対象外のホストです: ${target.hostname}`);
        const { page } = await getSession();
        const t0 = Date.now();
        const response = await page.request.get(target.href);
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const body = await response.body();
        const fetchMs = Date.now() - t0;
        // pdfjs は読み込みが重く警告も出すので、必要になった時点で読む
        const { extractPageText } = await import('./pdf.ts');
        const { numPages, text } = await extractPageText(new Uint8Array(body), pageNumber);
        const compact = text.replace(/\s+/g, ' ').trim();
        return ok({
          url: target.href,
          bytes: body.length,
          numPages,
          page: pageNumber,
          charCount: compact.length,
          head: compact.slice(0, 40),
          fetchMs,
          extractMs: Date.now() - t0 - fetchMs,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

/**
 * stdout を MCP 専用にする。playwright-core の registry などが console.log / stdout に進捗を書くと
 * JSON-RPC が壊れるので、process.stdout.write は stderr に向け、transport だけ本物の stdout に書かせる。
 */
function reserveStdoutForMcp(): Writable {
  const realWrite = process.stdout.write.bind(process.stdout) as (chunk: any, encoding?: any, cb?: any) => boolean;
  const mcpOut = new Writable({
    write(chunk, encoding, callback) {
      realWrite(chunk, encoding, callback);
    },
  });
  (process.stdout as any).write = process.stderr.write.bind(process.stderr);
  console.log = console.error;
  console.info = console.error;
  return mcpOut;
}

export async function main(): Promise<void> {
  const mcpOut = reserveStdoutForMcp();
  const server = createServer();
  const transport = new StdioServerTransport(process.stdin, mcpOut);
  const shutdown = async () => {
    await closeSession();
    process.exit(0);
  };
  process.stdin.on('end', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await server.connect(transport);
  log(`${TOOL_NAME} ${TOOL_VERSION} ready (runtime=${typeof (globalThis as any).Bun !== 'undefined' ? `bun ${(globalThis as any).Bun.version}` : `node ${process.version}`}, ${process.platform}-${process.arch})`);
}
