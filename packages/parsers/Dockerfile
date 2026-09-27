# 型検査とテストをコンテナ内で完結させるためのイメージ。
# ホストには node / パッケージを入れない。
FROM node:22.12.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts

CMD ["sh", "-c", "npx tsc --noEmit && npx vitest run"]
