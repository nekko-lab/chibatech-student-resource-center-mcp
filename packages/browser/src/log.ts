/** stdout は MCP の transport（JSON-RPC）専用。このパッケージの診断はすべて stderr に出す。 */
export function stderrLog(message: string): void {
  process.stderr.write(`[csrc-browser] ${message}\n`);
}

/** エラーを 1 行（最大 3 行分・400 文字）にまとめる。log と BrowserUnavailableError の理由に使う。 */
export function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, 3)
    .join(" | ")
    .slice(0, 400);
}
