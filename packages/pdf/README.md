# @chibatech-src/pdf

千葉工業大学「学生資料室」ポータル向け **非公式** MCP サーバの PDF 部品です。大学の公式ツールではありません。

PDF の取得（条件付き GET とキャッシュ）、本文・文字位置の抽出、学科ページのリンクからのページ範囲の推定を受け持ちます。

## 使い方

```ts
import {
  FsPdfCache,
  extractText,
  fetchPdf,
  pageCount,
  pageRangeForItem,
  parsePdfLink,
} from "@chibatech-src/pdf";

// 学科ページのリンク（例: "../common_2026/life.pdf#page=13"）を URL とページに分ける
const links = hrefs.map((h) => parsePdfLink(h, pageUrl));
const range = pageRangeForItem(links, 3); // { from: 13, to: 15 } など。最後の項目は to 無し

const { bytes } = await fetchPdf(links[3].url, {
  fetcher, // 製品では Playwright の page.request を包んだもの
  cache: new FsPdfCache(cacheDir),
  userAgent: "…",
  minIntervalMs: 1000, // 同一ホストへの最小間隔（既定 1000ms）
});
const to = range.to ?? (await pageCount(bytes));
const pages = await extractText(bytes, { from: range.from, to }); // [{ page, text }]
```

## API

| 関数・クラス | 内容 |
|---|---|
| `parsePdfLink(href, base)` | 相対パス・`#page=N`・`?20260611_01` のようなクエリに対応します。`url` は fragment を除いた絶対 URL です |
| `pageRangeForItem(items, index)` | 同じ PDF の後続項目のうち、最初にページ番号が大きくなる項目の直前ページまでを範囲とします。page の無い項目は `from: 1` です |
| `pageCount(bytes)` | ページ数を返します |
| `extractText(bytes, { from?, to? })` | ページごとの本文を返します。範囲は PDF のページ数に切り詰めます |
| `extractItems(bytes, page)` | 文字列と座標（`x`, `y` = ページ上端からベースライン, `width`, `height`、PDF user space・scale 1）を返します |
| `fetchPdf(url, opts)` | `If-Modified-Since` / `If-None-Match` を付けて取得し、304 ならキャッシュを返します。本体が PDF でなければ `PdfFetchError` を投げます |
| `MemoryPdfCache` / `FsPdfCache(dir, fs?)` | キャッシュです。`FsPdfCache` は `<sha256(url)>.pdf` と `.json` を置きます |
| `FsAdapter` / `nodeFsAdapter()` | ファイルシステムの差し替え口です。既定の実装は `node:fs/promises` を使い、Node と Bun の両方で動きます |
| `setPdfAssets` ほか | CMap・標準フォントの供給口です（次節） |

### 本文の組み立て方

- content stream の順を保ち、y 座標が変わったところで改行します。
- 同じ行の item は x 順に並べ、間隔がフォントサイズの 0.2 倍を超えるところに空白を入れます。
- 縦書き（pdfjs の `dir === "ttb"`）は列ごとに上から下へ読みます。
- 全角空白（U+3000）は pdfjs が空白の item にするため、半角空白になります。

## CMap と標準フォント（単一バイナリで配るとき）

**日本語 PDF の多くは CMap が無いと本文が欠けたり化けたりします。** 非埋め込みの CJK フォント（UniJIS-UCS2-H など）が該当するほか、ToUnicode の無い埋め込み CID フォントでも同じことが起きます。後者では pdfjs が `Adobe-Japan1-UCS2` を使って文字を引くためです。

このパッケージは CMap を URL ではなく**バイト列**で pdfjs に渡します。既定では依存の `pdfjs-dist/cmaps/` と `standard_fonts/` から読みます。

`bun build --compile` などで作った単一バイナリでは、pdfjs-dist の場所を引けません。起動時に、埋め込んだ資産を渡してください。

```ts
import { mapPdfAssets, setPdfAssets } from "@chibatech-src/pdf";

setPdfAssets(
  mapPdfAssets({
    cMaps: { "UniJIS-UCS2-H.bcmap": bytes1, "Adobe-Japan1-UCS2.bcmap": bytes2 /* … */ },
    standardFonts: { "LiberationSans-Regular.ttf": bytes3 /* … */ },
  }),
);
// あるいは実行ファイルの隣に置いたディレクトリから読む
// setPdfAssets(dirPdfAssets({ cMaps: ".../cmaps/", standardFonts: ".../standard_fonts/" }));
```

## 開発

実行はすべて Docker の中で行います。ホストに node やパッケージは要りません。

```sh
packages/pdf/scripts/test.sh   # docker build → コンテナ内で tsc --noEmit と vitest run
```

- テスト用 PDF は pdf-lib でテスト実行時に合成します。
- 日本語フォント（Noto Sans JP、SIL Open Font License）は Dockerfile で取得し、リポジトリには入れません。

## 大学のポリシーについて

- ポータルのコンテンツ（PDF・HTML・本文）は、fixture やスナップショットを含めてリポジトリに入れません。
- 取得した PDF やキャッシュはコミットしないでください（`.gitignore` で `*.pdf` を除外しています）。
- 同一ホストへの要求は既定で 1 秒以上空けます。
