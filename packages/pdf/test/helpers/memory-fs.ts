import type { FsAdapter } from "../../src/index.ts";

/** テスト用のメモリ上ファイルシステム。書き込み・改名の履歴も残す。 */
export class MemoryFs implements FsAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly log: string[] = [];

  async readFile(path: string): Promise<Uint8Array | undefined> {
    const f = this.files.get(path);
    return f === undefined ? undefined : f.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.log.push(`write ${path}`);
    this.files.set(path, data.slice());
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (f === undefined) throw new Error(`ENOENT: ${from}`);
    this.log.push(`rename ${from} -> ${to}`);
    this.files.delete(from);
    this.files.set(to, f);
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
}
