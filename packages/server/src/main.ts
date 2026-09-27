/**
 * 単一バイナリ（bun build --compile）の起動エントリ。非公式ツールであり、千葉工業大学とは関係ありません。
 *
 * - stdout は MCP の transport 専用。runStdio が stdout を確保するまで、ここでは stdout に何も書かない
 *   （警告・ログはすべて stderr）。
 * - 振り分け（Playwright のダウンロード用の子として起動された場合など）は runLauncher に任せ、
 *   main はそこから 1 回だけ呼ぶ。
 * - import.meta.main で起動を条件付けない。単一バイナリでは tools/build が生成した入口から読み込まれるので、
 *   偽になる（読み込まれたら起動する）。
 * - 日本語 PDF の本文が欠けないよう、CMap・標準フォントは tools/build が単一バイナリに埋め込み、
 *   このモジュールより先に評価される起動前処理で pdfjs に渡す（ここでは何もしない）。
 */
import { acquireBrowser, optionsFromEnv, runLauncher } from "@chibatech-src/browser";
import { depsFromEnv, runStdio, USER_AGENT } from "./index.ts";

function warn(message: string): void {
  process.stderr.write(`[csrc-server] ${message}\n`);
}

await runLauncher(async () => {
  await runStdio({
    ...depsFromEnv(process.env, warn),
    userAgent: USER_AGENT,
    getBrowser: () => acquireBrowser(optionsFromEnv(process.env)),
  });
});
