# 非公式 PoC: Bun 単一バイナリ × playwright-core の成立性検証用。
#
#   deps    : bun と依存の導入（bun.lock があれば固定して入れる）
#   build   : 全ターゲットのクロスコンパイル（linux / darwin / windows）
#   runtime : bun も node も無い素の Debian に、Chromium の共有ライブラリだけを入れて
#             linux バイナリを動かす（= 学生の PC に追加の実行環境が要らないことの確認）
#
# ビルド: docker build -f poc/Dockerfile --target runtime -t bunpoc poc
#         docker build -f poc/Dockerfile --target runtime --platform linux/amd64 -t bunpoc-amd64 poc
ARG BUN_VERSION=1.4.2

# クロスコンパイルなので、ビルド段はホストのアーキテクチャで動かす（runtime だけ --platform に従う）
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-debian AS deps
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
WORKDIR /poc
COPY package.json bun.lock* ./
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile; else bun install; fi

FROM deps AS build
COPY . .
RUN bun run scripts/build.ts

# 実行環境: bun / node を含まない素の Debian。
# 共有ライブラリは Playwright の nativeDeps（debian12, chromium-headless-shell）に相当するもの。
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m student
USER student
WORKDIR /home/student
COPY --from=build /poc/out/ /opt/bunpoc/
# 例: docker run --rm bunpoc /opt/bunpoc/csrc-poc-smoke-linux-arm64 /opt/bunpoc/csrc-poc-server-linux-arm64
