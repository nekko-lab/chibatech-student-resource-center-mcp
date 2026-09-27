/**
 * PDF 本文の抽出（pdfjs-dist の legacy build、worker 無効）。
 *
 * Node / Bun では pdfjs は「fake worker」を使うが、既定では worker モジュールを動的 import する。
 * 単一バイナリでは動的 import 先が存在しないため、worker モジュールを静的に取り込み
 * globalThis.pdfjsWorker に置く（pdfjs はこれがあれば同一スレッドでそのまま使う）。
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

(globalThis as any).pdfjsWorker = pdfjsWorker;

export interface PdfPageText {
  numPages: number;
  text: string;
}

export async function extractPageText(data: Uint8Array, pageNumber: number): Promise<PdfPageText> {
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`page ${pageNumber} は範囲外です（1..${doc.numPages}）`);
    }
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => (typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : '') : ''))
      .join('');
    return { numPages: doc.numPages, text };
  } finally {
    // pdfjs v6 では PDFDocumentProxy.destroy が無く、loading task 側で破棄する
    await task.destroy();
  }
}
