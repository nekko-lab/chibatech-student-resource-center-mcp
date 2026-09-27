/**
 * テスト用 PDF をテスト実行時に合成する。サイトの PDF はリポジトリに入れない（大学のポリシー）。
 * 日本語フォントは Dockerfile で取得した Noto Sans JP（OFL）を PDFX_TEST_FONT から読む。
 */
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
  beginText,
  endText,
  moveText,
  setFontAndSize,
  showText,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

let fontBytes: Promise<Uint8Array> | undefined;

export function japaneseFontBytes(): Promise<Uint8Array> {
  const path = process.env.PDFX_TEST_FONT;
  if (!path) {
    throw new Error("PDFX_TEST_FONT が未設定。テストは scripts/test.sh（Docker）から実行する");
  }
  return (fontBytes ??= readFile(path).then((b) => new Uint8Array(b)));
}

export interface Placed {
  text: string;
  x: number;
  /** PDF 座標（下端が 0）でのベースライン。 */
  y: number;
  size?: number;
}

export interface SynthPage {
  width?: number;
  height?: number;
  /** 描画順（= content stream の順）に並べる。 */
  texts: Placed[];
}

async function build(pages: SynthPage[], font: "latin" | "japanese"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let f: PDFFont;
  if (font === "japanese") {
    doc.registerFontkit(fontkit);
    f = await doc.embedFont(await japaneseFontBytes(), { subset: true });
  } else {
    f = await doc.embedFont(StandardFonts.Helvetica);
  }
  for (const p of pages) {
    const page = doc.addPage([p.width ?? 595, p.height ?? 842]);
    for (const t of p.texts) page.drawText(t.text, { x: t.x, y: t.y, size: t.size ?? 12, font: f });
  }
  return doc.save({ useObjectStreams: false });
}

/** 標準フォント（Helvetica、非埋め込み）で書いた PDF。 */
export const latinPdf = (pages: SynthPage[]) => build(pages, "latin");
/** Noto Sans JP を埋め込んだ日本語 PDF。 */
export const japanesePdf = (pages: SynthPage[]) => build(pages, "japanese");

/** 行を上から順に一定間隔で並べたページを作る。 */
export function linesPage(lines: string[], opts: { x?: number; top?: number; leading?: number; size?: number } = {}): SynthPage {
  const { x = 72, top = 770, leading = 20, size = 12 } = opts;
  return { texts: lines.map((text, i) => ({ text, x, y: top - i * leading, size })) };
}

/** 文字幅の計算用（配置をテスト側で組み立てるときに使う）。 */
export async function measure(font: "latin" | "japanese"): Promise<(text: string, size: number) => number> {
  const doc = await PDFDocument.create();
  let f: PDFFont;
  if (font === "japanese") {
    doc.registerFontkit(fontkit);
    f = await doc.embedFont(await japaneseFontBytes(), { subset: true });
  } else {
    f = await doc.embedFont(StandardFonts.Helvetica);
  }
  return (text, size) => f.widthOfTextAtSize(text, size);
}

/**
 * フォントを埋め込まず、定義済み CMap（UniJIS-UCS2-H）と Adobe-Japan1 の CID フォント名だけを指定した PDF。
 * 古い Acrobat / Word 出力の日本語 PDF に多い形で、pdfjs は CMap データが無いと本文を復元できない。
 * text は UCS-2 で表せる文字だけを使うこと。
 */
export async function predefinedCMapPdf(lines: string[], opts: { vertical?: boolean } = {}): Promise<Uint8Array> {
  const cmap = opts.vertical ? "UniJIS-UCS2-V" : "UniJIS-UCS2-H";
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const descriptor = ctx.register(
    ctx.obj({
      Type: "FontDescriptor",
      FontName: "KozMinPr6N-Regular",
      Flags: 6,
      FontBBox: [-437, -340, 1147, 1317],
      ItalicAngle: 0,
      Ascent: 1317,
      Descent: -349,
      CapHeight: 742,
      StemV: 80,
    }),
  );
  const cidFont = ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "CIDFontType0",
      BaseFont: "KozMinPr6N-Regular",
      CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Japan1"), Supplement: 6 },
      FontDescriptor: descriptor,
      DW: 1000,
    }),
  );
  const type0 = ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: `KozMinPr6N-Regular-${cmap}`,
      Encoding: cmap,
      DescendantFonts: [cidFont],
    }),
  );

  const page: PDFPage = doc.addPage([595, 842]);
  page.node.setFontDictionary(PDFName.of("F1"), type0);
  lines.forEach((line, i) => {
    page.pushOperators(
      beginText(),
      setFontAndSize("F1", 12),
      // 縦書きは右の列から左へ、横書きは上の行から下へ
      opts.vertical ? moveText(500 - i * 20, 770) : moveText(72, 770 - i * 20),
      showText(PDFHexString.of(ucs2Hex(line))),
      endText(),
    );
  });
  return doc.save({ useObjectStreams: false });
}

function ucs2Hex(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) throw new Error(`UCS-2 で表せない文字: ${ch}`);
    out += cp.toString(16).padStart(4, "0");
  }
  return out;
}
