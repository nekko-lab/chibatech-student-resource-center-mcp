# @chibatech-src/browser

> **非公式ツールです。** 千葉工業大学および「学生資料室」ポータルの運営者とは関係ありません。

千葉工業大学「学生資料室」ポータルを操作する非公式の MCP サーバで使う、ブラウザの調達と単一バイナリの起動振り分けです。
学生の PC に追加の実行環境を入れさせないため、手元の Chrome / Edge を優先し、どちらも無いときだけ Chrome Headless Shell を初回にダウンロードします。

## 使い方

```ts
import { acquireBrowser, optionsFromEnv, runLauncher } from "@chibatech-src/browser";

// 単一バイナリの入口。main は必ず runLauncher から呼ぶ（二重起動と、registry の fork の対策）。
await runLauncher(async () => {
  const { browser, via } = await acquireBrowser(optionsFromEnv(process.env));
  // via: "chrome" | "msedge" | "download"
});
```

## 調達の順序

1. channel `chrome`（インストール済みの Google Chrome）
2. channel `msedge`（インストール済みの Microsoft Edge）
3. Chrome Headless Shell（`download`）
   - 導入済み（`INSTALLATION_COMPLETE` と実行ファイルがある）ならそのまま使う。ダウンロードはしない
   - 無ければ `installMode` に従って導入する
     - `registry`: playwright-core の `registry.install`
     - `custom`: `browsers.json` の版から CDN の URL を組み立て、自前で取得・展開する
     - `auto`（既定）: registry を試し、失敗したら custom

試した経路と失敗理由は `log` に残ります。すべて失敗したら、経路ごとの理由（`attempts`）を持つ `BrowserUnavailableError` を投げます。

置き場所は Playwright と同じ `ms-playwright` キャッシュです（Linux `~/.cache`、macOS `~/Library/Caches`、Windows `%LOCALAPPDATA%`）。
他の Playwright と共有できます。

## 公開 API

| 名前 | 内容 |
|---|---|
| `acquireBrowser(opts?)` | ブラウザを起動して `{ browser, via, executablePath? }` を返す |
| `optionsFromEnv(env)` | 環境変数から `AcquireOptions` を作る（純関数） |
| `BrowserUnavailableError` | すべての経路が失敗したときのエラー。`attempts: { via, reason }[]` |
| `detectLaunchRole(argv, hasIpc)` | `"server"` / `"download-worker"` / `"unexpected-ipc"` を返す（純関数） |
| `runLauncher(main)` | 起動の役割で振り分け、server なら `main` を 1 回だけ呼ぶ |
| `customDownloadUrl({ browsersJson, platform, arch, hostOverride? })` | Headless Shell の zip の URL・revision・browserVersion（純関数） |
| `headlessShellLayout(...)` / `browsersDirectory(...)` | Headless Shell の置き場所（純関数。registry と同じ規則） |

### AcquireOptions

| 項目 | 既定 | 内容 |
|---|---|---|
| `channels` | `["chrome", "msedge"]` | 試す channel の並び |
| `disableChannels` | `false` | `true` なら channel を試さず、ダウンロード経路に直行する |
| `installMode` | `"auto"` | `auto` / `registry` / `custom` |
| `browsersPath` | `PLAYWRIGHT_BROWSERS_PATH`、無ければ既定のキャッシュ | ブラウザの置き場所 |
| `headless` | `true` | ダウンロード経路（Headless Shell）は常に headless |
| `launchTimeoutMs` | `60000` | 起動のタイムアウト |
| `log` | stderr | 診断の出力先。**stdout には何も書かない**（MCP の transport 専用） |

### 環境変数（`optionsFromEnv`）

| 変数 | 意味 |
|---|---|
| `CSRC_CHANNELS` | 試す channel の並び（例 `msedge`、`chrome,msedge`）。未知の名前は捨てる |
| `CSRC_DISABLE_CHANNELS=1` | channel を試さず、ダウンロード経路に直行する（`true` も可） |
| `CSRC_INSTALL_MODE` | `auto` / `registry` / `custom` |
| `PLAYWRIGHT_BROWSERS_PATH` | ブラウザの置き場所（Playwright と同じ意味。`0` は既定のキャッシュとして扱う） |

`acquireBrowser` は、custom の取得先として Playwright と同じ `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` / `PLAYWRIGHT_DOWNLOAD_HOST` も読みます。
`runLauncher` は検証用に `CSRC_DISABLE_OOP_DISPATCH=1`（下の 1 の対処を切り、registry が失敗して custom に切り替わることを確かめる）を読みます。

## 単一バイナリでの落とし穴と対処

1. **registry の fork**: `registry.install` は `oopBrowserDownload.js` を fork します。単一バイナリの中ではバイナリ自身が起動されるため、
   そのままでは子が MCP サーバとして立ち上がり、親が永久に待ちます。`runLauncher` は argv が `oopBrowserDownload.js` で終わる起動を
   `registry.runOopDownloadBrowserMain()` に振り分けます。想定外の IPC 付き起動は `process.send` の有無で判定して exit 3 で終えます
   （Bun の fork は `NODE_CHANNEL_FD` を設定しません）。
2. **main の二重起動**: bun compile では `import.meta.url` と `argv[1]` の比較が真になることがあります。`main` は `runLauncher` から 1 回だけ呼びます。
3. **stdout**: registry が `console.log` に書く進捗は `log`（stderr）に回します。失敗時に registry が立てる `process.exitCode` も元に戻します。
4. **registry の置き場所**: playwright-core の読み込み時に `PLAYWRIGHT_BROWSERS_PATH` から決まり、後から変えられません。
   `browsersPath` と一致しないときは、理由を残して custom に進みます。
5. **他の Playwright との共有**: registry の後片付け（gc）は切っています。他の Playwright が入れたブラウザを、このパッケージが消すことはありません。

## テスト

```sh
scripts/test.sh packages/browser     # Docker の中で型検査とテスト（ネットワークに出ない）
```

- 結合テストは、テストイメージ（`mcr.microsoft.com/playwright:v1.63.0-noble`）の `/ms-playwright` にあるブラウザを使い、ダウンロードせずに起動できることを確かめます。
- custom の導入は、ローカルの HTTP サーバから配った zip で確かめます。
- 実際のダウンロード（約 120 MB）を伴うテストは既定でスキップします。`NET=1` のときだけ動きます（`scripts/test.sh` は `NET` を渡さないため、イメージを直接実行します）。

  ```sh
  docker run --rm --init --ipc=host -e NET=1 chibatech-src-test npm run test -w packages/browser
  ```

- このパッケージのテストはサイトにアクセスしません。
