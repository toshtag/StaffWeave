# staffweave の API と画面を 1 つのイメージで動かす。
#
# 画面はビルドした静的ファイルを API が配信する。
# 別々に置きたい場合は dist をそのまま任意の配信先へコピーできる。
#
# 段は 4 つに分ける。前の段ほど変わりにくいものを置き、後ろの段ほど頻繁に
# 変わるものを置く。ソースを 1 行変えたときに作り直す範囲を、最後の数段に留める。
#
#   base       実行環境
#   manifests  依存の宣言だけ
#   build      画面のビルド
#   runtime    動かすのに要るものだけ。配る対象はこの段
#
# 開発用の依存（TypeScript、Vitest、Biome）とテストは実行段へ入れない。
# API は tsx で TypeScript をそのまま実行するため、tsx だけは実行時の依存として持つ。

FROM node:24-alpine AS base
WORKDIR /app

# corepack が取り寄せた pnpm の置き場。既定は利用者の家の下にある。
# 実行段ではここを cache mount で渡し、イメージへは残さない。
ENV COREPACK_HOME=/opt/corepack

COPY package.json ./

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
# package.json の packageManager が指す版を取り寄せる。この段は配らないため、
# 置き場をそのまま持たせてよい。
RUN corepack enable && corepack install

COPY --from=manifests /app /app

# 画面のビルドに要る分だけを入れる。API 側の依存はここでは要らない。
#
# この段は配らないため、置き場ごと cache mount で渡す。二度目からは取りに行かない。
RUN --mount=type=cache,target=/pnpm/store \
  --mount=type=cache,target=/root/.cache \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store --filter "@staffweave/web..."

COPY packages/domain/src packages/domain/src
COPY packages/contracts/src packages/contracts/src
COPY packages/web packages/web
RUN pnpm --filter "@staffweave/web" build

FROM base AS runtime
ENV NODE_ENV=production
# tsx は @staffweave/api の実行時の依存として入る。ここを通して名前で呼べるようにする。
ENV PATH=/app/packages/api/node_modules/.bin:$PATH

COPY --from=manifests /app /app

# 実行に要る依存だけを入れる。--prod は devDependencies を入れない。
#
# 取得はこの段で行う。別の段で入れて写す形にすると、pnpm が同じ中身へ張った
# 硬いリンクが写す時にほどけ、10MB のバイナリが二重にイメージへ残る。
# 置き場も同じ理由で層の中に置き、リンク元だけを同じ層のうちに消す。
#
# 取り寄せの控えと pnpm 本体は cache mount で渡す。控えが残っていれば、
# 置き場を作り直す時も取りに行かずに済む。どちらも層へは残らない。
#
# 動かすのに使うのは tsx だけで、間に pnpm を立てる必要がない。
# 実行段へ pnpm を置くと、要らない 37MB を配ったうえ、置き場を消した形では
# コンテナを起動するたびに取り寄せ直し、通信できない環境では起動に失敗する。
RUN --mount=type=cache,target=/root/.cache \
  --mount=type=cache,target=/opt/corepack \
  corepack enable \
  && corepack install \
  && pnpm install --frozen-lockfile --prod --filter "@staffweave/api..." \
  && rm -rf "$(pnpm store path)" \
  && corepack disable

# 動かすのに要るソースと成果物だけを置く。
# テストはここで消すのではなく、そもそも渡していない（.dockerignore）。
COPY packages/domain/src packages/domain/src
COPY packages/contracts/src packages/contracts/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/api/src packages/api/src
COPY --from=build /app/packages/web/dist packages/web/dist

# 非 root の利用者の家を明示する。指定しないと / を家として扱う。
ENV HOME=/home/node

# 権限昇格の余地を残さないため、非 root で動かす。node は公式イメージが用意する利用者。
USER node

EXPOSE 8787
# 設定は compose の environment から渡す。イメージへ .env は入れないため、
# --env-file-if-exists を付けても「見つからない」と毎回二行書くだけになる。
CMD ["tsx", "packages/api/src/server.ts"]
