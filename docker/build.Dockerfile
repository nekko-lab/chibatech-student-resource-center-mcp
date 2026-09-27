# 単一バイナリ・mcpb のビルド用イメージ（非公式 MCP サーバ）。ローカルと release.yaml で共通。
# ホストに bun / node / zip を入れず、すべてこの中で実行する。ビルドコンテキストはリポジトリのルート。
# 除外は docker/build.Dockerfile.dockerignore。
#
#   deps      : ルートの package-lock.json どおりに npm ci（ワークスペースの依存。canvas は取り除く）
#   toolchain : bun（1.4.2 固定）・zip・Bun のライセンス（版とチェックサムを固定）と、依存・ソース
#   build     : tools/build/src/cli.ts で全ターゲットをクロスコンパイルし、/work/dist に出力する。
#               検証用の CMap プローブ（tools/build/src/probe/cmap-probe.ts）を /work/probe に出力する
#   artifacts : /work の中身だけ（--output type=local で取り出す）
#   runtime   : bun も node も無い素の Debian。linux のバイナリとプローブだけを置く
#
# 例:
#   docker build -f docker/build.Dockerfile --target artifacts --output type=local,dest=out/build .
#   docker build -f docker/build.Dockerfile --target runtime -t csrc-build-runtime .
#   docker run --rm --network none csrc-build-runtime sh /opt/csrc/scripts/mcp-probe.sh \
#     /opt/csrc/dist/bin/chibatech-src-mcp-linux-arm64 /opt/csrc/tools.json
#
# 引数（--build-arg）:
#   ENTRY     単一バイナリの入口（既定: poc/src/launcher.ts。本番の入口への切り替えは別タスク）
#   TOOLS     mcpb の tools に載せる JSON（既定: tools/build/fixtures/poc-tools.json）
#   VERSION   semver（v を付けない。既定 0.0.0-dev）
#   TARGETS   カンマ区切りの出力（空なら既定の 4 つ）
#   BUILD_ARGS  cli.ts に足す引数（例: "--baseline"）
ARG BUN_VERSION=1.4.2

# ---- 依存（lockfile どおり） ----
# docker/test.Dockerfile と同じく、playwright-core の固定版（1.63.0）と揃えたイメージで npm ci する。
# クロスコンパイルなので、ビルド側の段はホストのアーキテクチャで動かす。
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/playwright:v1.63.0-noble AS manifests
WORKDIR /repo
COPY packages ./packages
COPY tools ./tools
RUN find packages tools -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/playwright:v1.63.0-noble AS deps
ENV CI=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /repo
COPY package.json package-lock.json ./
COPY --from=manifests /repo/ ./
RUN npm ci
# 単一バイナリに playwright-core が重複して入らないよう、node_modules に 1 つだけであることを確かめる
RUN n="$(find . -type d -path '*/node_modules/playwright-core' | wc -l)"; \
    if [ "$n" -ne 1 ]; then echo "playwright-core が node_modules に ${n} 個ある（1 個であるべき）" >&2; exit 1; fi
# @napi-rs/canvas は pdfjs-dist の任意依存で、単一バイナリには入れない（ネイティブ addon を持ち込まない）
RUN find . -path '*/node_modules/@napi-rs/canvas*' -prune -exec rm -rf {} +

# ---- ツールチェイン ----
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-debian AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends zip \
 && rm -rf /var/lib/apt/lists/*
# 単一バイナリに同梱する Bun ランタイムのライセンス（bun-v1.4.2 の LICENSE.md。THIRD_PARTY_NOTICES.txt に載せる）
ADD --checksum=sha256:b9caf52728691b4057e371232c221a132883198be2f3d2ddf92c90404c984b1a \
    https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.2/LICENSE.md /opt/licenses/bun/LICENSE.md
WORKDIR /repo
COPY --from=deps /repo/ ./
COPY . .
# 検証用の入口 poc/src/launcher.ts は `../node_modules/playwright-core/browsers.json` を相対パスで読む。
# poc/ はワークスペース外で依存を持たないため、ワークスペースの node_modules（同じ固定版）を見せる。
# 本番の入口に切り替えた後は不要（poc/ を入口にしない限り効かない）。
RUN [ -e poc/node_modules ] || ln -s ../node_modules poc/node_modules

# ---- ビルド ----
FROM toolchain AS build
ARG ENTRY=poc/src/launcher.ts
ARG TOOLS=tools/build/fixtures/poc-tools.json
ARG VERSION=0.0.0-dev
ARG TARGETS=
ARG BUILD_ARGS=
RUN set -eu; \
    t=""; [ -n "$TARGETS" ] && t="--targets $TARGETS"; \
    lic=/opt/licenses/bun/LICENSE.md; \
    bun run tools/build/src/cli.ts --entry "$ENTRY" --out /work/dist --version "$VERSION" --tools "$TOOLS" \
      --bun-license "$lic" $t $BUILD_ARGS; \
    bun run tools/build/src/cli.ts --entry tools/build/src/probe/cmap-probe.ts --out /work/probe --version "$VERSION" \
      --tools "$TOOLS" --bun-license "$lic" --name csrc-cmap-probe --no-mcpb $t $BUILD_ARGS; \
    cp "$TOOLS" /work/tools.json; \
    mkdir -p /work/scripts && cp tools/build/scripts/*.sh /work/scripts/; \
    cd /work/dist && sha256sum -c SHA256SUMS; \
    cat /work/dist/build-report.json

FROM scratch AS artifacts
COPY --from=build /work/ /

# ---- mcpb の公式 CLI で検査する（manifest の schema と、展開できること） ----
#   docker build -f docker/build.Dockerfile --target mcpb-validate .
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/playwright:v1.63.0-noble AS mcpb-validate
ARG MCPB_CLI_VERSION=2.1.2
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
RUN npm install -g "@anthropic-ai/mcpb@${MCPB_CLI_VERSION}"
COPY --from=build /work/dist/mcpb/ /work/mcpb/
RUN set -eu; \
    for f in /work/mcpb/*.mcpb; do \
      d="/work/unpacked/$(basename "$f" .mcpb)"; \
      mcpb unpack "$f" "$d"; \
      mcpb validate "$d/manifest.json"; \
      mcpb info "$f"; \
      ls -la "$d" "$d/server"; \
    done

# ---- 実行確認用: bun / node を含まない素の Debian ----
# ブラウザは起動しない（ツールを呼ばない）ので、Chromium の共有ライブラリも入れない。
FROM debian:bookworm-slim AS runtime
RUN useradd -m student
COPY --from=build /work/dist/bin/ /opt/csrc/dist/bin/
COPY --from=build /work/probe/bin/ /opt/csrc/probe/bin/
COPY --from=build /work/scripts/ /opt/csrc/scripts/
COPY --from=build /work/tools.json /opt/csrc/tools.json
RUN rm -f /opt/csrc/dist/bin/*darwin* /opt/csrc/dist/bin/*.exe /opt/csrc/probe/bin/*darwin* /opt/csrc/probe/bin/*.exe
USER student
WORKDIR /home/student
