/**
 * 単一バイナリの実行時に使う部分（起動前処理モジュールから import される）。
 *
 * `import x from "..." with { type: "file" }` で埋め込んだファイルは、実行時には
 * バイナリ内の仮想ファイルシステムのパス（`/$bunfs/root/...`、Windows では `B:/~BUN/root/...`）になる。
 * 名前 → パスの表から、要求された CMap・標準フォントだけを必要になった時点で読む。
 */
import type { PdfAssets } from "@chibatech-src/pdf";

export interface EmbeddedPdfAssetTable {
  cMaps?: Record<string, string>;
  standardFonts?: Record<string, string>;
}

export type ReadBytes = (path: string) => Promise<Uint8Array>;

export function embeddedPdfAssets(table: EmbeddedPdfAssetTable, read: ReadBytes): PdfAssets {
  const lookup = (entries: Record<string, string> | undefined) => {
    const paths = new Map(Object.entries(entries ?? {}));
    const cache = new Map<string, Promise<Uint8Array>>();
    return (name: string): Promise<Uint8Array | undefined> => {
      const p = paths.get(name);
      if (p === undefined) return Promise.resolve(undefined);
      let bytes = cache.get(name);
      if (bytes === undefined) {
        // Buffer などの派生型を pdfjs に渡さないよう、素の Uint8Array にそろえる
        bytes = read(p).then((b) => (b.constructor === Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
        cache.set(name, bytes);
      }
      return bytes;
    };
  };
  const cMap = lookup(table.cMaps);
  const standardFont = lookup(table.standardFonts);
  return { cMap, standardFont };
}
