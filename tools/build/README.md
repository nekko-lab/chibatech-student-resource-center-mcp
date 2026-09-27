# @chibatech-src/build

千葉工業大学「学生資料室」ポータル向け **非公式** MCP サーバを、学生の PC に追加の実行環境なしで配るためのビルドスクリプトです。大学の公式ツールではありません。

`bun build --compile` の単一バイナリと mcpb（binary 型）を作ります。実行は Bun で、ビルド用の Docker イメージ（`docker/build.Dockerfile`）の中で行います。純粋な部分は Node の vitest でテストします。

## 出力

| パス | 内容 |
|---|---|
| `<out>/bin/<名前>-darwin-universal` | macOS（arm64 + x64 を llvm-lipo でまとめたユニバーサルバイナリ） |
| `<out>/bin/<名前>-windows-x64.exe` | Windows x64 |
| `<out>/bin/<名前>-linux-x64`、`-linux-arm64` | Linux |
| `<out>/mcpb/<名前>-<version>.mcpb` | Claude Desktop 用。macOS と Windows の共通 1 つ |
| `<out>/SHA256SUMS` | 上の 2 種類のハッシュ（`cd <out> && sha256sum -c SHA256SUMS`） |
| `<out>/build-report.json` | コンパイルごとのサイズ、lipo の結果、埋め込んだ資産の一覧とサイズ、playwright-core の書き換え |
| `<out>/slices/` | `--keep-slices` のときだけ。lipo 前の 2 つと `launch.sh`（代替の検証用。Release には載せない） |

`<名前>` の既定は `chibatech-src-mcp` です。

## 使い方

```sh
# 全ターゲット（既定の 4 出力と mcpb）をビルドして取り出す
docker build -f docker/build.Dockerfile --target artifacts --output type=local,dest=out/build .

# 入口・版などを変える
docker build -f docker/build.Dockerfile --target artifacts --output type=local,dest=out/build \
  --build-arg ENTRY=poc/src/launcher.ts --build-arg TOOLS=tools/build/fixtures/poc-tools.json \
  --build-arg VERSION=0.1.0 --build-arg "BUILD_ARGS=--baseline" .

# mcpb を公式 CLI（@anthropic-ai/mcpb）で検査する
docker build -f docker/build.Dockerfile --target mcpb-validate .

# bun も node も無い Debian で起動確認（ネットワーク無し。ツールは呼ばない）
docker build -f docker/build.Dockerfile --target runtime -t csrc-build-runtime .
docker run --rm --network none csrc-build-runtime \
  sh /opt/csrc/scripts/mcp-probe.sh /opt/csrc/dist/bin/chibatech-src-mcp-linux-arm64 /opt/csrc/tools.json
docker run --rm --network none csrc-build-runtime /opt/csrc/probe/bin/csrc-cmap-probe-linux-arm64
```

イメージの中で直接実行するときは次のとおりです。

```sh
bun run tools/build/src/cli.ts --entry <file> --out <dir> --version <x.y.z> --tools <tools.json> \
  [--targets a,b] [--baseline] [--name <名前>] [--no-mcpb] [--darwin universal|launcher] [--keep-slices]
```

| 引数 | 意味 |
|---|---|
| `--entry` | 単一バイナリの入口。今は検証用の `poc/src/launcher.ts` |
| `--tools` | mcpb の `tools` に載せる JSON（`[{ "name", "description" }]`。サーバの `toolDefinitions()` の出力） |
| `--version` | semver（`v` を付けない） |
| `--targets` | 出力。`darwin-universal`・`windows-x64`・`linux-x64`・`linux-arm64`（既定）、`darwin-arm64`・`darwin-x64`（個別版）、`windows-x64-baseline`・`linux-x64-baseline` |
| `--baseline` | 選んだ Windows / Linux の x64 に、古い CPU 向けの `-baseline` 版を足す（既定では出さない） |
| `--darwin` | `universal`（既定。lipo でまとめる）/ `launcher`（`uname -m` で選ぶ起動スクリプト。lipo が動かないときの代替） |
| `--no-mcpb` | mcpb を作らない（検証用のバイナリだけを作るとき） |

## 仕組み

### 入口の前に差し込む起動前処理

単一バイナリの中では pdfjs-dist の場所を引けず、日本語 PDF の本文が欠けます（PoC で学生便覧の約 12%）。`cli.ts` は、`pdfjs-dist/cmaps/`（`.bcmap`）と `standard_fonts/`（`.pfb` / `.ttf`）を `import … with { type: "file" }` で埋め込むモジュールを生成します。このモジュールは起動時に `@chibatech-src/pdf` の `setPdfAssets` へ渡します。各ファイルを読むのは、pdfjs が必要とした時点です。

生成した入口は「起動前処理 → 指定の入口」の順に import します。そのため入口側では何も import しなくてよい一方、**入口を `import.meta.main` で条件付けないでください**（生成した入口から読み込まれるので、偽になります）。

### playwright-core の書き換え

`coreBundle.js` は package.json と browsers.json を実行時のパスで読みます。そのままバンドルするとビルド機の絶対パスが埋め込まれ、他の機械では起動できません。プラグインで静的な `require` に書き換えます。置換が 1 件ずつ当たらなければビルドを止めます。`chromium-bidi` は external です。

### macOS と mcpb

- mcpb は全 OS 共通の 1 つです。`compatibility.platforms` は `["darwin", "win32"]` で、Claude Desktop に Linux 版は無いため Linux は入れません。
- macOS は `server/<名前>`（ユニバーサルバイナリ）を直接起動します。Windows は `mcp_config.platform_overrides.win32` で `server/<名前>.exe` を起動します。user_config を写した `env` は両方に書きます。
- user_config は 区分（string）・入学年度（number）・学科（string）・保存先フォルダ（directory）で、すべて任意入力です。それぞれ `CSRC_STUDENT_TYPE`・`CSRC_ADMISSION_YEAR`・`CSRC_DEPARTMENT`・`CSRC_DOWNLOAD_DIR` で渡します。
- mcpb の zip にはディレクトリの項目を入れません（`zip -D`）。公式 CLI の unpack が失敗するためです。

## 検証

- `scripts/test.sh tools/build`: 対象の一覧、manifest の組み立てと検証、置換規則（固定版の playwright-core に当たるかも含む）、資産の一覧、引数の解釈。
- `src/probe/cmap-probe.ts`: 検証用の入口です。合成 PDF（非埋め込みの日本語フォント + UniJIS-UCS2-H）をメモリ上で作り、埋め込み資産ありでは日本語が読め、無しでは読めないことを比べます。
- `scripts/mcp-probe.sh`: サーバに `initialize` → `tools/list` を送り、tools.json のツール名がすべて返ることを確かめます。ツールは呼ばないので、サイトにはアクセスしません。
- `.github/workflows/release.yaml` は、これらを ubuntu（Docker、`--network none`）と、各 OS のランナー（macOS arm64 / x64、Windows、Linux x64 / arm64）で実行します。macOS では、同じユニバーサルバイナリを両方の CPU で起動し、`lipo -archs` と slice ごとの `codesign -v` を記録します。

## リリース

- `v*` のタグを push すると、ビルドと各 OS での確認のあと、`gh release create --generate-notes` で単体バイナリ・mcpb・`SHA256SUMS` を添付します。
- `workflow_dispatch` の既定は、Release を作らず artifact だけを残す動作です。`create_release` を選ぶと `v<version>` のタグと Release を作ります。
- 入口と tools.json は、ワークフローの入力またはリポジトリ変数（`CSRC_RELEASE_ENTRY` / `CSRC_RELEASE_TOOLS`）で切り替えます。

## 既知の制約

- **署名:** macOS の公証と Windows の署名はありません。Bun がクロスコンパイルした darwin-x64 には Bun 本体の署名が残っていて、`codesign -v` では無効と判定されます。lipo の前から無効です。arm64 は ad-hoc 署名で有効です。
- **サイズ:** ユニバーサルバイナリは約 147 MB です（Bun ランタイムを 2 つ含むため）。mcpb は約 103 MB です。
- **ライセンス:** 埋め込んだ CMap（Adobe）と標準フォント（Foxit、Liberation）のライセンス表記の同梱は未対応です。

## 大学のポリシーについて

- サイトのコンテンツ（HTML・PDF・本文）は、リポジトリにも artifact にも Release にも入れません。検証用の PDF はメモリ上で合成します。
- ビルドと検証ではサイトにアクセスしません。Release の説明にサイトへの直リンクを貼りません。
