#!/bin/sh
# packages/match の型検査とテストを Docker の中で実行する（実体はルートの scripts/test.sh）。
# ホストには node もパッケージも入れない。引数は vitest にそのまま渡す。
set -eu
exec "$(dirname "$0")/../../../scripts/test.sh" packages/match "$@"
