#!/usr/bin/env sh
# docker build → コンテナ内で型検査とテストを実行する（実体はルートの scripts/test.sh）。
set -eu
exec "$(dirname "$0")/../../../scripts/test.sh" packages/parsers "$@"
