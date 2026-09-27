// playwright-core 1.63.0 の内部モジュールのうち、このパッケージが使う部分だけの型。
// どちらも package.json の exports に載っている公開パスだが、型定義は同梱されていない（内部 API）。
// 使う側のソースから /// <reference path> で参照する（他のワークスペースの型検査でも解決させるため）。

declare module "playwright-core/lib/coreBundle" {
  export interface PlaywrightExecutable {
    name: string;
    directory: string | undefined;
    executablePath(sdkLanguage?: string): string | undefined;
    revision?: string;
    browserVersion?: string;
    downloadURLs?: string[];
  }

  export const registry: {
    /** PLAYWRIGHT_BROWSERS_PATH から読み込み時に 1 回だけ決まる置き場所。 */
    readonly registryDirectory: string;
    /** registry.install が fork した子（oopBrowserDownload.js）の本体。IPC でダウンロード指示を待つ。 */
    runOopDownloadBrowserMain(): void;
    readonly registry: {
      findExecutable(name: string): PlaywrightExecutable | undefined;
      install(executables: PlaywrightExecutable[], options?: { force?: boolean; gc?: boolean }): Promise<void>;
    };
  };
}

declare module "playwright-core/lib/utilsBundle" {
  import type { Readable } from "node:stream";

  export interface YauzlEntry {
    fileName: string;
    externalFileAttributes: number;
  }
  export interface YauzlZipFile {
    on(event: "entry", listener: (entry: YauzlEntry) => void): this;
    on(event: "end" | "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    readEntry(): void;
    openReadStream(entry: YauzlEntry, callback: (error: Error | null, stream: Readable) => void): void;
    close(): void;
  }
  export const yauzl: {
    open(path: string, options: { lazyEntries: boolean }, callback: (error: Error | null, zip: YauzlZipFile) => void): void;
  };

  export const yazl: {
    ZipFile: new () => {
      addBuffer(buffer: Buffer, metadataPath: string, options?: { mode?: number }): void;
      end(): void;
      outputStream: Readable;
    };
  };
}
