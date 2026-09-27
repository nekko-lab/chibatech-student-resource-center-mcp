/**
 * @chibatech-src/server — 千葉工業大学「学生資料室」ポータルを操作する MCP サーバ（非公式）。
 *
 * stdout は MCP の transport 専用。ほかの出力はすべて stderr に出す。
 */
export { USER_AGENT, VERSION } from "./version.ts";
export { depsFromEnv } from "./env.ts";
export type { ServerDeps, StudentProfile } from "./types.ts";
