# ワークスペース全体の型検査・テスト用イメージ（ローカルと CI で共通）。
# ホストには node もパッケージも入れず、すべてこの中で実行する（scripts/test.sh 参照）。
#
#   lockfile : ルートの package-lock.json をコンテナ内で解決して書き出す
#              docker build -f docker/test.Dockerfile --target lockfile --output type=local,dest=. .
#   test     : npm ci のあと、全ワークスペースの型検査とテスト（既定の CMD は npm run check）
#
# ビルドコンテキストはリポジトリのルート。除外は docker/test.Dockerfile.dockerignore。
# Playwright のイメージのタグは playwright-core の固定版（1.63.0）と揃える。
# 同梱の Chromium（/ms-playwright）を playwright-core がそのまま使えるようにするため。
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base

WORKDIR /repo

# @chibatech-src/pdf のテスト用 PDF の合成に使う日本語フォント（SIL Open Font License）。
# リポジトリには含めず、ビルド時に取得してチェックサムで固定する。
ADD --checksum=sha256:dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073 \
    https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf \
    /opt/fonts/NotoSansJP-Regular.otf
ENV PDFX_TEST_FONT=/opt/fonts/NotoSansJP-Regular.otf

ENV CI=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# 依存の解決に要るファイル（各ワークスペースの package.json）だけを抜き出す。
# ソースを変えても、この段の出力が同じなら後段の npm ci はキャッシュが効く。
FROM base AS manifests
COPY packages ./packages
COPY tools ./tools
RUN find packages tools -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

# ルートの package-lock.json を作る段（--target lockfile から使う）。
FROM base AS resolve
COPY package.json ./
COPY --from=manifests /repo/ ./
RUN npm install --package-lock-only

FROM scratch AS lockfile
COPY --from=resolve /repo/package-lock.json /package-lock.json

FROM base AS deps
COPY package.json package-lock.json ./
COPY --from=manifests /repo/ ./
RUN npm ci
# 単一バイナリに playwright-core が重複して入らないよう、node_modules に 1 つだけであることを機械的に確かめる。
RUN n="$(find . -type d -path '*/node_modules/playwright-core' | wc -l)"; \
    if [ "$n" -ne 1 ]; then \
      echo "playwright-core が node_modules に ${n} 個ある（1 個であるべき）" >&2; \
      find . -type d -path '*/node_modules/playwright-core' >&2; \
      exit 1; \
    fi
# @napi-rs/canvas は pdfjs-dist の任意依存。製品（単一バイナリ）には入らないので、
# canvas 無しで動くことをテストでも保証するため取り除く。
RUN find . -path '*/node_modules/@napi-rs/canvas*' -prune -exec rm -rf {} +

FROM deps AS test
COPY . .
CMD ["npm", "run", "check"]
