// 開発用: PDF から座標付きテキスト（PageItems[] と同じ形）を JSON で出力する。
// レイアウト観察専用。出力は gitignore 済みの .research/ かスクラッチパッドに置き、コミットしない。
// 使い方: node scripts/dump-layout.mjs <input.pdf> [output.json]
import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/dump-layout.mjs <input.pdf> [output.json]");
  process.exit(2);
}

const data = new Uint8Array(await readFile(input));
const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    items.push({
      str: it.str,
      x: it.transform[4],
      y: viewport.height - it.transform[5],
      width: it.width,
      height: it.height,
    });
  }
  pages.push({ page: p, width: viewport.width, height: viewport.height, items });
}
const json = JSON.stringify(pages, null, 1);
if (output) await writeFile(output, json);
else process.stdout.write(json);
