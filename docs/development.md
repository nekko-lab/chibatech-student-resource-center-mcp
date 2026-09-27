# 開発手順

千葉工業大学「学生資料室」ポータルを操作する**非公式**の MCP サーバの開発手順です。

実行はすべて Docker の中で行います。ホストに node・bun・パッケージを入れないでください。

## 構成

- ルートは npm ワークスペースです（`workspaces: ["packages/*", "tools/*"]`、npm 11.19.0）。
- lockfile はルートの `package-lock.json` の 1 つだけです。各パッケージには置きません。
- `poc/` はワークスペースに含めません（Bun の検証用で、`bun.lock` を別に持ちます）。
- 各パッケージの `exports` は `./src/index.ts` を直接指しています（ビルド成果物はありません）。
- 各パッケージの tsconfig は `tsconfig.base.json` を extends します。

| パッケージ | 役割 |
|---|---|
| `packages/match` | 日本語のあいまい照合（純関数） |
| `packages/pdf` | PDF の取得・本文抽出・ページ範囲 |
| `packages/parsers` | PDF の座標付きテキストから表を組み立てる（純関数） |
| `packages/portal` | ポータルのアトミック操作（Playwright）と合成テストサイト |
| `packages/browser` | ブラウザの発見と起動 |
| `packages/server` | MCP サーバ（stdio） |
| `tools/build` | 単一バイナリ・mcpb のビルドスクリプト（Bun で実行） |

## テスト

```sh
scripts/test.sh                          # 全ワークスペースで型検査 → テスト
scripts/test.sh packages/pdf             # 1 つに絞る（パッケージ名でも可）
scripts/test.sh packages/pdf -t 'range'  # 2 つ目以降の引数は vitest に渡る
LIVE=1 scripts/test.sh packages/portal   # 実サイトへのライブ確認も実行（手元だけ）
packages/pdf/scripts/test.sh             # 各パッケージのスクリプトはルートを呼ぶ
```

- イメージは `docker/test.Dockerfile` です（`mcr.microsoft.com/playwright:v1.63.0-noble` ベースで、同梱の Chromium を使います）。
- pdf のテストに使う日本語フォント（Noto Sans JP、SIL Open Font License）はビルド時に取得し、チェックサムで固定しています。リポジトリには入れません。
- CI（`.github/workflows/ci.yaml`）も `scripts/test.sh` を実行します。CI からはサイトにアクセスしません（`LIVE=0`）。

## 依存の追加と lockfile の更新

1. 対象の `package.json` に版を固定して書きます（`^` や `~` は使いません）。ワークスペース間の依存は `"@chibatech-src/xxx": "*"` と書きます。
2. lockfile をコンテナ内で作り直し、ルートに書き出します。

   ```sh
   docker build -f docker/test.Dockerfile --target lockfile --output type=local,dest=. .
   ```

3. `scripts/test.sh` を実行します。build の途中で、`playwright-core` が node_modules に 1 つだけであることを確かめます。
4. 並列作業中は lockfile が衝突しやすいので、依存の追加は 1 本の PR にまとめます。

## 書き方の約束

- ワークスペース間はパッケージ名で import します（`import { normalizeJa } from "@chibatech-src/match"`）。相対パスで他パッケージの `src` を指しません。
- パッケージ内の import は `.ts` 拡張子付きで書きます。型だけの import は `import type` にします。
- ambient な型宣言（`.d.ts`）を置く場合は、使う側のソースから `/// <reference path>` で参照します。
- `playwright-core` は 1.63.0 に固定します。版を上げるときは `docker/test.Dockerfile` のイメージのタグも同時に変えます。
- 実サイトに触るテストは `LIVE === "1"` のときだけ動かします（`describe.skipIf`）。
- 大学のポリシーにより、サイトのコンテンツ（PDF・HTML・本文）はリポジトリにもテストの fixture にも入れません。
