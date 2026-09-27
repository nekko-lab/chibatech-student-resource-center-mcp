/**
 * mcpb の `tools` に載せる JSON（tools.json）を、サーバの `toolDefinitions()` から作る。
 * サーバもブラウザも起動しない（ツールの一覧を読むだけ）。Bun で実行する。
 *
 *   bun run tools/build/src/tools-json.ts [--out <file>]   （--out を省くと stdout に出す）
 *
 * cli.ts は `--tools` を省くとこれで作るので、サーバにツールが増えても何も変えずに mcpb に載る。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseToolsJson, type ToolEntry } from "./manifest.ts";

/** `toolDefinitions()` の出力を検査して tools.json の本文にする（純関数）。空・重複・形の誤りは例外。 */
export function renderToolsJson(defs: readonly { name: string; description: string }[]): string {
  const tools = parseToolsJson(JSON.stringify(defs));
  if (tools.length === 0) throw new Error("toolDefinitions() が空です");
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`ツール名が重複しています: ${t.name}`);
    seen.add(t.name);
  }
  return `${JSON.stringify(tools, null, 2)}\n`;
}

/** `@chibatech-src/server` の `toolDefinitions()` を呼ぶ。 */
export async function serverToolDefinitions(): Promise<ToolEntry[]> {
  const { toolDefinitions } = await import("@chibatech-src/server");
  return toolDefinitions();
}

/** サーバのツール一覧を tools.json として書き出し、書いた一覧を返す。 */
export async function writeServerToolsJson(file: string): Promise<ToolEntry[]> {
  const text = renderToolsJson(await serverToolDefinitions());
  writeFileSync(file, text);
  return parseToolsJson(text);
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    let out: string | undefined;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (arg === "--out" && argv[i + 1] !== undefined) out = argv[++i];
      else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
      else throw new Error(`未知の引数です: ${arg}\nbun run tools/build/src/tools-json.ts [--out <file>]`);
    }
    if (out === undefined) {
      process.stdout.write(renderToolsJson(await serverToolDefinitions()));
    } else {
      const tools = await writeServerToolsJson(path.resolve(out));
      console.error(`tools.json: ${tools.length} tools -> ${out}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
