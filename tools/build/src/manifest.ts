/**
 * mcpb manifest（binary 型）の組み立てと検証。純関数だけを置く。
 *
 * - mcpb は全 OS 共通の 1 つ。`compatibility.platforms` は darwin と win32（Claude Desktop に Linux 版は無い）。
 * - macOS は `server/<名前>`（arm64 + x64 のユニバーサルバイナリ）を直接起動する。
 *   Windows は `mcp_config.platform_overrides.win32` で `server/<名前>.exe` を起動する。
 * - 代替（darwin: "launcher"）: lipo したバイナリが動かないときは、`/bin/sh server/launch.sh` が
 *   `uname -m` で `server/<名前>-arm64` / `-x64` を選ぶ。
 * - user_config はすべて任意入力。値は環境変数でサーバに渡す（未入力のときの扱いはサーバ側の責務）。
 */
export type McpbPlatform = "darwin" | "win32" | "linux";

export const MANIFEST_VERSION = "0.3";
export const REPOSITORY_URL = "https://github.com/nekko-lab/chibatech-student-resource-center-mcp";
export const DEFAULT_NAME = "chibatech-src-mcp";

export interface ToolEntry {
  name: string;
  description: string;
}

export type UserConfigType = "string" | "number" | "boolean" | "directory" | "file";

export interface UserConfigField {
  type: UserConfigType;
  title: string;
  description: string;
  required: boolean;
  min?: number;
  max?: number;
}

export interface McpbManifest {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  long_description?: string;
  author: { name: string; url?: string };
  repository: { type: "git"; url: string };
  homepage?: string;
  support?: string;
  keywords?: string[];
  server: {
    type: "binary";
    entry_point: string;
    mcp_config: McpConfig & { platform_overrides: { win32: McpConfig } };
  };
  tools: ToolEntry[];
  user_config: Record<string, UserConfigField>;
  compatibility: { platforms: McpbPlatform[] };
}

export interface McpConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** user_config のキー → サーバが読む環境変数名 */
export const USER_CONFIG_ENV = {
  student_type: "CSRC_STUDENT_TYPE",
  admission_year: "CSRC_ADMISSION_YEAR",
  department: "CSRC_DEPARTMENT",
  download_dir: "CSRC_DOWNLOAD_DIR",
} as const;

const USER_CONFIG: Record<keyof typeof USER_CONFIG_ENV, UserConfigField> = {
  student_type: {
    type: "string",
    title: "区分",
    description: "学部生か大学院生か（例: 学部生）。空欄なら、検索のたびに指定します。",
    required: false,
  },
  admission_year: {
    type: "number",
    title: "入学年度",
    description: "西暦の入学年度（例: 2026）。空欄なら、検索のたびに指定します。",
    required: false,
    min: 2000,
    max: 2100,
  },
  department: {
    type: "string",
    title: "学科",
    description: "所属する学科・専攻（例: 情報工学科）。空欄なら、検索のたびに指定します。",
    required: false,
  },
  download_dir: {
    type: "directory",
    title: "保存先フォルダ",
    description: "資料（PDF）を保存するフォルダ。空欄なら既定の場所に保存します。",
    required: false,
  },
};

export type DarwinMode = "universal" | "launcher";

export interface ManifestInput {
  name: string;
  version: string;
  tools: readonly ToolEntry[];
  /** universal: lipo でまとめた 1 つを直接起動 / launcher: uname -m で選ぶ起動スクリプト（lipo が動かないときの代替） */
  darwin: DarwinMode;
}

export interface McpbEntry {
  /** mcpb の中のパス */
  path: string;
  /** 元になる出力（targets.ts の Output.key） */
  from: string;
  executable: boolean;
}

/** mcpb に入れる実行ファイルの配置。launcher は起動スクリプトの置き場所（universal では undefined）。 */
export function mcpbLayout(name: string, darwin: DarwinMode): { entries: McpbEntry[]; launcher: string | undefined } {
  const win: McpbEntry = { path: `server/${name}.exe`, from: "windows-x64", executable: false };
  if (darwin === "universal") {
    return { entries: [{ path: `server/${name}`, from: "darwin-universal", executable: true }, win], launcher: undefined };
  }
  return {
    entries: [
      { path: `server/${name}-arm64`, from: "darwin-arm64", executable: true },
      { path: `server/${name}-x64`, from: "darwin-x64", executable: true },
      win,
    ],
    launcher: LAUNCHER_PATH,
  };
}

const LAUNCHER_PATH = "server/launch.sh";

/** 代替の起動スクリプト（macOS 用）。CPU に合うバイナリを exec する。 */
export function renderDarwinLauncher(name: string): string {
  return [
    "#!/bin/sh",
    "# 非公式 MCP サーバの起動スクリプト（macOS）。CPU に合う単一バイナリを選んで起動する。",
    'dir=$(cd "$(dirname "$0")" && pwd)',
    'case "$(uname -m)" in',
    `  arm64) exec "$dir/${name}-arm64" "$@" ;;`,
    `  x86_64) exec "$dir/${name}-x64" "$@" ;;`,
    '  *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;',
    "esac",
    "",
  ].join("\n");
}

export function buildManifest(input: ManifestInput): McpbManifest {
  const env: Record<string, string> = {};
  for (const [key, envName] of Object.entries(USER_CONFIG_ENV)) env[envName] = `\${user_config.${key}}`;
  const layout = mcpbLayout(input.name, input.darwin);
  const entryPoint = layout.launcher ?? layout.entries[0]!.path;
  const darwinCommand =
    layout.launcher === undefined
      ? { command: `\${__dirname}/${entryPoint}`, args: [] as string[] }
      : { command: "/bin/sh", args: [`\${__dirname}/${entryPoint}`] };
  const manifest: McpbManifest = {
    manifest_version: MANIFEST_VERSION,
    name: input.name,
    display_name: "千葉工業大学 学生資料室 MCP（非公式）",
    version: input.version,
    description:
      "非公式ツールです。千葉工業大学および学生資料室の運営者とは関係ありません。学生資料室の資料を探し、PDF の本文を読み取ります。",
    author: { name: "nekko-lab", url: "https://github.com/nekko-lab" },
    repository: { type: "git", url: REPOSITORY_URL },
    homepage: REPOSITORY_URL,
    support: `${REPOSITORY_URL}/issues`,
    keywords: ["chibatech", "unofficial", "playwright"],
    server: {
      type: "binary",
      entry_point: entryPoint,
      mcp_config: {
        ...darwinCommand,
        env,
        platform_overrides: {
          // 上書きの env の扱い（本体と合成されるか置き換えか）に依らず効くよう、同じ env を写す
          win32: { command: `\${__dirname}/server/${input.name}.exe`, args: [], env: { ...env } },
        },
      },
    },
    tools: input.tools.map((t) => ({ name: t.name, description: t.description })),
    user_config: structuredClone(USER_CONFIG),
    compatibility: { platforms: [...PLATFORMS] },
  };
  const errors = validateManifest(manifest);
  if (errors.length > 0) throw new Error(`manifest が不正です:\n- ${errors.join("\n- ")}`);
  return manifest;
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const NAME = /^[a-z0-9][a-z0-9-]*$/;
/** MCP のツール名として無難な形 */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** mcpb に載せる OS（順序も固定） */
const PLATFORMS: readonly McpbPlatform[] = ["darwin", "win32"];
const USER_CONFIG_TYPES: readonly UserConfigType[] = ["string", "number", "boolean", "directory", "file"];

export function isSemver(v: string): boolean {
  return SEMVER.test(v);
}

/** 誤りの一覧を返す（0 件なら正しい）。 */
export function validateManifest(m: McpbManifest): string[] {
  const errors: string[] = [];
  if (m.manifest_version !== MANIFEST_VERSION) errors.push(`manifest_version は ${MANIFEST_VERSION}`);
  if (!NAME.test(m.name)) errors.push(`name は小文字英数字とハイフン: ${m.name}`);
  if (!isSemver(m.version)) errors.push(`version が semver ではありません: ${m.version}`);
  if (!m.display_name.includes("非公式")) errors.push("display_name に「非公式」を含めること");
  if (!m.description.includes("非公式")) errors.push("description に「非公式」を含めること");
  if (m.author.name.length === 0) errors.push("author.name が空です");
  if (m.server.type !== "binary") errors.push("server.type は binary");
  const cfg = m.server.mcp_config;
  if (!/^server\/[^/\\]+$/.test(m.server.entry_point)) errors.push(`server.entry_point は server/<名前>: ${m.server.entry_point}`);
  const direct = cfg.command === `\${__dirname}/${m.server.entry_point}` && cfg.args.length === 0;
  const viaSh = cfg.command === "/bin/sh" && cfg.args.length === 1 && cfg.args[0] === `\${__dirname}/${m.server.entry_point}`;
  if (!direct && !viaSh) errors.push(`mcp_config.command / args が entry_point を指していません: ${cfg.command} ${JSON.stringify(cfg.args)}`);
  const overrides = (cfg.platform_overrides ?? {}) as Record<string, McpConfig | undefined>;
  for (const os of Object.keys(overrides)) if (os !== "win32") errors.push(`platform_overrides は win32 だけ: ${os}`);
  const win = overrides.win32;
  if (win === undefined) errors.push("platform_overrides.win32 がありません");
  else {
    if (!/^\$\{__dirname\}\/server\/[^/\\]+\.exe$/.test(win.command)) errors.push(`platform_overrides.win32.command は server/<名前>.exe: ${win.command}`);
    if (!Array.isArray(win.args) || win.args.length !== 0) errors.push("platform_overrides.win32.args は空にする（macOS 用の args を引き継がない）");
    if (JSON.stringify(win.env ?? {}) !== JSON.stringify(cfg.env)) errors.push("platform_overrides.win32.env は本体の env と同じにする");
  }
  for (const [envName, value] of Object.entries(m.server.mcp_config.env)) {
    if (!/^CSRC_[A-Z0-9_]+$/.test(envName)) errors.push(`env の名前は CSRC_ で始める: ${envName}`);
    for (const ref of value.matchAll(/\$\{user_config\.([^}]+)\}/g)) {
      if (!(ref[1]! in m.user_config)) errors.push(`env ${envName} が存在しない user_config を参照しています: ${ref[1]}`);
    }
  }
  const envText = Object.values(m.server.mcp_config.env).join(" ");
  for (const [key, field] of Object.entries(m.user_config)) {
    if (!USER_CONFIG_TYPES.includes(field.type)) errors.push(`user_config.${key}.type が不正: ${field.type}`);
    if (field.required) errors.push(`user_config.${key} は任意入力（required: false）にすること`);
    if (field.title.length === 0 || field.description.length === 0) errors.push(`user_config.${key} に title と description が要ります`);
    if (!envText.includes(`\${user_config.${key}}`)) errors.push(`user_config.${key} が env で使われていません`);
  }
  if (m.tools.length === 0) errors.push("tools が空です");
  const seen = new Set<string>();
  for (const t of m.tools) {
    if (!TOOL_NAME.test(t.name)) errors.push(`ツール名が不正: ${t.name}`);
    if (seen.has(t.name)) errors.push(`ツール名が重複: ${t.name}`);
    seen.add(t.name);
    if (typeof t.description !== "string" || t.description.length === 0) errors.push(`ツール ${t.name} の description が空です`);
  }
  if (JSON.stringify(m.compatibility.platforms) !== JSON.stringify(PLATFORMS)) {
    errors.push(`compatibility.platforms は ${JSON.stringify(PLATFORMS)}: ${JSON.stringify(m.compatibility.platforms)}`);
  }
  return errors;
}

/** `--tools` の JSON（`toolDefinitions()` の出力）を読む。name と description 以外は落とす。 */
export function parseToolsJson(text: string): ToolEntry[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("tools の JSON は配列にしてください");
  return data.map((item: unknown, i) => {
    const t = item as { name?: unknown; description?: unknown };
    if (typeof t?.name !== "string" || t.name.length === 0) throw new Error(`tools[${i}].name がありません`);
    if (typeof t.description !== "string" || t.description.length === 0) throw new Error(`tools[${i}].description がありません`);
    return { name: t.name, description: t.description };
  });
}
