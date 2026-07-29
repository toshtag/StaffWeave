# staffweave の API と Web を 1 つのイメージで動かす。
#
# Web はビルドした静的ファイルを API が配信する。
# 別々に置きたい場合は dist をそのまま任意の配信先へコピーできる。

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

RUN corepack enable
COPY --from=build /app /app

# 実行に不要な検証用の資材は含めない。
RUN rm -rf e2e playwright.config.ts test

EXPOSE 8787
CMD ["pnpm", "--filter", "@staffweave/api", "start"]
