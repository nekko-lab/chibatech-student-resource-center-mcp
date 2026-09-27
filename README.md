# 学生資料室 MCP（非公式）

千葉工業大学「学生資料室」ポータルを AI から使えるようにする MCP サーバです。
大学の公式ツールではありません。大学とは関係がありません。

## できること

- 入学年度と学科から、自分の学科の資料ページを開く
- 進級・卒業要件や学生便覧の該当ページを読む
- 学年暦・バスの時刻・クラス担任を調べる
- 申請書・マニュアル・欠席届の様式を探す
- 問い合わせ先を探す

答えには出典（資料名とページ）が付きます。正式な手続きは原本で確認してください。

## インストール

[Releases](https://github.com/nekko-lab/chibatech-student-resource-center-mcp/releases/latest) から、使うアプリに合うファイルを取得します。Node などの実行環境は要りません。

**Claude Desktop（macOS / Windows）**: `.mcpb` をダブルクリックしてインストールします。macOS は Apple シリコン（M1 以降）のみ対応です。

**Claude Code**: OS に合う単体バイナリを置き、登録します。

```sh
claude mcp add --scope user chibatech-src -- /path/to/<バイナリ>
```

**Codex**: `~/.codex/config.toml` に書きます。

```toml
[mcp_servers.chibatech-src]
command = "/path/to/<バイナリ>"
```

ブラウザは Chrome か Edge を使います。どちらも無い場合は、初回に一度だけ自動でダウンロードします（約 120 MB）。

署名が無いため、初回に OS の警告が出ることがあります。macOS は「システム設定 → プライバシーとセキュリティ」の「このまま開く」、Windows は「詳細情報」→「実行」で許可します。

## 注意

- 使うとあなたの PC から学生資料室ポータルへアクセスします。大学のサイトポリシーに従い、自分の閲覧のためだけに使ってください。
- 取得した資料を他の人に配ったり、公開したりしないでください。

## 開発

- [開発手順](docs/development.md)
- [チームの開発運用](docs/team-workflow.md)

## ライセンス

[MIT](LICENSE)（ネットワークコンテンツ研究会 (Nekko Lab)）
