// acquire.test.ts（NET=1）が子プロセスとして起動する入口。環境変数から設定を読んで 1 回だけ起動する。
// registry の置き場所は playwright-core の読み込み時に PLAYWRIGHT_BROWSERS_PATH から決まるため、子プロセスで切り替える。
import { acquireBrowser, optionsFromEnv } from "../../src/index.ts";

const r = await acquireBrowser(optionsFromEnv(process.env));
process.stderr.write(`ACQUIRED via=${r.via} version=${r.browser.version()}\n`);
await r.browser.close();
