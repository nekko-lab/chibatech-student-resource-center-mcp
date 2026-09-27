# チームの開発運用

NCチームで使用する開発環境のテンプレートです．

## セットアップ

### 1. ブランチ保護ルールの設定（Rulesets）

`main` ブランチへの直接プッシュを禁止し，プルリクエスト経由のマージを強制します．
GitHub の新しい **Rulesets** を使用して設定します．

#### 設定手順

1. GitHub リポジトリの **Settings** > **Rules** > **Rulesets** を開く
2. **New ruleset** > **New branch ruleset** をクリック
3. 以下を設定して **Save changes** をクリックする

#### Ruleset 設定内容

| 項目 | 値 |
| --- | --- |
| Ruleset name | `pullreq`（任意） |
| Enforcement status | Active |
| Target branches | Default branch（`main`） |

#### Bypass list

| ロール | 許可内容 |
| --- | --- |
| Organization admin | Allow for pull requests only |
| Repository admin | Always allow |

#### 有効にするルール

| ルール | 説明 |
| --- | --- |
| Restrict deletions | ブランチの誤削除を防ぐ |
| Require a pull request before merging | マージ前に PR を必須にする |
| Require status checks to pass | CI テストが通過しないとマージ不可 |
| Block force pushes | 履歴の強制書き換えを禁止する |
| Automatically request Copilot code review | PR 作成時に Copilot によるコードレビューを自動リクエストする |

---

### 2. 開発環境のセットアップ（Docker）

型検査とテストはすべて Docker の中で実行します．ホストに Node や Bun を入れる必要はありません．
前提は [Docker](https://www.docker.com/products/docker-desktop/) だけです．手順は [開発手順](development.md) を参照してください．

```bash
scripts/test.sh
```

---

### 3. チケット駆動開発のブランチ運用

GitHub Issues をチケットとして使用し，1 チケット 1 ブランチで作業を管理します．

#### ブランチ運用フロー

```text
main
 └─ dev
     └─ feat/*** ─── 作業 ─── PR ──→ dev ─── PR ──→ main
```

##### feat/\*\*\* → dev（日常の開発）

1. GitHub Issues で `[FEAT]` チケットを作成する
2. `dev` ブランチから `feat/***` ブランチを切る（ブランチ名はチケットに記載）
3. `feat/***` ブランチで作業を行う
4. 作業完了後，`feat/***` から `dev` へ PR を作成してマージする

##### dev → main（リリース）

`dev` から `main` へマージするには，以下の条件をすべて満たす必要があります．

| 条件 | 状態 |
| --- | --- |
| CI テストが全て通過していること | 必須 |
| CD によるステージング環境へのデプロイが成功していること | 予定 |
| 開発者がログ・メトリクス・トレースの取得を確認していること | 予定 |

`main` にマージしたあと，リリースするときは「5. バージョン管理とリリース」の手順で `main` にタグを付けます．

---

### 4. コミットメッセージテンプレートの設定

`.gitmessage` をコミットメッセージのテンプレートとして使用します．
リポジトリをクローン後，以下のコマンドを **1回だけ** 実行してください．

```bash
git config commit.template .gitmessage
```

設定後は `git commit` を実行すると，以下のテンプレートがエディタに表示されます．

```text
# feat | fix | docs | refactor | test | chore
<type>: <subject>

Refs: #
```

| type | 用途 |
| --- | --- |
| `feat` | 新機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | 機能変更を伴わないコード改善 |
| `test` | テストの追加・修正 |
| `chore` | ビルド・設定などの雑務 |

---

#### RACI

各チケットには以下の役割を記載します．**R はチケット作成者自身**が担います．

| 役割 | 説明 |
| --- | --- |
| R: 実行責任者 (Responsible) | 実際に作業を行う人．チケット作成者が担当する |
| A: 説明責任者 (Accountable) | 成果物に対して最終責任を持つ人 |
| C: 協業先 (Consulted) | 作業に際して相談・協力を求める人 |
| I: 報告先 (Informed) | 進捗・完了を報告する人 |

---

### 5. バージョン管理とリリース

版は [セマンティックバージョニング](https://semver.org/lang/ja/)（`MAJOR.MINOR.PATCH`）で管理し，**`main` のコミットに付けたタグ `vX.Y.Z` だけ**がリリースになります．
mcpb の manifest と `package.json` はどちらも SemVer を前提にしているため，日付形式（YY.MM.DD）は使いません．

#### 版の上げ方

| 変更 | 例 | 上げる番号 |
| --- | --- | --- |
| ツールの名前・引数を変えた，なくした | ツールの廃止，引数名の変更 | MAJOR |
| ツールを足した，引数を足した（既存の呼び方はそのまま使える） | マクロの追加 | MINOR |
| 不具合の修正，大学サイトの構造変更への追従 | `LAYOUT_CHANGED` の解消 | PATCH |

- `1.0.0` より前（`0.x`）の間は，ツールの形が変わる変更でも MINOR を上げます．
- 最初のリリースは `v0.1.0` です．学生に配って大きな問題が出なくなったら `v1.0.0` にします．
- 資料はリリースに同梱せず，毎回ポータルから取得するので，資料の更新（新年度の便覧など）だけでは版を上げません．

#### リリースの手順

1. `dev` → `main` の PR をマージする
2. `main` の最新コミットにタグを付けて push する

   ```bash
   git fetch origin
   git tag -a v0.1.0 origin/main -m "v0.1.0"
   git push origin v0.1.0
   ```

3. タグの push で `.github/workflows/release.yaml` が動き，ビルド → 各 OS での起動確認 → GitHub Release の作成まで自動で行う
   - 添付されるもの: mcpb（macOS / Windows 共通の 1 つ），単体バイナリ（macOS arm64・Windows x64・Linux x64 / arm64），`SHA256SUMS`，`LICENSE`，`THIRD_PARTY_NOTICES.txt`
   - リリースノートは，前のタグ以降にマージされた PR のタイトルから自動で作られる．PR のタイトルはコミットメッセージと同じ `<type>: <subject>` の形で書く

#### 守ること

- タグは `main` のコミットにだけ付けます．`main` に含まれないコミットのタグでは，ワークフローが失敗して Release は作られません．
- タグは `git` で付けます．GitHub の画面から Release を作らないでください（先に Release ができてしまい，ワークフローと衝突します）．
- 付けたタグは消したり付け直したりしません．リリースに問題があったら，修正して PATCH を上げた版を出します．
