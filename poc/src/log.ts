/** stdout は MCP の JSON-RPC 専用なので、診断はすべて stderr に出す。 */
export function log(message: string): void {
  process.stderr.write(`[csrc-poc] ${message}\n`);
}
