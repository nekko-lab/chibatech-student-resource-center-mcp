/** cli.ts の引数の解釈（純関数）。 */
import { DEFAULT_NAME, isSemver, type DarwinMode } from "./manifest.ts";

export interface CliOptions {
  /** 単一バイナリの入口（リポジトリのルートからの相対パスか絶対パス） */
  entry: string;
  out: string;
  /** semver（先頭に v を付けない） */
  version: string;
  /** mcpb の `tools` に載せる JSON（`[{ name, description }]`） */
  tools: string;
  name: string;
  targets: string[] | undefined;
  baseline: boolean;
  /** false なら mcpb を作らない（検証用のバイナリだけを作るとき） */
  mcpb: boolean;
  /** macOS の配り方。universal（既定。lipo でまとめる）/ launcher（起動スクリプトで選ぶ代替） */
  darwin: DarwinMode;
  /** 真なら lipo 前の darwin-arm64 / darwin-x64 と launch.sh を <out>/slices に残す（代替の検証用。Release には載せない） */
  keepSlices: boolean;
}

export const USAGE =
  "bun run tools/build/src/cli.ts --entry <file> --out <dir> --version <x.y.z> --tools <tools.json> " +
  "[--targets a,b] [--baseline] [--name <名前>] [--no-mcpb] [--darwin universal|launcher] [--keep-slices]";

const VALUED = new Set(["entry", "out", "version", "tools", "targets", "name", "darwin"]);
const FLAGS = new Set(["baseline", "no-mcpb", "keep-slices"]);

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error(`引数の形が不正です: ${arg}\n${USAGE}`);
    const eq = arg.indexOf("=");
    const key = arg.slice(2, eq < 0 ? undefined : eq);
    if (FLAGS.has(key) && eq < 0) {
      flags.add(key);
      continue;
    }
    if (!VALUED.has(key)) throw new Error(`未知の引数です: --${key}\n${USAGE}`);
    let value: string | undefined;
    if (eq >= 0) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${key} に値がありません\n${USAGE}`);
      i++;
    }
    values.set(key, value);
  }
  const required = (key: string): string => {
    const v = values.get(key);
    if (v === undefined || v.length === 0) throw new Error(`--${key} は必須です\n${USAGE}`);
    return v;
  };
  const entry = required("entry");
  const out = required("out");
  const version = required("version");
  const tools = required("tools");
  if (!isSemver(version)) throw new Error(`--version は semver で（v は付けない）: ${version}`);
  const darwin = values.get("darwin") ?? "universal";
  if (darwin !== "universal" && darwin !== "launcher") throw new Error(`--darwin は universal か launcher: ${darwin}`);
  const targetsText = values.get("targets");
  return {
    entry,
    out,
    version,
    tools,
    name: values.get("name") ?? DEFAULT_NAME,
    targets:
      targetsText === undefined
        ? undefined
        : targetsText
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
    baseline: flags.has("baseline"),
    mcpb: !flags.has("no-mcpb"),
    darwin,
    keepSlices: flags.has("keep-slices"),
  };
}
