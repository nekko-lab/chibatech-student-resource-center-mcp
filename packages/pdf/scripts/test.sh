#!/bin/sh
# Docker の中で型検査とテストを実行する。ホストに node は不要。
# 使い方: packages/pdf/scripts/test.sh [vitest の追加引数...]
set -eu

PKG_DIR=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${PDFX_IMAGE:-chibatech-src-pdf-test}

docker build -t "$IMAGE" "$PKG_DIR"
docker run --rm "$IMAGE" sh -c 'npx tsc --noEmit && npx vitest run "$@"' sh "$@"
