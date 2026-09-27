# packages/match の型検査・テスト用イメージ。
# ホストに node やパッケージを入れず、依存はここで導入する。
FROM node:22.23.3-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ロックファイルの書き出し用: docker build --target lockfile --output type=local,dest=. .
FROM scratch AS lockfile
COPY --from=deps /app/package-lock.json /package-lock.json

FROM deps AS test
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY test ./test
CMD ["sh", "-c", "npm run typecheck && npm test"]
