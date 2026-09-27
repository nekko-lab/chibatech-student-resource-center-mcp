# PoC: Bun 単一バイナリ × playwright-core の成立性検証（非公式）

> **非公式ツールです。** 千葉工業大学および「学生資料室」ポータルの運営者とは関係ありません。
> このディレクトリは、配布形態を決めるための成立性検証（PoC）です。製品の本実装ではありません。
>
> 手元の Claude Desktop / Claude Code / Codex で試す手順は [QUICKSTART.md](QUICKSTART.md) にあります。

## 何を確かめたか

TypeScript + playwright-core で書いた MCP サーバ（stdio）を `bun build --compile` で単一バイナリにし、
**Node などの実行環境を学生の PC に入れずに** macOS（arm64 / x64）・Windows x64・Linux x64 で動くかどうか。

サーバが持つツールは検証に必要な 3 つだけです。

| ツール | 内容 |
|---|---|
| `portal_search` | ホームで区分・入学年度・学科を実際に選んで検索し、遷移先 URL と節の数を返す |
| `portal_list_sections` | 現在の学科ページの節の数と、各節の PDF リンクを返す |
| `document_read_text` | PDF を `page.request` で取得し、pdfjs で指定ページの本文を抽出して、文字数と先頭 40 文字を返す |

ブラウザは channel `chrome` → `msedge` → Playwright の Chromium headless shell（初回にダウンロード）の順に試し、
どの経路で起動したかを結果に含めます。

## 結果（bun 1.4.2 / playwright-core 1.63.0 / @modelcontextprotocol/sdk 1.30.1 / pdfjs-dist 6.3.289）

| 対象 | 起動・tools/list | ブラウザ経路 | portal_search | document_read_text | サイズ | initialize まで |
|---|---|---|---|---|---|---|
| linux-arm64（Docker） | 成功 | download | 成功 | 成功 | 87.2 MB | 約 170 ms |
| linux-x64（Docker / ubuntu-latest） | 成功 | chrome, download | 成功 | 成功 | 87.3 MB | 約 360 ms |
| darwin-arm64（macos-latest） | 成功 | chrome, msedge, download | 成功 | 成功 | 68.2 MB | 約 240 ms |
| darwin-x64（macos-15-intel） | 成功 | chrome, msedge, download | 成功 | 成功 | 75.3 MB | 約 700 ms |
| windows-x64（windows-latest） | 成功 | chrome, msedge, download | 成功 | 成功 | 92.0 MB | 約 450 ms |

- 初回のブラウザ用意（ダウンロードと展開を含む）は 3〜9 秒で、ダウンロード後は 0.05〜0.2 秒。
- ダウンロードするのは Chrome Headless Shell（zip 約 120 MB、展開後 200〜280 MB）。置き場所は Playwright と同じ
  `ms-playwright` キャッシュ（Linux `~/.cache`、macOS `~/Library/Caches`、Windows `%LOCALAPPDATA%`）です。
- 判定はすべて事実の確認（遷移先 URL・節数・ページ数・文字数・日本語を含むか）にとどめています。

## 既知のリスクと対処

1. **Chromium との pipe 通信（`--remote-debugging-pipe`）**: Bun の子プロセスで問題なく動く。対処は不要。
2. **playwright-core のブラウザ導入（registry.install）**: 内部で `oopBrowserDownload.js` を fork する。
   単一バイナリの中では fork すると **バイナリ自身** が起動されるため、そのままでは子が MCP サーバとして立ち上がり、
   親が永久に待つ。`src/launcher.ts` で argv を見て Playwright のダウンロード処理に振り分けて解決した。
   想定外の IPC 付き起動は `process.send` の有無で見分けて終了させる（Bun の fork は `NODE_CHANNEL_FD` を設定しない）。
   それでも失敗した場合は、`browsers.json` の版から CDN の URL を組み立て、自前で取得して展開する（`src/install.ts`）。
3. **playwright-core が package.json / browsers.json を実行時のパスで読む**: バンドルするとビルド機の絶対パスが
   埋め込まれ、別の機械では起動できない（ビルドした機械の上では通ってしまう）。
   `scripts/build.ts` の Bun プラグインで静的な `require` に書き換えて解決した。置換が 1 件ずつ当たらないときはビルドを止める。
   無加工版（`*-nopatch`）が失敗することは `container-check.sh risk3` で毎回確かめている。
4. **MCP SDK の stdio と pdfjs**: どちらも動く。pdfjs は worker を静的に取り込んで `globalThis.pdfjsWorker` に置いている
   （worker は使わない）。playwright の進捗表示が JSON-RPC を壊さないよう、stdout は MCP の transport だけが使う。

## 再現手順

すべて Docker の中で行います（ホストに bun / node / ブラウザは要りません）。

```sh
# 全ターゲットのビルドと、bun / node を含まない Debian の実行イメージ
docker build -f poc/Dockerfile --target runtime -t bunpoc poc
docker build -f poc/Dockerfile --target runtime --platform linux/amd64 -t bunpoc-amd64 poc

# 実行環境に bun / node が無いことの確認
docker run --rm -v "$PWD/poc/scripts:/scripts:ro" bunpoc sh /scripts/container-check.sh env

# 既知リスク 3 の再現（無加工バンドルは起動に失敗する）
docker run --rm -v "$PWD/poc/scripts:/scripts:ro" bunpoc sh /scripts/container-check.sh risk3

# スモーク 2 回（初回ダウンロード込み / ダウンロード済み）
docker run --rm -e CSRC_DISABLE_CHANNELS=1 -v "$PWD/poc/scripts:/scripts:ro" bunpoc sh /scripts/container-check.sh twice

# ビルド物を取り出す（poc/out は gitignore 済み）
id=$(docker create bunpoc-build) && docker cp "$id:/poc/out" poc/out && docker rm "$id"
```

macOS / Windows は `.github/workflows/bun-poc.yaml` で確かめています（PoC のファイルを変えた PR と手動実行のみ）。
ubuntu でクロスコンパイルし、各 OS のランナーで chrome / msedge / ダウンロードの各経路をスモークします。

### 環境変数（検証用）

| 変数 | 意味 |
|---|---|
| `CSRC_DISABLE_CHANNELS=1` | chrome / msedge を試さず、ダウンロード経路に直行する |
| `CSRC_CHANNELS=msedge` | 試す channel の並び（既定 `chrome,msedge`） |
| `CSRC_INSTALL_MODE` | `auto`（既定。registry を試し、失敗したら custom）/ `registry` / `custom` |
| `CSRC_DISABLE_OOP_DISPATCH=1` | リスク 2 の対処を切る（registry が失敗して custom に落ちることの確認用） |
| `PLAYWRIGHT_BROWSERS_PATH` | ブラウザの置き場所（Playwright と同じ意味） |
| `SMOKE_EXPECT_VIA` | スモークで期待する起動経路（`chrome` / `msedge` / `download`） |

## サイトへの配慮

- サイトのコンテンツ（HTML・PDF・本文・スクリーンショット）は、リポジトリにも CI の artifact にも含めません。
  スモークの出力は URL のパス・件数・文字数・所要時間だけで、本文は出しません。
- User-Agent にツール名とこのリポジトリの URL を載せ、非公式であることも示します。
- 解析系（googletagmanager.com など）への要求と、画像・フォント・メディアの取得は止めています。
  1 回のスモークでのアクセスは、ページ遷移 2 回と PDF 1 件（およびそのページの JS / CSS）です。
- viewport は 1024x768 に固定しています（幅 737px 未満ではスマホ版になり、アコーディオンが閉じるため）。

## 既知の制約・未決事項

- **署名なし**: macOS の公証と Windows の署名はありません。ブラウザでダウンロードすると Gatekeeper / SmartScreen の警告が出ます（CI では quarantine 属性が付かないため未検証）。
- **mcpb はアーキテクチャを区別できない**: `compatibility.platforms` は OS 単位なので、darwin arm64 / x64 は現状 mcpb を別ファイルにしています。
- **古い CPU**: `bun-*-x64` は新しい CPU 向けのビルドです。古い x64 PC に対応するなら `-baseline` 版が要ります。
- **custom ダウンロードの検証範囲**: Linux でのみ確かめています。他の OS では registry 経路が成功したため、custom 経路は通っていません。
- **サイズ**: バイナリは 68〜92 MB（Bun ランタイムを同梱するため）、mcpb は 27〜41 MB です。
- **ブラウザの共有と削除**: registry 経路で入れたブラウザは他の Playwright と共有されます。他の Playwright が後片付けで削除した場合は、次回起動時に再びダウンロードします。
