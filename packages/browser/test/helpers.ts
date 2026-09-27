/// <reference path="../src/playwright-internals.d.ts" />
import { existsSync } from "node:fs";
import { yazl } from "playwright-core/lib/utilsBundle";

/** playwright-core が同梱する yazl で、テスト用の zip をメモリ上に作る（追加の依存を増やさない）。 */
export function makeZip(entries: { name: string; content: string; mode?: number }[]): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const e of entries) {
    // yazl の mode はファイル種別のビットも含む（0o100000 = 通常ファイル）
    zip.addBuffer(Buffer.from(e.content), e.name, e.mode === undefined ? {} : { mode: 0o100000 | e.mode });
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

/** Linux で Playwright が channel ごとに探す実行ファイル（registry の EXECUTABLE_PATHS と同じ）。 */
export const LINUX_CHANNEL_EXECUTABLES = {
  chrome: "/opt/google/chrome/chrome",
  msedge: "/opt/microsoft/msedge/msedge",
} as const;

export function channelInstalled(channel: keyof typeof LINUX_CHANNEL_EXECUTABLES): boolean {
  return process.platform === "linux" && existsSync(LINUX_CHANNEL_EXECUTABLES[channel]);
}
