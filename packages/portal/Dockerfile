# Test image for @chibatech-src/portal.
# The Playwright image tag must match the pinned playwright-core version in package.json,
# so that the bundled Chromium is the one playwright-core expects.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY test ./test

ENV CI=1
CMD ["npm", "run", "check"]
