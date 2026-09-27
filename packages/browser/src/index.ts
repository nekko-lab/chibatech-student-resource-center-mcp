// @chibatech-src/browser — ブラウザの調達（Chrome → Edge → Chrome Headless Shell）と、単一バイナリの起動振り分け。
// 非公式ツールの一部。千葉工業大学および「学生資料室」ポータルの運営者とは関係ありません。
export { BrowserUnavailableError, acquireBrowser, type AcquireAttempt } from "./acquire.ts";
export { browsersDirectory, customDownloadUrl, headlessShellLayout, type HeadlessShellLayout } from "./download-url.ts";
export { detectLaunchRole, runLauncher, type LaunchRole } from "./launcher.ts";
export {
  optionsFromEnv,
  resolveOptions,
  type AcquireOptions,
  type Channel,
  type InstallMode,
  type ResolvedOptions,
  type Via,
} from "./options.ts";
