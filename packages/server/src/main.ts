/**
 * 単一バイナリ（bun build --compile）の起動エントリ。非公式ツールであり、千葉工業大学とは関係ありません。
 *
 * - stdout は MCP の transport 専用。runStdio が stdout を確保するまで、ここでは stdout に何も書かない
 *   （警告・ログはすべて stderr）。
 * - 振り分け（Playwright のダウンロード用の子として起動された場合など）は runLauncher に任せ、
 *   main はそこから 1 回だけ呼ぶ。
 * - 日本語 PDF の本文が欠けないよう、ビルド時に埋め込んだ CMap・標準フォントを pdfjs に渡す。
 */
import { acquireBrowser, optionsFromEnv, runLauncher } from "@chibatech-src/browser";
import { mapPdfAssets, setPdfAssets } from "@chibatech-src/pdf";
import { embeddedPdfAssets } from "./embedded-pdf-assets.ts";
import { depsFromEnv, runStdio, USER_AGENT } from "./index.ts";

function warn(message: string): void {
  process.stderr.write(`[csrc-server] ${message}\n`);
}

await runLauncher(async () => {
  const assets = embeddedPdfAssets();
  if (assets !== undefined) setPdfAssets(mapPdfAssets(assets));

  await runStdio({
    ...depsFromEnv(process.env, warn),
    userAgent: USER_AGENT,
    getBrowser: () => acquireBrowser(optionsFromEnv(process.env)),
  });
});
