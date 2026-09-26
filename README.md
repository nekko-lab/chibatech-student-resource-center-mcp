# repo-template

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

### 2. 開発環境のセットアップ（Dev Container）

Dev Container を使用することで，チーム全員が同一の開発環境を再現できます．

#### 前提条件

- [Docker](https://www.docker.com/products/docker-desktop/) がインストール済みであること
- [Visual Studio Code](https://code.visualstudio.com/) がインストール済みであること
- VS Code 拡張機能 [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) がインストール済みであること

#### 手順

1. VS Code でリポジトリのルートディレクトリを開く
2. コマンドパレットを開く（`Cmd+Shift+P` / `Ctrl+Shift+P`）
3. `Dev Containers: Reopen in Container` を選択する
4. コンテナのビルドが完了するまで待つ

コンテナ起動後は，`.devcontainer/devcontainer.json` に定義された環境が自動的に適用されます．

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
