// @chibatech-src/build: 単一バイナリ・mcpb のビルドの純粋な部分。実行は cli.ts（Bun）から。
export {
  COMPILE_TARGETS,
  DEFAULT_OUTPUT_KEYS,
  OUTPUTS,
  binaryFileName,
  compileTargetsOf,
  resolveOutputs,
  type CompileTarget,
  type Output,
} from "./targets.ts";
export { COREBUNDLE_FILTER, EXTERNALS, PLAYWRIGHT_CORE_RULES, applyRules, patchPlaywrightCoreSource, playwrightCorePlugin } from "./plugins.ts";
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
  renderDarwinLauncher,
  validateManifest,
  type DarwinMode,
  type McpbManifest,
  type McpbPlatform,
  type ToolEntry,
} from "./manifest.ts";
export { parseCliArgs, type CliOptions } from "./args.ts";
export { formatSha256Sums, mcpbFileName, parseLipoArchs, type BuildReport } from "./report.ts";
