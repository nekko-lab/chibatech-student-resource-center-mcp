/**
 * ビルド対象の一覧（`bun build --compile --target` の 1 回分ずつ）。
 *
 * - 既定は darwin-arm64・windows-x64・linux-x64・linux-arm64 の 4 つ。
 *   macOS は Apple シリコン（M1 以降）だけを対象にする（Intel Mac は対象外）。
 * - mcpb は全 OS 共通の 1 つ（darwin-arm64 + windows-x64）。組み立ては manifest.ts と cli.ts。
 * - x64 の `-baseline` 版（AVX2 の無い古い CPU 向け）は Windows と Linux だけ、オプションで出す。
 */
export interface Target {
  /** 出力ファイル名に使う識別子（例: `darwin-arm64`, `windows-x64-baseline`） */
  readonly key: string;
  /** `bun build --compile --target` に渡す名前 */
  readonly bunTarget: string;
  readonly exe: "" | ".exe";
  readonly darwin: boolean;
  readonly baseline: boolean;
}

const target = (key: string, baseline = false): Target => ({
  key,
  bunTarget: `bun-${key}`,
  exe: key.startsWith("windows-") ? ".exe" : "",
  darwin: key.startsWith("darwin-"),
  baseline,
});

export const TARGETS: readonly Target[] = [
  target("darwin-arm64"),
  target("windows-x64"),
  target("linux-x64"),
  target("linux-arm64"),
  target("windows-x64-baseline", true),
  target("linux-x64-baseline", true),
];

export const DEFAULT_TARGET_KEYS: readonly string[] = ["darwin-arm64", "windows-x64", "linux-x64", "linux-arm64"];

/**
 * `--targets` と `--baseline` から対象を決める。keys が undefined なら既定の 4 つ。
 * baseline が真なら、選んだもののうち baseline 版があるもの（Windows / Linux の x64）を末尾に足す。
 */
export function resolveTargets(keys: readonly string[] | undefined, baseline: boolean): Target[] {
  const wanted = keys ?? DEFAULT_TARGET_KEYS;
  if (wanted.length === 0) throw new Error("ターゲットが空です");
  const byKey = new Map(TARGETS.map((t) => [t.key, t]));
  const picked: Target[] = [];
  const add = (t: Target) => {
    if (!picked.includes(t)) picked.push(t);
  };
  for (const key of wanted) {
    const t = byKey.get(key);
    if (t === undefined) throw new Error(`未知のターゲット: ${key}（対応: ${TARGETS.map((x) => x.key).join(", ")}）`);
    add(t);
  }
  if (baseline) {
    for (const t of [...picked]) {
      const b = byKey.get(`${t.key}-baseline`);
      if (b !== undefined) add(b);
    }
  }
  return picked;
}

/** `<名前>-<target>[.exe]` */
export function binaryFileName(name: string, t: { key: string; exe: string }): string {
  return `${name}-${t.key}${t.exe}`;
}
