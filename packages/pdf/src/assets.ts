import { joinPath, nodeFsAdapter, type FsAdapter } from "./fs-adapter.ts";

/**
 * pdfjs が必要とする付属データ（定義済み CMap・標準フォント）の供給口。
 *
 * 埋め込みでない日本語フォント（UniJIS-UCS2-H などの定義済み CMap を使うもの）は、
 * CMap データが無いと本文が空になったり化けたりする。単一バイナリでも動くよう、
 * pdfjs にはファイル URL ではなくバイト列で渡す。
 */
export interface PdfAssets {
  /** 例: `"UniJIS-UCS2-H.bcmap"`。無ければ undefined。 */
  cMap(filename: string): Promise<Uint8Array | undefined>;
  /** 例: `"LiberationSans-Regular.ttf"`, `"FoxitSerif.pfb"`。無ければ undefined。 */
  standardFont(filename: string): Promise<Uint8Array | undefined>;
}

/** 何も供給しない（CMap 無しの挙動確認用）。 */
export const noPdfAssets: PdfAssets = {
  cMap: async () => undefined,
  standardFont: async () => undefined,
};

/** メモリ上のバイト列から供給する（単一バイナリに埋め込んだ資産を渡す用途）。 */
export function mapPdfAssets(files: {
  cMaps?: Record<string, Uint8Array>;
  standardFonts?: Record<string, Uint8Array>;
}): PdfAssets {
  const cMaps = new Map(Object.entries(files.cMaps ?? {}));
  const fonts = new Map(Object.entries(files.standardFonts ?? {}));
  return {
    cMap: async (name) => cMaps.get(name),
    standardFont: async (name) => fonts.get(name),
  };
}

/** ディレクトリから供給する。pdfjs-dist の `cmaps/` と `standard_fonts/` と同じ構成を想定。 */
export function dirPdfAssets(dirs: { cMaps?: string; standardFonts?: string }, fs: FsAdapter = nodeFsAdapter()): PdfAssets {
  const read = async (dir: string | undefined, name: string) => {
    if (dir === undefined || !isPlainFileName(name)) return undefined;
    return fs.readFile(joinPath(dir, name));
  };
  return {
    cMap: (name) => read(dirs.cMaps, name),
    standardFont: (name) => read(dirs.standardFonts, name),
  };
}

/**
 * 依存として入っている pdfjs-dist パッケージの `cmaps/`・`standard_fonts/` から供給する。
 * node_modules がある環境（開発・テスト・通常の Node / Bun 実行）向け。単一バイナリでは
 * パッケージの場所を引けないので、`setPdfAssets` で埋め込み資産を渡すこと。
 */
export function pdfjsDistAssets(fs: FsAdapter = nodeFsAdapter()): PdfAssets {
  let inner: Promise<PdfAssets> | undefined;
  const get = () =>
    (inner ??= locatePdfjsDist().then(
      (root) => (root === undefined ? noPdfAssets : dirPdfAssets({ cMaps: `${root}cmaps/`, standardFonts: `${root}standard_fonts/` }, fs)),
    ));
  return {
    cMap: async (name) => (await get()).cMap(name),
    standardFont: async (name) => (await get()).standardFont(name),
  };
}

let current: PdfAssets | undefined;
let fallback: PdfAssets | undefined;

/** 以後の抽出で使う資産を差し替える。undefined で既定（pdfjsDistAssets）に戻す。 */
export function setPdfAssets(assets: PdfAssets | undefined): void {
  current = assets;
}

export function getPdfAssets(): PdfAssets {
  return current ?? (fallback ??= pdfjsDistAssets());
}

function isPlainFileName(name: string): boolean {
  return name.length > 0 && !/[\\/]/.test(name) && name !== "." && name !== "..";
}

const NODE_MODULE = "node:module";

/** pdfjs-dist のパッケージディレクトリ（末尾 `/` 付きのパスか file URL）。見つからなければ undefined。 */
async function locatePdfjsDist(): Promise<string | undefined> {
  const spec = "pdfjs-dist/package.json";
  const resolve = (import.meta as { resolve?: (s: string) => string }).resolve;
  if (typeof resolve === "function") {
    try {
      const url = resolve(spec);
      if (url.startsWith("file:")) return new URL(".", url).href;
    } catch {
      // 次の方法を試す
    }
  }
  try {
    const mod = (await import(/* @vite-ignore */ NODE_MODULE)) as {
      createRequire(from: string): { resolve(s: string): string };
    };
    return mod.createRequire(import.meta.url).resolve(spec).replace(/package\.json$/, "");
  } catch {
    return undefined;
  }
}
