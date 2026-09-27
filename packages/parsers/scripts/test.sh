#!/usr/bin/env sh
# docker build → コンテナ内で型検査とテストを実行する。
set -eu
cd "$(dirname "$0")/.."
IMAGE="${IMAGE:-chibatech-src-parsers-test}"
docker build -t "$IMAGE" .
docker run --rm "$IMAGE"
