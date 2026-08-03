# staffweave の API と画面を 1 つのイメージで動かす。
#
# 画面はビルドした静的ファイルを API が配信する。
# 別々に置きたい場合は dist をそのまま任意の配信先へコピーできる。
#
# 段は 4 つに分ける。前の段ほど変わりにくいものを置き、後ろの段ほど頻繁に
# 変わるものを置く。ソースを 1 行変えたときに作り直す範囲を、最後の数段に留める。
#
#   base       実行環境と pnpm 本体
#   manifests  依存の宣言だけ
#   build      画面のビルド
#   runtime    動かすのに要るものだけ。配る対象はこの段
#
# 開発用の依存（TypeScript、Vitest、Biome）とテストは実行段へ入れない。
# API は tsx で TypeScript をそのまま実行するため、tsx だけは実行時の依存として持つ。

FROM node:24-alpine AS base
WORKDIR /app

# corepack が取り寄せた pnpm の置き場を、利用者の家の外に決める。
# 既定は家の下（~/.cache）にあり、家ごと消す書き方をすると pnpm 本体も消える。
ENV COREPACK_HOME=/opt/corepack

# package.json の packageManager が指す版を、ここで取り寄せる。
# base へ置くことで、以降のすべての段が同じ 1 つを使い回す。
COPY package.json ./
RUN corepack enable && corepack install

# 依存の宣言だけを置く段。ソースを変えてもここは作り直しにならないため、
# 一番重い pnpm install の結果がそのまま使い回せる。
FROM base AS manifests
COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/web/package.json packages/web/

FROM base AS build
COPY --from=manifests /app /app

# 画面のビルドに要る分だけを入れる。API 側の依存はここでは要らない。
#
# 取得の控えは cache mount へ置く。層へ入れてから消す形だと、消す前の大きさが
# 毎回の書き出しに乗り、消し忘れればそのままイメージへ残る。
# cache mount はビルドの間だけ見えるため、どちらも起きない。
RUN --mount=type=cache,target=/pnpm/store \
  --mount=type=cache,target=/root/.cache \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store --filter "@staffweave/web..."

COPY packages/domain/src packages/domain/src
COPY packages/contracts/src packages/contracts/src
COPY packages/web packages/web
RUN pnpm --filter "@staffweave/web" build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=manifests /app /app

# 実行に要る依存だけを入れる。--prod は devDependencies を入れない。
RUN --mount=type=cache,target=/pnpm/store \
  --mount=type=cache,target=/root/.cache \
  pnpm install --frozen-lockfile --prod --store-dir=/pnpm/store --filter "@staffweave/api..."

# 動かすのに要るソースと成果物だけを置く。
# テストはここで消すのではなく、そもそも渡していない（.dockerignore）。
COPY packages/domain/src packages/domain/src
COPY packages/contracts/src packages/contracts/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/api/src packages/api/src
COPY --from=build /app/packages/web/dist packages/web/dist

# pnpm が書き込み先を必要とするため、非 root の利用者の家を明示する。
ENV HOME=/home/node

# 権限昇格の余地を残さないため、非 root で動かす。node は公式イメージが用意する利用者。
USER node

EXPOSE 8787
CMD ["pnpm", "--filter", "@staffweave/api", "start"]
