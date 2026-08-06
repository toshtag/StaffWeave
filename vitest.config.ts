import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// ローカル実行では .env を読み込む。CI などで未配置の場合は環境変数をそのまま使う。
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          // 統合テストの土台（`test/`）もここで流す。
          // 土台が壊れると、原因から遠いファイルが落ちて読み解けなくなる。
          include: ['packages/*/src/**/*.test.ts', 'test/**/*.test.ts'],
          // 2 つをまとめて流すとき（`pnpm test`）は、単体を先に、統合を後に流す。
          // 並べる数が違うものを同じ組へ入れると、vitest はどちらに合わせるかを
          // 決められず、1 件も実行しないまま終わる。
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/*/test/integration/**/*.test.ts'],
          setupFiles: ['./test/integration-setup.ts'],
          // ファイルは並列に流す。ワーカーごとに別のデータベースを使うため、
          // あるファイルの消去が別のファイルのデータへ届かない（test/database-url.ts）。
          //
          // 数を 4 で止める。待っているのは計算ではなく PostgreSQL の応答なので、
          // 枠を増やしても同じ 1 つのサーバーを取り合うだけになる。
          // 止めておくと、作るデータベースの数と接続の数も同じ上限で決まる。
          // 接続は 1 ワーカーあたり最大 10 で、既定の max_connections（100）に収まる。
          maxWorkers: 4,
          sequence: { groupOrder: 1 },
          // 移行の検査は準備で専用のデータベースを作り、全 migration を複数回流す。
          // 開発機では他の処理と計算資源を分け合うため、余裕を持たせる。
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
