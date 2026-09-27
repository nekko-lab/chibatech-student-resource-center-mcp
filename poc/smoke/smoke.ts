/**
 * スモーク検査: サーバのバイナリを子プロセスで起動し、MCP の
 * initialize → tools/list → portal_search → portal_list_sections → document_read_text
 * を順に呼んで、結果を JSON で標準出力に出す。
 *
 * サイトの本文は出力しない（document_read_text の先頭文字列は長さだけ記録する）。
 * サイトへのアクセスは 1 回の実行でページ遷移 2 回 + PDF 1 件（+ その JS/CSS）に抑える。
 *
 * 使い方: smoke <server-binary> [--out result.json]
 * 終了コード: 全項目成功で 0、1 つでも失敗で 1。
 */
import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const serverPath = args.find((a) => !a.startsWith('--'));
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (serverPath === undefined) {
  process.stderr.write('usage: smoke <server-binary> [--out result.json]\n');
  process.exit(2);
}

/** 期待するブラウザ起動経路（chrome / msedge / download）。指定があれば一致を検査する。 */
const EXPECT_VIA = process.env.SMOKE_EXPECT_VIA;
const CALL_TIMEOUT_MS = Number(process.env.SMOKE_CALL_TIMEOUT_MS ?? 600_000);
const EXPECTED_TOOLS = ['document_read_text', 'portal_list_sections', 'portal_search'];

interface Step {
  name: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
}

const result: {
  platform: string;
  arch: string;
  server: string;
  serverBytes: number;
  env: Record<string, string | undefined>;
  steps: Step[];
  ok: boolean;
  stderrTail: string[];
} = {
  platform: process.platform,
  arch: process.arch,
  server: serverPath,
  serverBytes: statSync(serverPath).size,
  env: {
    CSRC_DISABLE_CHANNELS: process.env.CSRC_DISABLE_CHANNELS,
    CSRC_INSTALL_MODE: process.env.CSRC_INSTALL_MODE,
    CSRC_CHANNELS: process.env.CSRC_CHANNELS,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ? '(set)' : undefined,
  },
  steps: [],
  ok: false,
  stderrTail: [],
};

const spawnedAt = Date.now();
const child = spawn(serverPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const stderrLines: string[] = [];
createInterface({ input: child.stderr! }).on('line', (line) => {
  stderrLines.push(line.slice(0, 300));
  if (stderrLines.length > 40) stderrLines.shift();
});

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
createInterface({ input: child.stdout! }).on('line', (line) => {
  if (line.trim() === '') return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    stderrLines.push(`[stdout に JSON 以外] ${line.slice(0, 120)}`);
    return;
  }
  if (typeof msg.id === 'number' && pending.has(msg.id)) {
    const p = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
});
let exited: string | undefined;
child.on('exit', (code, signal) => {
  exited = `exit code=${code} signal=${signal}`;
  for (const p of pending.values()) p.reject(new Error(`server ${exited}`));
  pending.clear();
});
child.on('error', (error) => {
  exited = `spawn error: ${error.message}`;
  for (const p of pending.values()) p.reject(error);
  pending.clear();
});

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    if (exited) return reject(new Error(`server ${exited}`));
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method: string, params: unknown = {}): void {
  child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

async function step(name: string, fn: () => Promise<unknown>, t0 = Date.now()): Promise<any> {
  try {
    const detail = await fn();
    result.steps.push({ name, ok: true, ms: Date.now() - t0, detail });
    return detail;
  } catch (error) {
    result.steps.push({ name, ok: false, ms: Date.now() - t0, error: error instanceof Error ? error.message.slice(0, 600) : String(error) });
    return undefined;
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await request('tools/call', { name, arguments: args });
  const text = res?.content?.[0]?.text ?? '';
  const parsed = text ? JSON.parse(text) : {};
  if (res?.isError) throw new Error(`tool error: ${parsed.error ?? text}`.slice(0, 600));
  return parsed;
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

async function run(): Promise<void> {
  await step(
    'initialize',
    async () => {
      const r = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'csrc-poc-smoke', version: '0.0.0' },
      });
      notify('notifications/initialized');
      return { serverInfo: r.serverInfo, protocolVersion: r.protocolVersion, startupMs: Date.now() - spawnedAt };
    },
    spawnedAt,
  );

  await step('tools/list', async () => {
    const r = await request('tools/list', {});
    const names = (r.tools as { name: string }[]).map((t) => t.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `tools=${names.join(',')}`);
    return { tools: names };
  });

  const search = await step('portal_search', async () => {
    const r = await callTool('portal_search', { kind: 'undergrad', year: 2026, dept: 'G1' });
    assert(r.deptOptionFound === true, 'G1 の選択肢が出た');
    assert(typeof r.url === 'string' && r.url.endsWith('iis/computer_2026.html'), `遷移先 URL (${r.url})`);
    assert(r.sectionCount > 0, `節が 1 つ以上 (${r.sectionCount})`);
    if (EXPECT_VIA) assert(r.browser.via === EXPECT_VIA, `起動経路が ${EXPECT_VIA} (${r.browser.via})`);
    return {
      urlPath: new URL(r.url).pathname,
      sectionCount: r.sectionCount,
      deptOptionCount: r.deptOptionCount,
      ms: r.ms,
      browser: {
        via: r.browser.via,
        browserVersion: r.browser.browserVersion,
        launchMs: r.browser.launchMs,
        attempts: r.browser.attempts,
        install: r.browser.install
          ? {
              mode: r.browser.install.mode,
              downloaded: r.browser.install.downloaded,
              ms: r.browser.install.ms,
              zipBytes: r.browser.install.zipBytes,
              installedBytes: r.browser.install.installedBytes,
              attempts: r.browser.install.attempts,
            }
          : undefined,
      },
    };
  });

  await step('portal_list_sections', async () => {
    assert(search !== undefined, 'portal_search が成功している');
    const r = await callTool('portal_list_sections', {});
    assert(r.sectionCount > 0 && r.pdfLinkCount > 0, `節と PDF リンクがある (${r.sectionCount}/${r.pdfLinkCount})`);
    return { sectionCount: r.sectionCount, pdfLinkCount: r.pdfLinkCount };
  });

  await step('document_read_text', async () => {
    assert(search !== undefined, 'portal_search が成功している');
    const r = await callTool('document_read_text', { url: 'iis/computer/computer_2026.pdf', page: 7 });
    assert(r.numPages >= 7, `ページ数 (${r.numPages})`);
    assert(r.charCount > 0, `本文が 1 文字以上 (${r.charCount})`);
    // 本文は出力しない。長さと件数だけを残す。
    const head = String(r.head ?? '');
    // 文字化けしていないこと（日本語が取れていること）だけを真偽で残す
    const headHasJapanese = /[\u3040-\u30ff\u4e00-\u9fff]/.test(head);
    assert(headHasJapanese, '先頭に日本語の文字が含まれる');
    return { numPages: r.numPages, charCount: r.charCount, headLength: head.length, headHasJapanese, bytes: r.bytes, fetchMs: r.fetchMs, extractMs: r.extractMs };
  });
}

const overall = setTimeout(() => {
  result.steps.push({ name: 'overall', ok: false, ms: Date.now() - spawnedAt, error: 'overall timeout' });
  finish();
}, CALL_TIMEOUT_MS * 2);

function finish(): void {
  clearTimeout(overall);
  result.ok = result.steps.length === 5 && result.steps.every((s) => s.ok);
  result.stderrTail = stderrLines.slice(-25);
  const json = JSON.stringify(result, null, 2);
  process.stdout.write(`${json}\n`);
  if (outPath) writeFileSync(outPath, json);
  try {
    child.stdin!.end();
    child.kill();
  } catch {
    // すでに終了している
  }
  setTimeout(() => process.exit(result.ok ? 0 : 1), 500);
}

run().then(finish, (error) => {
  result.steps.push({ name: 'run', ok: false, ms: Date.now() - spawnedAt, error: String(error) });
  finish();
});
