// 型だけの参照（実行時の挙動は変わらない）。他のワークスペースからソースを直接型検査するときにも
// worker モジュールの宣言が届くようにする。
/// <reference path="./pdfjs-worker.d.ts" />
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { getPdfAssets, type PdfAssets } from "./assets.ts";
import { layoutText, type LayoutItem } from "./layout.ts";

export interface PageText {
  /** 1 始まり。 */
  page: number;
  text: string;
}

/**
 * pdfjs の textContent item。座標はページ左上を原点とする PDF user space（scale 1）。
 * y はページ上端からベースラインまで。回転・原点のずれた MediaBox は viewport 変換で吸収する
 * （通常のページでは x = transform[4], y = ページ高さ - transform[5]）。
 */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageItems {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<Pdfjs> | undefined;

/**
 * pdfjs の legacy build を worker 無し（メインスレッド）で読み込む。
 * worker モジュールを先に読み込んで globalThis.pdfjsWorker に置くと、pdfjs は Worker を起こさず
 * 同じスレッドで処理する。静的な specifier なのでバンドラ（bun build など）にも取り込まれる。
 */
function loadPdfjs(): Promise<Pdfjs> {
  return (pdfjs ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const g = globalThis as { pdfjsWorker?: unknown };
    g.pdfjsWorker ??= worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })());
}

/** pdfjs の BinaryDataFactory。CMap・標準フォントを URL ではなく PdfAssets からバイト列で渡す。 */
function binaryDataFactory(assets: PdfAssets) {
  return class AssetBinaryDataFactory {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      let data: Uint8Array | undefined;
      if (kind === "cMapUrl") data = await assets.cMap(filename);
      else if (kind === "standardFontDataUrl") data = await assets.standardFont(filename);
      if (data === undefined) throw new Error(`PDF asset is not available: ${kind} ${filename}`);
      return data;
    }
  };
}

async function withDocument<T>(bytes: Uint8Array, fn: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const { getDocument } = await loadPdfjs();
  const task = getDocument({
    // pdfjs は渡した配列を worker 側へ移すことがあるので、呼び出し側の配列を守るため複製する
    // （Node の Buffer も普通の Uint8Array にそろう）
    data: new Uint8Array(bytes),
    BinaryDataFactory: binaryDataFactory(getPdfAssets()),
    useWorkerFetch: false,
    cMapPacked: true,
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
  });
  try {
    return await fn(await task.promise);
  } finally {
    await task.destroy();
  }
}

interface RawPage {
  page: number;
  width: number;
  height: number;
  items: LayoutItem[];
}

async function readPage(doc: PDFDocumentProxy, pageNumber: number): Promise<RawPage> {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: LayoutItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || it.str === "") continue;
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]) as [number, number];
      const item: LayoutItem = { str: it.str, x, y, width: it.width, height: it.height };
      if (it.dir === "ttb") item.vertical = true;
      items.push(item);
    }
    return { page: pageNumber, width: viewport.width, height: viewport.height, items };
  } finally {
    page.cleanup();
  }
}

export function pageCount(bytes: Uint8Array): Promise<number> {
  return withDocument(bytes, async (doc) => doc.numPages);
}

/**
 * ページごとの本文を返す。from / to（1 始まり、両端を含む）は PDF のページ数に切り詰める。
 * 行の復元方法は layoutText を参照。
 */
export function extractText(bytes: Uint8Array, opts: { from?: number; to?: number } = {}): Promise<PageText[]> {
  return withDocument(bytes, async (doc) => {
    const from = Math.max(1, Math.ceil(opts.from ?? 1));
    const to = Math.min(doc.numPages, Math.floor(opts.to ?? doc.numPages));
    const out: PageText[] = [];
    for (let p = from; p <= to; p++) {
      const { items } = await readPage(doc, p);
      out.push({ page: p, text: layoutText(items) });
    }
    return out;
  });
}

/** 1 ページ分の item を座標付きで返す（表の列推定など、呼び出し側で配置を読むため）。 */
export function extractItems(bytes: Uint8Array, page: number): Promise<PageItems> {
  return withDocument(bytes, async (doc) => {
    if (!Number.isInteger(page) || page < 1 || page > doc.numPages) {
      throw new RangeError(`page ${page} is out of range (1..${doc.numPages})`);
    }
    const raw = await readPage(doc, page);
    return {
      ...raw,
      items: raw.items.map(({ str, x, y, width, height }) => ({ str, x, y, width, height })),
    };
  });
}
