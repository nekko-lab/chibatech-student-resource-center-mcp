# Quickstart: PoC の mcpb を試す（非公式）

> **非公式ツールです。** 千葉工業大学および「学生資料室」ポータルの運営者とは関係ありません。
> 使うと、あなたの PC から学生資料室ポータルへアクセスします。大学のサイトポリシーに同意したうえで、私的な閲覧の範囲で使ってください。

これは配布形態を確かめるための **PoC** です。製品版ではありません。ツールは次の 3 つだけです。

| ツール | できること | 返すもの |
|---|---|---|
| `portal_search` | 区分・入学年度・学科コードでポータルを検索する | 学科ページの URL と節の数 |
| `portal_list_sections` | いま開いている学科ページの節と PDF リンクを並べる | 節ごとのリンク |
| `document_read_text` | PDF の 1 ページから本文を取り出す | **文字数と先頭 40 文字だけ**（本文全体は返さない） |

進級要件の中身を読んで答える、といった使い方は製品版（マクロスキル）で対応します。PoC で確かめられるのは「インストールできる」「ブラウザが起動する」「ポータルを操作できる」「PDF から日本語を取り出せる」の 4 点です。

## 1. mcpb を入手する

mcpb は CI（`.github/workflows/bun-poc.yaml`）の成果物として置かれ、**3 日で消えます**。GitHub CLI（`gh`）で取得します。

```sh
# 最後に成功した PoC の CI を探す
RUN=$(gh run list -R nekko-lab/chibatech-student-resource-center-mcp --workflow bun-poc.yaml --status success -L 1 --json databaseId --jq '.[0].databaseId')

# mcpb をまとめて取得する（5 ファイル・約 175 MB）
gh run download "$RUN" -R nekko-lab/chibatech-student-resource-center-mcp -n mcpb -D ~/Downloads/csrc-poc
```

成果物が期限切れのときは、Actions のページから `bun-poc` を手動実行（Run workflow）すると作り直せます。1 回の実行で、ポータルへ十数回のアクセスが発生します。

自分の PC に合うファイルを選びます。

| PC | ファイル | 確かめ方 |
|---|---|---|
| Mac（Apple シリコン: M1〜） | `csrc-poc-darwin-arm64.mcpb` | ターミナルで `uname -m` → `arm64` |
| Mac（Intel） | `csrc-poc-darwin-x64.mcpb` | `uname -m` → `x86_64` |
| Windows | `csrc-poc-windows-x64.mcpb` | 設定 → システム → バージョン情報 →「x64 ベース」 |
| Linux（x64） | `csrc-poc-linux-x64.mcpb` | `uname -m` → `x86_64` |
| Linux（arm64） | `csrc-poc-linux-arm64.mcpb` | `uname -m` → `aarch64` |

## 2. クライアントに入れる

### Claude Desktop

1. 選んだ `.mcpb` をダブルクリックするか、Claude Desktop のウィンドウにドラッグ＆ドロップします。
2. 確認画面に「千葉工業大学 学生資料室 MCP（非公式・PoC）」と出るので、インストールします。
3. 設定の拡張機能の一覧で有効になっていることを確かめます。

### Claude Code

Claude Code には `.mcpb` を直接渡せないので、中のバイナリを取り出して登録します。`.mcpb` の中身は zip で、バイナリは OS を問わず `server/csrc-poc-server`（Windows は `server/csrc-poc-server.exe`）です。下の例は Apple シリコンの Mac の場合で、ほかの PC ではファイル名の `darwin-arm64` を読み替えてください。

macOS / Linux:

```sh
mkdir -p ~/.local/share/csrc-poc
unzip -j -o ~/Downloads/csrc-poc/csrc-poc-darwin-arm64.mcpb 'server/*' -d ~/.local/share/csrc-poc
claude mcp add --scope user chibatech-src-poc -- ~/.local/share/csrc-poc/csrc-poc-server
```

Windows（PowerShell）:

```powershell
Copy-Item "$HOME\Downloads\csrc-poc\csrc-poc-windows-x64.mcpb" "$env:TEMP\csrc-poc.zip"
Expand-Archive "$env:TEMP\csrc-poc.zip" -DestinationPath "$env:LOCALAPPDATA\csrc-poc" -Force
claude mcp add --scope user chibatech-src-poc -- "$env:LOCALAPPDATA\csrc-poc\server\csrc-poc-server.exe"
```

`claude mcp list` に `chibatech-src-poc` が出て、接続できていれば完了です。

### Codex（CLI・IDE 拡張）

Claude Code と同じくバイナリを取り出し、`~/.codex/config.toml` に書きます。CLI と IDE 拡張はこの設定を共有します。

```toml
[mcp_servers.chibatech-src-poc]
command = "/Users/<あなた>/.local/share/csrc-poc/csrc-poc-server"
```

Windows では `command = 'C:\Users\<あなた>\AppData\Local\csrc-poc\server\csrc-poc-server.exe'` のように書きます。

## 3. 試す

チャットで次のように頼みます。

1. 「学生資料室で、学部生・2026 年度入学・学科コード G1 の学科ページを検索して」
   → `portal_search` が学科ページの URL（`…/iis/computer_2026.html`）と節の数を返します。
2. 「そのページの節と PDF のリンクを一覧にして」
   → `portal_list_sections` が節ごとのリンクを返します。
3. 「進級要件の PDF の 7 ページ目を読んで」
   → `document_read_text` が文字数と先頭 40 文字を返します。日本語が出れば PDF の読み取りは成功です。

初回の呼び出しでブラウザを用意します。Chrome か Edge が入っていればそれを使い、どちらも無ければ Chrome Headless Shell（約 120 MB）を一度だけダウンロードします（3〜9 秒）。

## 4. うまくいかないとき

| 症状 | 対処 |
|---|---|
| macOS で「開発元を確認できないため開けません」と出る | `gh` で取得した場合は quarantine 属性が付かないので、通常は出ません。ブラウザで落としたときに出ます。バイナリは ad-hoc 署名だけで、公証はありません。「システム設定 → プライバシーとセキュリティ」の下に出る「このまま開く」を押してから、もう一度試します（macOS 15 以降は、Finder の右クリック →「開く」では許可できません） |
| Windows で「Windows によって PC が保護されました」と出る | 「詳細情報」→「実行」を押します |
| 最初の呼び出しだけ時間がかかる / タイムアウトする | ブラウザのダウンロード中です。少し待ってからもう一度頼みます |
| Chrome ではなく Edge で試したい | 環境変数 `CSRC_CHANNELS=msedge` を付けて起動します（Claude Code: `claude mcp add ... -e CSRC_CHANNELS=msedge -- <パス>`） |
| 「LAYOUT_CHANGED」のようなエラーになる | ポータルの構造が変わった可能性があります。Issue で知らせてください |

## 5. 片付け

- Claude Desktop: 設定の拡張機能の一覧からアンインストールします。
- Claude Code: `claude mcp remove --scope user chibatech-src-poc` を実行し、`~/.local/share/csrc-poc` を削除します。
- Codex: `config.toml` の `[mcp_servers.chibatech-src-poc]` を消し、取り出したバイナリを削除します。
- ダウンロードしたブラウザ: Playwright の共有キャッシュ `ms-playwright`（macOS `~/Library/Caches/ms-playwright`、Windows `%LOCALAPPDATA%\ms-playwright`、Linux `~/.cache/ms-playwright`）にあります。他に Playwright を使っていなければ、フォルダごと消してかまいません。
