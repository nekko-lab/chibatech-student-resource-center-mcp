/**
 * ブラウザの起動（フォールバック付き）とページの保持。
 *
 * 順序: channel "chrome" → channel "msedge" → ダウンロード済み（または初回ダウンロードした）
 * Chromium headless shell。CSRC_DISABLE_CHANNELS=1 で channel を飛ばしてダウンロード経路を強制する。
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { BLOCKED_HOST_PATTERNS, ENV_CHANNELS, ENV_DISABLE_CHANNELS, USER_AGENT, VIEWPORT } from './config.ts';
import { ensureChromium, shortError, type InstallResult } from './install.ts';
import { log } from './log.ts';

export type LaunchVia = 'chrome' | 'msedge' | 'download';

export interface LaunchInfo {
  via: LaunchVia;
  browserVersion: string;
  launchMs: number;
  attempts: { via: string; ok: boolean; error?: string; ms: number }[];
  install?: InstallResult;
}

interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  info: LaunchInfo;
}

let session: Promise<Session> | undefined;

export function getSession(): Promise<Session> {
  session ??= startSession().catch((error) => {
    session = undefined;
    throw error;
  });
  return session;
}

export async function closeSession(): Promise<void> {
  if (session === undefined) return;
  const s = await session.catch(() => undefined);
  session = undefined;
  await s?.browser.close().catch(() => undefined);
}

/** 既定は chrome → msedge。CSRC_CHANNELS=msedge のように並びを差し替えられる（CI で msedge 経路を確かめる用）。 */
function channelOrder(): ('chrome' | 'msedge')[] {
  const raw = process.env[ENV_CHANNELS];
  if (raw === undefined || raw.trim() === '') return ['chrome', 'msedge'];
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is 'chrome' | 'msedge' => c === 'chrome' || c === 'msedge');
}

async function startSession(): Promise<Session> {
  const started = Date.now();
  const attempts: LaunchInfo['attempts'] = [];
  let browser: Browser | undefined;
  let via: LaunchVia | undefined;
  let install: InstallResult | undefined;

  if (process.env[ENV_DISABLE_CHANNELS] !== '1') {
    for (const channel of channelOrder()) {
      const t0 = Date.now();
      try {
        browser = await chromium.launch({ channel, headless: true, timeout: 60_000 });
        attempts.push({ via: channel, ok: true, ms: Date.now() - t0 });
        via = channel;
        break;
      } catch (error) {
        attempts.push({ via: channel, ok: false, error: shortError(error), ms: Date.now() - t0 });
      }
    }
  } else {
    attempts.push({ via: 'channels', ok: false, error: `${ENV_DISABLE_CHANNELS}=1 のため省略`, ms: 0 });
  }

  if (browser === undefined) {
    const t0 = Date.now();
    try {
      install = await ensureChromium();
      browser = await chromium.launch({ executablePath: install.executablePath, headless: true, timeout: 60_000 });
      attempts.push({ via: 'download', ok: true, ms: Date.now() - t0 });
      via = 'download';
    } catch (error) {
      attempts.push({ via: 'download', ok: false, error: shortError(error), ms: Date.now() - t0 });
      throw new Error(`ブラウザを起動できませんでした: ${JSON.stringify(attempts)}`);
    }
  }

  const context = await browser.newContext({
    viewport: { ...VIEWPORT },
    userAgent: USER_AGENT,
    locale: 'ja-JP',
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => {
    const request = route.request();
    let host = '';
    try {
      host = new URL(request.url()).hostname;
    } catch {
      // data: 等はそのまま通す
    }
    // 解析系は止める。画像・フォント・メディアも判定に不要なので読まない（サイトへの要求を減らす）。
    if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) return route.abort();
    if (['image', 'font', 'media'].includes(request.resourceType())) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const info: LaunchInfo = {
    via: via!,
    browserVersion: browser.version(),
    launchMs: Date.now() - started,
    attempts,
    install,
  };
  log(`browser launched via=${info.via} version=${info.browserVersion} in ${info.launchMs}ms`);
  return { browser, context, page, info };
}
