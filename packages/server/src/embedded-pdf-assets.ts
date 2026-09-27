/**
 * 単一バイナリに埋め込む pdfjs の付属データ（定義済み CMap・標準フォント）の差し込み口。
 *
 * リポジトリ上のこのファイルは「埋め込み無し」を返すだけ。単一バイナリのビルドでは、ビルドスクリプトの
 * Bun プラグインがこのモジュールを差し替え、pdfjs-dist の `cmaps/` と `standard_fonts/` のバイト列を返す。
 * undefined のときは @chibatech-src/pdf の既定（node_modules の pdfjs-dist から読む）に任せる。
 */
export interface EmbeddedPdfAssets {
  cMaps: Record<string, Uint8Array>;
  standardFonts: Record<string, Uint8Array>;
}

export function embeddedPdfAssets(): EmbeddedPdfAssets | undefined {
  return undefined;
}
