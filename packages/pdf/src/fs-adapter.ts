/**
 * ファイルシステムへの最小限の入口。
 * 製品は Bun の単一バイナリか Node SEA になるため、実行環境固有の API はこの裏に閉じ込める。
 */
export interface FsAdapter {
  /** ファイルが無ければ undefined を返す（それ以外の失敗は例外）。 */
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** 置き換え先が既にあれば上書きする。 */
  rename(from: string, to: string): Promise<void>;
  /** 親も含めて作る。既にあっても失敗しない。 */
  mkdir(path: string): Promise<void>;
}

interface NodeFsPromises {
  readFile(path: string | URL): Promise<Uint8Array>;
  writeFile(path: string | URL, data: Uint8Array): Promise<void>;
  rename(from: string | URL, to: string | URL): Promise<void>;
  mkdir(path: string | URL, opts: { recursive: true }): Promise<unknown>;
}

/**
 * `node:fs/promises` を使う既定の実装（Node・Bun のどちらでも動く）。
 * `file:` で始まるパスは file URL として扱う。
 */
export function nodeFsAdapter(): FsAdapter {
  let fsp: Promise<NodeFsPromises> | undefined;
  // 文字列の specifier を変数経由で渡し、ブラウザ向けのバンドラが静的に解決しようとしないようにする
  const load = () => (fsp ??= import(/* @vite-ignore */ NODE_FS) as Promise<NodeFsPromises>);
  const p = (path: string): string | URL => (path.startsWith("file:") ? new URL(path) : path);

  return {
    async readFile(path) {
      const fs = await load();
      try {
        const buf = await fs.readFile(p(path));
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (e) {
        if (isNotFound(e)) return undefined;
        throw e;
      }
    },
    async writeFile(path, data) {
      await (await load()).writeFile(p(path), data);
    },
    async rename(from, to) {
      await (await load()).rename(p(from), p(to));
    },
    async mkdir(path) {
      await (await load()).mkdir(p(path), { recursive: true });
    },
  };
}

const NODE_FS = "node:fs/promises";

function isNotFound(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** ディレクトリとファイル名をつなぐ。区切りは `/`（Windows の Node / Bun も受け付ける）。 */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`;
}
