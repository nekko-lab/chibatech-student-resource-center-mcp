/**
 * stdio の検査用に子プロセスで動かすサーバ（test/stdio.test.ts から起動する）。
 * 合成サイトと合成 PDF を使い、ネットワークには出ない。
 * 起動直後に console.log と process.stdout.write でわざと出力し、stdout に混ざらないことを親で確かめる。
 */
import type { Browser } from "playwright-core";
import { USER_AGENT, runStdio } from "../../src/index.ts";
import { launchTestBrowser } from "./browser.ts";
import { fakeFetcher, makePdf } from "./pdf.ts";

let browser: Browser | undefined;
const fetch = fakeFetcher({}, (url) => (/\.pdf$/.test(url) ? { body: makePdf(["Fictional calendar page"]) } : undefined));

const done = runStdio({
  getBrowser: async () => {
    const tb = await launchTestBrowser();
    browser = tb.browser;
    return tb.getBrowser();
  },
  userAgent: USER_AGENT,
  fetcher: fetch.fetcher,
});
console.log("srv-noise console.log");
process.stdout.write("srv-noise stdout.write\n");
await done;
console.error(`srv-child done browserConnected=${String(browser?.isConnected() ?? false)}`);
