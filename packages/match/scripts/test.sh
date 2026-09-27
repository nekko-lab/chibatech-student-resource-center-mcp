#!/bin/sh
# packages/match の型検査とテストを Docker の中で実行する。
# ホストには node もパッケージも入れない。
set -eu
cd "$(dirname "$0")/.."
IMAGE="chibatech-src-match-test"
docker build --target test -t "$IMAGE" .
docker run --rm "$IMAGE"
