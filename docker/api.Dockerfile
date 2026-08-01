# staffweave の API と Web を 1 つのイメージで動かす。
#
# Web はビルドした静的ファイルを API が配信する。
# 別々に置きたい場合は dist をそのまま任意の配信先へコピーできる。
#
# 実行段には、動かすのに必要なものだけを置く。
# 開発用の依存（TypeScript、Vitest、Biome）とテストは含めない。
# API は tsx で TypeScript をそのまま実行するため、tsx だけは実行時の依存として持つ。

FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/agent/package.json packages/agent/
COPY packages/connector/package.json packages/connector/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter "@staffweave/web" build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pnpm が書き込み先を必要とするため、非 root の利用者の家を明示する。
ENV HOME=/home/node

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

# 実行に要る依存だけを入れる。--prod は devDependencies を入れない。
# 取得の控えは実行に要らないため、同じ層のうちに消す。層を分けると容量が残る。
RUN pnpm install --frozen-lockfile --prod --filter "@staffweave/api..." \
  && rm -rf "$(pnpm store path)" "$HOME/.cache" /root/.cache

# 動かすのに要るソースと成果物だけを置く。
COPY packages/domain/src packages/domain/src
COPY packages/contracts/src packages/contracts/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/api/src packages/api/src
COPY --from=build /app/packages/web/dist packages/web/dist

# テストは実行に要らない。イメージへ持ち込まない。
RUN find packages -name '*.test.ts' -delete

# 権限昇格の余地を残さないため、非 root で動かす。node は公式イメージが用意する利用者。
USER node

EXPOSE 8787
CMD ["pnpm", "--filter", "@staffweave/api", "start"]
