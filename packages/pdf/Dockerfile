# @chibatech-src/pdf の型検査・テスト用イメージ。
# ホストには node もパッケージも入れず、すべてこの中で実行する（scripts/test.sh 参照）。
FROM node:22.23.3-bookworm-slim

WORKDIR /app

# テスト用 PDF の合成に使う日本語フォント（SIL Open Font License）。
# リポジトリには含めず、ビルド時に取得してチェックサムで固定する。
ADD --checksum=sha256:dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073 \
    https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf \
    /opt/fonts/NotoSansJP-Regular.otf
ENV PDFX_TEST_FONT=/opt/fonts/NotoSansJP-Regular.otf

COPY package.json package-lock.json ./
# @napi-rs/canvas は pdfjs-dist の任意依存。製品（単一バイナリ）には入らないので、
# canvas 無しで動くことをテストでも保証するため取り除く。
RUN npm ci --no-audit --no-fund && rm -rf node_modules/@napi-rs

COPY . .

CMD ["npm", "run", "check"]
