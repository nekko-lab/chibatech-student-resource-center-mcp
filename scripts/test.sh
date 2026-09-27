#!/usr/bin/env sh
# ルートのテストイメージ（docker/test.Dockerfile）を作り、コンテナの中で型検査とテストを実行する。
# ホストには node もパッケージも入れない。ローカルと CI（.github/workflows/ci.yaml）で同じ手順を使う。
#
# 使い方:
#   scripts/test.sh                          全ワークスペースで npm run check（型検査 → テスト）
#   scripts/test.sh packages/pdf             1 つのワークスペースに絞る（パスでもパッケージ名でもよい）
#   scripts/test.sh packages/pdf -t 'range'  2 つ目以降の引数は vitest にそのまま渡す
#   LIVE=1 scripts/test.sh packages/portal   実サイトへのライブ確認 1 本も実行する（手元だけ。CI では使わない）
#
# 環境変数:
#   CSRC_TEST_IMAGE  イメージ名（既定 chibatech-src-test）
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE="${CSRC_TEST_IMAGE:-chibatech-src-test}"

docker build -f "$ROOT/docker/test.Dockerfile" --target test -t "$IMAGE" "$ROOT"

# --init と --ipc=host は Chromium を安定して動かすため（Playwright の推奨）
if [ $# -eq 0 ]; then
  exec docker run --rm --init --ipc=host -e "LIVE=${LIVE:-0}" "$IMAGE" npm run check
fi

WS=$1
shift
exec docker run --rm --init --ipc=host -e "LIVE=${LIVE:-0}" "$IMAGE" \
  sh -c 'ws=$1; shift; npm run typecheck -w "$ws" && npm run test -w "$ws" -- "$@"' sh "$WS" "$@"
