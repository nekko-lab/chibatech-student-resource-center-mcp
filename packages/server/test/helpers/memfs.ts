/**
 * テスト用のメモリ上の FsAdapter（`@chibatech-src/pdf` の FsAdapter と同じ口）。
 */
import type { FsAdapter } from "@chibatech-src/pdf";

export interface MemoryFs extends FsAdapter {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  writes: string[];
}

export function memoryFs(): MemoryFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const writes: string[] = [];
  return {
    files,
    dirs,
    writes,
    async readFile(path) {
      const f = files.get(path);
      return f === undefined ? undefined : f.slice();
    },
    async writeFile(path, data) {
      writes.push(path);
      files.set(path, data.slice());
    },
    async rename(from, to) {
      const f = files.get(from);
      if (f === undefined) throw Object.assign(new Error(`ENOENT: ${from}`), { code: "ENOENT" });
      files.delete(from);
      files.set(to, f);
    },
    async mkdir(path) {
      dirs.add(path);
    },
  };
}
