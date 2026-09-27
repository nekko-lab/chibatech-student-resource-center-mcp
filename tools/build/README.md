# @chibatech-src/build

千葉工業大学「学生資料室」ポータル向け **非公式** MCP サーバを、学生の PC に追加の実行環境なしで配るためのビルドスクリプトです。大学の公式ツールではありません。

`bun build --compile` の単一バイナリと mcpb（binary 型）を作ります。実行は Bun で、ビルド用の Docker イメージ（`docker/build.Dockerfile`）の中で行います。純粋な部分は Node の vitest でテストします。

## 出力

| パス | 内容 |
|---|---|
| `<out>/bin/<名前>-darwin-arm64` | macOS（Apple シリコン、M1 以降。Intel Mac は対象外） |
| `<out>/bin/<名前>-windows-x64.exe` | Windows x64 |
| `<out>/bin/<名前>-linux-x64`、`-linux-arm64` | Linux |
| `<out>/mcpb/<名前>-<version>.mcpb` | Claude Desktop 用。macOS と Windows の共通 1 つ |
| `<out>/THIRD_PARTY_NOTICES.txt` | 同梱しているソフトウェアのライセンス本文と著作権表示（ビルドのたびに生成。コミットしない） |
| `<out>/LICENSE` | リポジトリの `LICENSE`（MIT）の写し。リポジトリに無ければ警告して省く |
| `<out>/SHA256SUMS` | 上のすべてのハッシュ（`cd <out> && sha256sum -c SHA256SUMS`） |
| `<out>/build-report.json` | ターゲットごとのサイズ、埋め込んだ資産の一覧とサイズ、playwright-core と版の書き換え、ライセンス表記の節 |

`<名前>` の既定は `chibatech-src-mcp` です。

## 使い方

```sh
# 全ターゲット（既定の 4 つと mcpb）をビルドして取り出す
docker build -f docker/build.Dockerfile --target artifacts --output type=local,dest=out/build .

# 入口・版などを変える
docker build -f docker/build.Dockerfile --target artifacts --output type=local,dest=out/build \
  --build-arg ENTRY=packages/server/src/main.ts --build-arg TOOLS=<tools.json> \
  --build-arg VERSION=0.1.0 --build-arg "BUILD_ARGS=--baseline" .

# mcpb を公式 CLI（@anthropic-ai/mcpb）で検査する
docker build -f docker/build.Dockerfile --target mcpb-validate .

# bun も node も無い Debian で起動確認（ネットワーク無し。ツールは呼ばない）
docker build -f docker/build.Dockerfile --target runtime -t csrc-build-runtime .
docker run --rm --network none -e PROBE_EXPECT_VERSION=0.1.0 csrc-build-runtime \
  sh /opt/csrc/scripts/mcp-probe.sh /opt/csrc/dist/bin/chibatech-src-mcp-linux-arm64 /opt/csrc/tools.json
docker run --rm --network none csrc-build-runtime /opt/csrc/probe/bin/csrc-cmap-probe-linux-arm64
```

イメージの中で直接実行するときは次のとおりです。

```sh
bun run tools/build/src/cli.ts --entry <file> --out <dir> --version <x.y.z> --tools <tools.json> \
  --bun-license /opt/licenses/bun/LICENSE.md [--targets a,b] [--baseline] [--name <名前>] [--no-mcpb] [--license <LICENSE>]
```

| 引数 | 意味 |
|---|---|
| `--entry` | 単一バイナリの入口。今は検証用の `poc/src/launcher.ts`（本番は `packages/server/src/main.ts`） |
| `--tools` | mcpb の `tools` に載せる JSON（`[{ "name", "description" }]`。サーバの `toolDefinitions()` の出力） |
| `--version` | SemVer（`v` を付けない）。manifest の `version` と、サーバの `VERSION`（serverInfo.version・User-Agent）になる |
| `--bun-license` | Bun の配布物のライセンス（ビルド用イメージの `/opt/licenses/bun/LICENSE.md`）。無ければ止める |
| `--license` | リポジトリのライセンス（既定 `LICENSE`）。無ければ警告して続ける |
| `--targets` | `darwin-arm64`・`windows-x64`・`linux-x64`・`linux-arm64`（既定）、`windows-x64-baseline`・`linux-x64-baseline` |
| `--baseline` | 選んだ Windows / Linux の x64 に、古い CPU 向けの `-baseline` 版を足す（既定では出さない） |
| `--no-mcpb` | mcpb を作らない（検証用のバイナリだけを作るとき） |

## 仕組み

### 入口の前に差し込む起動前処理

単一バイナリの中では pdfjs-dist の場所を引けず、日本語 PDF の本文が欠けます（PoC で学生便覧の約 12%）。`cli.ts` は、`pdfjs-dist/cmaps/`（`.bcmap`）と `standard_fonts/`（`.pfb` / `.ttf`）を `import … with { type: "file" }` で埋め込むモジュールを生成します。このモジュールは起動時に `@chibatech-src/pdf` の `setPdfAssets` へ渡します。各ファイルを読むのは、pdfjs が必要とした時点です。

生成した入口は「起動前処理 → 指定の入口」の順に import します。そのため入口側では何も import しなくてよい一方、**入口を `import.meta.main` で条件付けないでください**（生成した入口から読み込まれるので、偽になります）。

### バンドル時の書き換え

- **playwright-core:** `coreBundle.js` は package.json と browsers.json を実行時のパスで読みます。そのままバンドルするとビルド機の絶対パスが埋め込まれ、他の機械では起動できません。プラグインで静的な `require` に書き換えます。`chromium-bidi` は external です。
- **版:** `packages/server/src/version.ts` の `export const VERSION = "…"` を `--version` の値に書き換えます（ソースは変えません）。serverInfo.version と User-Agent がここから作られます。
- どちらも、置換が 1 件ずつ当たらなければビルドを止めます。当てたファイルは `build-report.json`（`playwrightCorePatched`・`versionPatched`）に残ります。

### ライセンス表記

`THIRD_PARTY_NOTICES.txt` は、バンドルの入力（Bun.build の metafile）のうち `node_modules` の中にあるパッケージについて、直下の LICENSE / NOTICE / ThirdPartyNotices の類をそのまま集めます。ほかに次を載せます。

- Bun ランタイム: Bun の配布物のライセンス（bun-v1.4.2 の `LICENSE.md`。ビルド用イメージが版とチェックサムを固定して取得）
- 埋め込んだ CMap（Adobe）と標準フォント（Foxit・Liberation）: pdfjs-dist の `cmaps/` と `standard_fonts/` のライセンスファイル

ライセンスファイルの見つからないパッケージがあれば、一覧を出してビルドを止めます。

### macOS と mcpb

- mcpb は全 OS 共通の 1 つです。`compatibility.platforms` は `["darwin", "win32"]` で、Claude Desktop に Linux 版は無いため Linux は入れません。
- macOS は `server/<名前>`（Apple シリコン用）を直接起動します。Windows は `mcp_config.platform_overrides.win32` で `server/<名前>.exe` を起動します。user_config を写した `env` は両方に書きます。
- zip のルートには `manifest.json` と並べて `THIRD_PARTY_NOTICES.txt` と `LICENSE` を入れます。manifest の `license` は `MIT` です。
- user_config は 区分（string）・入学年度（number）・学科（string）・保存先フォルダ（directory）で、すべて任意入力です。それぞれ `CSRC_STUDENT_TYPE`・`CSRC_ADMISSION_YEAR`・`CSRC_DEPARTMENT`・`CSRC_DOWNLOAD_DIR` で渡します。
- mcpb の zip にはディレクトリの項目を入れません（`zip -D`）。公式 CLI の unpack が失敗するためです。

## 検証

- `scripts/test.sh tools/build`: 対象の一覧、manifest の組み立てと検証、置換規則（固定版の playwright-core に当たるかも含む）、版の書き換え、資産の一覧、ライセンス表記の収集、引数の解釈。
- `src/probe/cmap-probe.ts`: 検証用の入口です。合成 PDF（非埋め込みの日本語フォント + UniJIS-UCS2-H）をメモリ上で作り、埋め込み資産ありでは日本語が読め、無しでは読めないことを比べます。
- `scripts/mcp-probe.sh`: サーバに `initialize` → `tools/list` を送り、tools.json のツール名がすべて返ることを確かめます。`PROBE_EXPECT_VERSION` を渡すと serverInfo.version も確かめます。ツールは呼ばないので、サイトにはアクセスしません。
- `.github/workflows/release.yaml` は、これらを ubuntu（Docker、`--network none`）と、各 OS のランナー（macOS arm64、Windows x64、Linux x64 / arm64）で実行します。macOS では `codesign -v` が valid でなければ落とします。

## リリース

- 版は SemVer です。**`main` のコミットに人が付けたタグ `vX.Y.Z` の push だけ**で Release を作ります。タグのコミットが `main` から到達できない場合と、タグ名が `v` + SemVer でない場合は失敗します。タグはワークフローから作りません。
- Release には単体バイナリ・mcpb・`SHA256SUMS`・`THIRD_PARTY_NOTICES.txt`・`LICENSE` を添付します。リリースノートは `gh release create --generate-notes`（前のタグからの PR の一覧）です。
- `main` への push と `workflow_dispatch` では、build と各 OS での確認だけを行い、artifact を残します。
- 入口と tools.json は、ワークフローの入力またはリポジトリ変数（`CSRC_RELEASE_ENTRY` / `CSRC_RELEASE_TOOLS`）で切り替えます。
- 手順の全体は [チームの開発運用](../../docs/team-workflow.md) の「5. バージョン管理とリリース」にあります。

## 既知の制約

- **署名:** macOS は Bun が付ける ad-hoc 署名のみで、公証はありません。Windows は署名がありません。ブラウザでダウンロードした場合は、初回に OS の警告が出ます。
- **対応機種:** macOS は Apple シリコン（M1 以降）のみです。Intel Mac 用のバイナリは作りません。
- **サイズ:** 単体バイナリは 70〜95 MB（Bun ランタイムを同梱するため）、mcpb は約 72 MB です。

## 大学のポリシーについて

- サイトのコンテンツ（HTML・PDF・本文）は、リポジトリにも artifact にも Release にも入れません。検証用の PDF はメモリ上で合成します。
- ビルドと検証ではサイトにアクセスしません。Release の説明にサイトへの直リンクを貼りません。
