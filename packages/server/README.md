# @chibatech-src/server

千葉工業大学「学生資料室」ポータル（ログイン不要の公開ページ）を操作する、**非公式**の MCP サーバ（stdio）です。
大学とは関係がなく、大学が提供・保証するものではありません。回答の内容は、必ず原本（学生資料室に掲載された資料）で確認してください。

学生の PC で stdio の MCP サーバとして動き、Claude Desktop（mcpb）・Claude Code・Codex から使うことを想定しています。
単一バイナリ・mcpb のビルドは `tools/build` が受け持ちます。

## 使い方（組み込み）

```ts
import { chromium } from "playwright-core";
import { USER_AGENT, depsFromEnv, runStdio } from "@chibatech-src/server";

await runStdio({
  ...depsFromEnv(process.env),
  userAgent: USER_AGENT,
  getBrowser: async () => ({ browser: await chromium.launch(), via: "chromium" }), // 最初のツール呼び出しで 1 回だけ呼ばれる
});
```

| API | 内容 |
|---|---|
| `createServer(deps)` | ツールを登録した `McpServer` を返す（transport はつながない） |
| `runStdio(deps)` | stdio transport で起動する。stdin が閉じるか SIGINT / SIGTERM を受けたら、ブラウザを閉じて終わる |
| `toolDefinitions()` | ツールの名前と説明の一覧。サーバもブラウザも起動しない（mcpb manifest の生成用） |
| `depsFromEnv(env)` | 環境変数から既定値（プロフィール・保存先・キャッシュ）を読む |
| `USER_AGENT` | サイトへ送る User-Agent（ツール名・版・「unofficial」・リポジトリの URL） |

`ServerDeps` の項目は次のとおりです。

| 項目 | 内容 |
|---|---|
| `getBrowser` | ブラウザを用意する関数。最初のツール呼び出しで 1 回だけ呼ぶ（失敗・切断したら次の呼び出しで呼び直す） |
| `userAgent` | User-Agent |
| `cacheDir` | PDF キャッシュの置き場所。未指定ならメモリ |
| `downloadDir` | `document_download` の保存先 |
| `profile` | 学生の既定プロフィール（区分・入学年度・学科）。ツールの引数が優先する |
| `baseUrl` | ポータルのベース URL（既定は `@chibatech-src/portal` の `DEFAULT_BASE_URL`） |
| `now` | 現在時刻（バスの曜日区分・相対的な年度の解決に使う） |
| `log` | 診断の出力先（既定は stderr） |
| `fetcher` | PDF・文書の取得の差し替え口（テスト用）。既定はブラウザのコンテキストの `context.request` |

## 環境変数

mcpb の `user_config` は、次の環境変数に写される想定です。読めない値は起動を止めずに無視します（理由を stderr に出します）。

| 変数 | 内容 |
|---|---|
| `CSRC_STUDENT_TYPE` | 区分。`undergrad` / `graduate`（「学部生」「院生」「M1」などの日本語も可） |
| `CSRC_ADMISSION_YEAR` | 入学年度（`2024`、`R6`、`令和6年` なども可） |
| `CSRC_DEPARTMENT` | 学科・専攻のコードか名称 |
| `CSRC_DOWNLOAD_DIR` | `document_download` と `get_absence_form`（save）の保存先 |
| `CSRC_CACHE_DIR` | PDF キャッシュの置き場所（未指定ならメモリ） |

## ツール

### アトミックツール

サーバが持つ 1 枚のページの上で、1 段ずつ操作します（ホームの検索フォームなど、状態を持つ操作に使います）。

| ツール | 内容 |
|---|---|
| `portal_open_home` | ホームを開き、NEWS とクイックリンクを返す |
| `portal_open_quick_link` | クイックリンクを名前で開く。HTML だけ遷移し、PDF・学外サイトは URL を返す |
| `portal_back` | 1 つ前のページに戻る |
| `portal_select_student_type` | 区分（学部生 / 大学院生）を選ぶ |
| `portal_select_year` | 入学年度を選び、選べる学科・専攻を返す |
| `portal_select_department` | 学科・専攻をコードか名称で選ぶ（曖昧なら候補を返す） |
| `portal_submit_search` | 検索して学科・研究科ページへ移る |
| `portal_list_news` | NEWS を返す |
| `portal_list_sections` | 学科・研究科ページの節と項目を返す |
| `portal_list_documents` | 共通ページの文書一覧（manual / absence / class_guide / handbook / links） |
| `portal_list_faq` | Q&A を返す |
| `portal_list_contacts` | お問合せ先を返す |
| `portal_snapshot` | いまのページの ARIA スナップショット（切り詰めあり） |
| `document_read_text` | PDF の本文を指定したページ範囲だけ返す（上限を超えたら `next` に続きの指定） |
| `document_download` | 文書を保存先に保存し、パスを返す |

### マクロスキル

学生の質問を起点に部品を組み合わせます。状態を持つページを汚さないよう、使い捨てのページで動きます。
区分・入学年度・学科を省略すると、プロフィールを使います。

| ツール | 入力 | 内容 |
|---|---|---|
| `find_department_page` | 区分・年度・学科 | 学科（研究科）ページを探し、節と項目の一覧を返す |
| `lookup_requirements` | 種類（進級 / 卒業 / 教育課程）・年度・学科 | 該当項目のページ範囲だけを読む（進級・卒業はその語を含むページに絞る） |
| `lookup_handbook_topic` | 話題・年度・学科 | 話題に当たる項目のページだけを読む |
| `get_academic_calendar` | 知りたいこと（任意） | クイックリンクの学年暦を読み、関係するページを返す |
| `get_bus_schedule` | 出発地・曜日区分（任意）・時刻（任意）・件数（任意） | 次の便を返す。曜日区分を省略すると日付から平日・土曜・日曜を決める（祝日は判定しないので、祝日なら `holiday` を指定する） |
| `find_class_teacher` | 学科・年次（任意） | 担任表から、該当する学科・年次の行だけを返す |
| `find_manual` | キーワード | 各種申請書・マニュアルから探し、URL と要ログインかを返す |
| `get_absence_form` | 区分・様式名（任意）・保存するか | 欠席届などの様式の URL を返す（保存するなら保存先のパスも） |
| `find_contact` | 用件 | Q&A とお問合せ先を探し、部署・場所・電話・受付時間を返す |

## 応答の約束

すべてのツールが、同じ形の JSON を返します。

- **出典**: `sources` に、資料名・URL・ページ番号・`Last-Modified` を付けます。サーバが送らなかった値は `null` です。
- **非公式の注記**: セッションで最初の応答に 1 回だけ、非公式であり大学の公式情報ではないこと、正式な手続きは原本で確認することを付けます。
- **聞き返し**: 学科名・年度などが曖昧、または足りないときは、`status: "needs_clarification"` と `candidates` を返します。エラーではありません。
- **エラー**: `status: "error"` と `error: { code, message, details }` を返します（`isError: true`）。
  `code` は `VALIDATION` / `NOT_FOUND` / `LAYOUT_CHANGED` / `NAVIGATION`（`@chibatech-src/portal` と同じ）、PDF の取得失敗は `FETCH`、それ以外は `INTERNAL` です。
- **構造の変化**: `LAYOUT_CHANGED` のときは推測で補わず、`hint` にその旨を添えます。表として読めない PDF（バスダイヤ・担任表）も `LAYOUT_CHANGED` にします。
- **本文は必要な分だけ**: 質問に関係するページだけを返し、PDF をまるごとは返しません。1 回あたり最大 8 ページ・12,000 文字です。超えたら `next` に続きの指定（`from` / `to` / `charOffset`）を返します。

## 動作の決まり

- stdout は MCP の transport 専用です。`process.stdout.write` と `console.log` は stderr に向けます（pdfjs などの出力が JSON-RPC を壊さないようにするため）。
- ブラウザは 1 プロセスに 1 つ、コンテキストも 1 つです（viewport 1024x768・ja-JP・User-Agent）。解析タグへの要求は止めます。
- ツールの実行は直列です。
- PDF の取得には、ブラウザのコンテキストの `request` を使います（Cookie やプロキシ設定をブラウザと共有するため）。条件付き GET とキャッシュを使い、同じホストへの要求は 1 秒以上空けます。
- 取得するのはポータルと同じホストの URL だけです。
- マクロが読んだポータルの一覧（学科の選択肢・学科ページ・クイックリンク・文書一覧・Q&A）は 10 分間覚えておき、サイトへの要求を減らします。

## 開発

実行はすべて Docker の中で行います。ホストに node・bun・ブラウザを入れないでください。

```sh
scripts/test.sh packages/server   # ルートから。Docker の中で型検査とテスト
```

- MCP SDK の in-memory transport でクライアントとサーバをつなぎ、`tools/list` と各ツールを呼んでいます。
  ブラウザはテストイメージ同梱の Chromium を使い、サイトは `@chibatech-src/portal/testing` の合成サイトです。
- マクロは、ポータル操作と PDF 読み取りの口（`PortalPort` / `DocPort`）に合成データを差し込んで単体テストしています。
  バスダイヤ・担任表の座標データは、テストの中で合成しています（地名・氏名・時刻はすべて架空）。
- stdout に transport 以外が出ないことは、子プロセスで `runStdio` を起動して確かめています。
- 大学のポリシーにより、サイトのコンテンツ（PDF・HTML・本文・実在の教員名・実際の時刻）はリポジトリに入れません。テストはサイトにアクセスしません。
