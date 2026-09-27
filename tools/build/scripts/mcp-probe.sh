#!/bin/sh
# 単一バイナリを MCP サーバとして起動し、initialize → notifications/initialized → tools/list が返ることを確かめる。
# ツールは呼ばないので、サイトにはアクセスしない。bun / node が無い環境（素の Debian、各 OS のランナー）で動く。
#
#   sh tools/build/scripts/mcp-probe.sh <binary> <tools.json>
#
# tools.json に書いたツール名が、すべて tools/list の応答に含まれていれば成功（終了コード 0）。
# 環境変数: PROBE_TIMEOUT（秒。既定 30）
set -u

BIN=${1:?usage: mcp-probe.sh <binary> <tools.json>}
TOOLS=${2:?usage: mcp-probe.sh <binary> <tools.json>}
TIMEOUT=${PROBE_TIMEOUT:-30}

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t mcpprobe)
OUT="$WORK/stdout"
ERR="$WORK/stderr"
: >"$OUT"
: >"$ERR"

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"csrc-mcp-probe","version":"0"}}}'
INITIALIZED='{"jsonrpc":"2.0","method":"notifications/initialized"}'
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 応答（id）が出るまで待つ。見つかれば 0、期限切れなら 1
wait_for_id() {
  n=0
  while [ "$n" -lt $((TIMEOUT * 5)) ]; do
    if grep -Eq "\"id\":$1[,}]" "$OUT" 2>/dev/null; then return 0; fi
    sleep 0.2
    n=$((n + 1))
  done
  return 1
}

start=$(date +%s)
{
  printf '%s\n' "$INIT"
  wait_for_id 1 || exit 0
  printf '%s\n' "$INITIALIZED"
  printf '%s\n' "$LIST"
  wait_for_id 2 || exit 0
} | "$BIN" >"$OUT" 2>"$ERR" &
pid=$!

# 書き手が終わると stdin が閉じ、サーバは終わる。終わらなければ期限で止める
n=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$n" -ge $(((TIMEOUT + 5) * 5)) ]; then
    kill "$pid" 2>/dev/null
    echo "probe: server did not exit; killed" >&2
    break
  fi
  sleep 0.2
  n=$((n + 1))
done
wait "$pid" 2>/dev/null
elapsed=$(($(date +%s) - start))

status=0
if ! grep -Eq '"id":1[,}]' "$OUT" || ! grep -q '"serverInfo"' "$OUT"; then
  echo "probe: initialize の応答がありません" >&2
  status=1
fi
if ! grep -Eq '"id":2[,}]' "$OUT" || ! grep -q '"tools":\[' "$OUT"; then
  echo "probe: tools/list の応答がありません" >&2
  status=1
fi

expected=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$TOOLS" | sed 's/.*"\([^"]*\)"$/\1/')
count=0
for name in $expected; do
  count=$((count + 1))
  if ! grep -q "\"name\":\"$name\"" "$OUT"; then
    echo "probe: tools/list に $name がありません" >&2
    status=1
  fi
done
if [ "$count" -eq 0 ]; then
  echo "probe: $TOOLS からツール名を読めません" >&2
  status=1
fi

server=$(grep -o '"serverInfo":{[^}]*}' "$OUT" | head -1)
echo "probe: binary=$(basename "$BIN") expected_tools=$count elapsed_s=$elapsed status=$status $server"
if [ "$status" -ne 0 ]; then
  echo "--- stdout" >&2
  head -c 4000 "$OUT" >&2
  echo "--- stderr" >&2
  head -c 4000 "$ERR" >&2
fi
rm -rf "$WORK"
exit "$status"
