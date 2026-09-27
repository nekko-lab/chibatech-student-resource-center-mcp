/**
 * ビルド対象の一覧。
 *
 * - コンパイルの単位（CompileTarget）は `bun build --compile --target` の 1 回分。
 * - 出力（Output）は Release に添付する単体バイナリの単位。macOS は arm64 と x64 を llvm-lipo で
 *   1 つのユニバーサルバイナリ（darwin-universal）にまとめる。個別の darwin-arm64 / darwin-x64 は既定では出さない。
 * - mcpb は全 OS 共通の 1 つ（macOS のユニバーサル + Windows x64）。組み立ては manifest.ts と cli.ts。
 * - x64 の `-baseline` 版（AVX2 の無い古い CPU 向け）は Windows と Linux だけ、オプションで出す。
 */
export interface CompileTarget {
  /** 例: `darwin-arm64`, `windows-x64-baseline` */
  readonly key: string;
  /** `bun build --compile --target` に渡す名前 */
  readonly bunTarget: string;
  readonly exe: "" | ".exe";
  readonly baseline: boolean;
}

export interface Output {
  /** 出力ファイル名に使う識別子（例: `darwin-universal`, `linux-x64`） */
  readonly key: string;
  readonly exe: "" | ".exe";
  /** 1 つならそのまま、2 つ（darwin-universal）なら lipo でまとめる */
  readonly parts: readonly CompileTarget[];
  readonly baseline: boolean;
}

const target = (key: string, baseline = false): CompileTarget => ({
  key,
  bunTarget: `bun-${key}`,
  exe: key.startsWith("windows-") ? ".exe" : "",
  baseline,
});

export const COMPILE_TARGETS: readonly CompileTarget[] = [
  target("darwin-arm64"),
  target("darwin-x64"),
  target("windows-x64"),
  target("linux-x64"),
  target("linux-arm64"),
  target("windows-x64-baseline", true),
  target("linux-x64-baseline", true),
];

const t = (key: string): CompileTarget => {
  const found = COMPILE_TARGETS.find((x) => x.key === key);
  if (found === undefined) throw new Error(key);
  return found;
};

const single = (key: string): Output => {
  const part = t(key);
  return { key, exe: part.exe, parts: [part], baseline: part.baseline };
};

export const OUTPUTS: readonly Output[] = [
  { key: "darwin-universal", exe: "", parts: [t("darwin-arm64"), t("darwin-x64")], baseline: false },
  single("darwin-arm64"),
  single("darwin-x64"),
  single("windows-x64"),
  single("linux-x64"),
  single("linux-arm64"),
  single("windows-x64-baseline"),
  single("linux-x64-baseline"),
];

export const DEFAULT_OUTPUT_KEYS: readonly string[] = ["darwin-universal", "windows-x64", "linux-x64", "linux-arm64"];

/**
 * `--targets` と `--baseline` から出力を決める。keys が undefined なら既定の 4 つ。
 * baseline が真なら、選んだ出力のうち baseline 版があるもの（Windows / Linux の x64）を末尾に足す。
 */
export function resolveOutputs(keys: readonly string[] | undefined, baseline: boolean): Output[] {
  const wanted = keys ?? DEFAULT_OUTPUT_KEYS;
  if (wanted.length === 0) throw new Error("ターゲットが空です");
  const byKey = new Map(OUTPUTS.map((o) => [o.key, o]));
  const picked: Output[] = [];
  const add = (o: Output) => {
    if (!picked.includes(o)) picked.push(o);
  };
  for (const key of wanted) {
    const o = byKey.get(key);
    if (o === undefined) throw new Error(`未知のターゲット: ${key}（対応: ${OUTPUTS.map((x) => x.key).join(", ")}）`);
    add(o);
  }
  if (baseline) {
    for (const o of [...picked]) {
      const b = byKey.get(`${o.key}-baseline`);
      if (b !== undefined) add(b);
    }
  }
  return picked;
}

/** 出力に要るコンパイルを重複なく並べる（1 回のコンパイルを複数の出力で使い回す）。 */
export function compileTargetsOf(outputs: readonly Output[]): CompileTarget[] {
  const list: CompileTarget[] = [];
  for (const o of outputs) for (const p of o.parts) if (!list.includes(p)) list.push(p);
  return list;
}

/** `<名前>-<出力>[.exe]` */
export function binaryFileName(name: string, output: { key: string; exe: string }): string {
  return `${name}-${output.key}${output.exe}`;
}
