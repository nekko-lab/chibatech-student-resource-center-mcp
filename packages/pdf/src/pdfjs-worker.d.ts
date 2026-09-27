// pdfjs-dist の worker ビルドには型定義が無い。メインスレッドで動かすために読み込むだけなので最小限の宣言を置く。
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
