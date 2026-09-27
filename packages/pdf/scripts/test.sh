#!/bin/sh
# Docker の中で型検査とテストを実行する（実体はルートの scripts/test.sh）。ホストに node は不要。
# 使い方: packages/pdf/scripts/test.sh [vitest の追加引数...]
set -eu
exec "$(dirname "$0")/../../../scripts/test.sh" packages/pdf "$@"
