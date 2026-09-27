#!/bin/sh
# コンテナ（runtime ステージ）の中で実行する検査。bun / node が無い環境で単一バイナリを動かす。
#
#   docker run --rm -v "$PWD/poc/scripts:/scripts:ro" bunpoc sh /scripts/container-check.sh <mode>
#
# mode:
#   env           bun / node が入っていないことの確認
#   init <bin>    initialize だけ送って応答を見る（起動確認・起動時間）
#   smoke <bin>   スモーク一式（ダウンロード経路。CSRC_DISABLE_CHANNELS=1 を付けて実行）
#   twice <bin>   スモークを 2 回（初回ダウンロード込み / キャッシュ済み）
#   risk3         無加工バンドル（-nopatch）が起動に失敗することの確認
set -u
DIR=/opt/bunpoc
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) KEY=linux-arm64 ;;
  *) KEY=linux-x64 ;;
esac
MODE="${1:-smoke}"
BIN="${2:-$DIR/csrc-poc-server-$KEY}"

case "$MODE" in
  env)
    echo "arch=$ARCH key=$KEY"
    for c in bun node npx deno; do
      if command -v "$c" >/dev/null 2>&1; then echo "$c: FOUND"; else echo "$c: absent"; fi
    done
    ls -la "$DIR"
    ;;
  init)
    start=$(date +%s%3N)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
      | timeout 20 "$BIN"
    code=$?
    end=$(date +%s%3N)
    echo "exit=$code elapsed_ms=$((end - start))"
    ;;
  smoke)
    "$DIR/csrc-poc-smoke-$KEY" "$BIN"
    ;;
  risk3)
    # 無加工バンドルは package.json を実行時パスで読むため起動に失敗するはず（既知リスク 3 の再現）
    out=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
      | timeout 20 "$DIR/csrc-poc-server-$KEY-nopatch" 2>&1)
    code=$?
    echo "$out" | head -3
    if [ "$code" -ne 0 ] && echo "$out" | grep -q "Cannot find module"; then echo "risk3: reproduced (exit=$code)"; else echo "risk3: NOT reproduced (exit=$code)"; exit 1; fi
    ;;
  twice)
    # 1 回目（初回ダウンロード込み）と 2 回目（キャッシュ済み）の所要時間を比べる
    "$DIR/csrc-poc-smoke-$KEY" "$BIN" --out /tmp/first.json >/dev/null; echo "first exit=$?"
    "$DIR/csrc-poc-smoke-$KEY" "$BIN" --out /tmp/second.json >/dev/null; echo "second exit=$?"
    echo "--- first"; cat /tmp/first.json; echo; echo "--- second"; cat /tmp/second.json; echo
    du -sh "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/* 2>/dev/null
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
