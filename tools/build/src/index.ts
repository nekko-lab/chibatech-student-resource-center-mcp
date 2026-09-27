// @chibatech-src/build: 単一バイナリ・mcpb のビルドの純粋な部分。実行は cli.ts（Bun）から。
export { DEFAULT_TARGET_KEYS, TARGETS, binaryFileName, resolveTargets, type Target } from "./targets.ts";
export {
  COREBUNDLE_FILTER,
  EXTERNALS,
  PLAYWRIGHT_CORE_RULES,
  SERVER_VERSION_FILTER,
  applyRules,
  patchPlaywrightCoreSource,
  patchServerVersionSource,
  playwrightCorePlugin,
  serverVersionPlugin,
} from "./plugins.ts";
export {
  REQUIRED_CMAPS,
  collectPdfAssets,
  renderPreamble,
  selectPdfAssets,
  summarizePdfAssets,
  type PdfAssetFile,
  type PdfAssetSummary,
} from "./assets.ts";
export { embeddedPdfAssets, type EmbeddedPdfAssetTable } from "./runtime-assets.ts";
export {
  DEFAULT_NAME,
  MANIFEST_VERSION,
  USER_CONFIG_ENV,
  buildManifest,
  isSemver,
  mcpbLayout,
  parseToolsJson,
  validateManifest,
  type McpbManifest,
  type McpbPlatform,
  type ToolEntry,
} from "./manifest.ts";
export { collectNotices, isLicenseFileName, packageOfPath, pdfjsAssetLicenseSections, renderNotices, type NoticeSection } from "./notices.ts";
export { parseCliArgs, type CliOptions } from "./args.ts";
export { renderToolsJson, serverToolDefinitions, writeServerToolsJson } from "./tools-json.ts";
export { formatSha256Sums, mcpbFileName, type BuildReport } from "./report.ts";
