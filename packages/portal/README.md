# @chibatech-src/portal

千葉工業大学「学生資料室」ポータルを Playwright で操作するための**非公式**ライブラリです。大学とは関係がなく、大学が提供・保証するものではありません。

このパッケージは Playwright の `Page` を受け取り、ポータル固有の操作を 1 段ずつ行う関数群（アトミック操作）と、テスト用の合成サイトを提供します。ブラウザの起動・調達はこのパッケージの外で行います。

- 対象はログイン不要の公開ページだけです。認証が必要な外部サービス（学内専用の文書フォルダ等）には触れません。
- サイトのコンテンツ（HTML・本文・スクリプト・PDF・スクリーンショット）はリポジトリに含めません。テストはすべて自前で書いた架空の合成サイトで行います。
- 実サイトへのアクセスは最小限にしてください。解析タグは `installRoutes` で止められます。

## 使い方

```ts
import { chromium } from "playwright-core";
import {
  contextOptions,
  installRoutes,
  openHome,
  selectStudentType,
  selectYear,
  selectDepartment,
  submitSearch,
  listSections,
} from "@chibatech-src/portal";

const browser = await chromium.launch();
const context = await browser.newContext(contextOptions({ userAgent: "my-tool/1.0 (unofficial)" }));
const page = await context.newPage();
await installRoutes(page);

const home = await openHome(page);            // { url, news, quickLinks }
await selectStudentType(page, "undergrad");
const depts = await selectYear(page, 2026);   // [{ code, name }, ...]
await selectDepartment(page, depts[0]!.code);
await submitSearch(page);                     // { url, title }
const { heading, sections } = await listSections(page);
```

viewport は `contextOptions` で 1024x768 に固定します。サイトは幅 737px 未満でアコーディオンを閉じ、この境界をまたぐリサイズでページを再読込するためです。

## API

| 関数 | 内容 |
|---|---|
| `DEFAULT_BASE_URL` | ポータルのベース URL |
| `contextOptions({ userAgent })` | `browser.newContext()` に渡すオプション（viewport 1024x768・`ja-JP`） |
| `installRoutes(page)` | 解析タグ（googletagmanager.com など）への要求を止める |
| `openHome(page, { baseUrl? })` | ホームを開き、NEWS とクイックリンクを返す |
| `listNews(page)` | 開いているホームから NEWS を読む（日付は `YYYY-MM-DD`） |
| `selectStudentType(page, "undergrad" \| "graduate")` | 区分を選ぶ（年度・学科はリセットされる） |
| `selectYear(page, year)` | 入学年度を選び、学科・専攻の選択肢 `{ code, name }[]` を返す |
| `selectDepartment(page, code)` | 学科・専攻をコードで選ぶ |
| `submitSearch(page)` | 検索して学科・研究科ページへ遷移する |
| `listSections(page)` | 学科・研究科ページの節と項目（絶対 URL・PDF・ページ番号）を返す |
| `openQuickLink(page, name)` | クイックリンクを名前で開く（html だけ遷移。pdf / 外部は URL を返す） |
| `listDocuments(page, kind, { baseUrl? })` | 共通ページの文書一覧。`kind` は `manual` / `absence` / `class_guide` / `handbook` / `links` |
| `listFaq(page, { baseUrl? })` | Q&A（分類・質問・回答） |
| `listContacts(page, { baseUrl? })` | お問合せ先（分類・名称・キャンパス・電話・取扱時間・全文） |
| `snapshot(page)` | `body` の ARIA スナップショット |

### エラー

失敗は `PortalError`（`code` と `details`）で返ります。

| code | 意味 |
|---|---|
| `VALIDATION` | 入力が選択肢に無い（`details.available` に選べる値）、またはサイトが alert で入力を拒んだ（`details.dialog` に文言） |
| `NOT_FOUND` | 名前で指定したものが見つからない |
| `LAYOUT_CHANGED` | 期待するセレクタが見つからない。推測で補わず、無かったセレクタを `details.selector` に入れる |
| `NAVIGATION` | 遷移に失敗した（`details.status`）、または想定外のページで呼ばれた |

`LAYOUT_CHANGED` はサイトの構造が変わったことを示します。セレクタを推測で置き換えず、合成サイトとあわせて直してください。

## テスト用の合成サイト

```ts
import { installFakePortal } from "@chibatech-src/portal/testing";

const fake = await installFakePortal(context); // Page でも可。{ baseUrl } で置き場所を変えられる
// fake.served / fake.blocked で、応答した URL と中断した URL を確かめられる
```

`page.route` / `context.route` でベース URL 以下を横取りし、架空の HTML・JS・PDF を返します。ベース URL の外への要求はすべて中断するので、テストはネットワークに出ません。後から登録した route が優先されるため、特定の URL を別に扱いたいときは `installFakePortal` の後に登録してください。

合成サイトは、セレクタが依存する構造（id・class・`body` の id・入れ子・アコーディオン）だけを実サイトに合わせています。文言・学科名・PDF・スクリプトはすべて架空です。次のケースを含めています。

- 年度によって学科コードが変わる学科、年度によって増える学科
- 大学院の複数専攻が 1 ページを共有する
- 同じ PDF の同じページ番号を複数の項目が共有する
- 要ログイン注記付きの文書
- 未選択で検索したときの alert、幅 737px 未満でのアコーディオン、境界をまたぐリサイズでの再読込

## 開発

実行はすべて Docker の中で行います。ホストに Node・Bun・ブラウザを入れる必要はありません。

```sh
./scripts/test.sh          # ルートの scripts/test.sh packages/portal を呼ぶ（Docker の中で型検査とテスト）
LIVE=1 ./scripts/test.sh   # 実サイトへのライブ確認 1 本も実行する
```

- テストイメージは `playwright-core` と同じ版の Playwright 公式イメージに固定しています。同梱の Chromium を使います。
- ライブ確認は既定でスキップされます。`LIVE=1` のときだけ動き、実サイトへの要求は 5 件以内に制限しています（それ以外は中断して件数を検査します）。判定するのは選択肢の有無や遷移先 URL といった事実だけで、本文は出力しません。
- コードは実行環境中立です（Node 専用・Bun 専用の API に依存しません）。
