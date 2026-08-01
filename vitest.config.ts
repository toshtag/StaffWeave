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
          include: ['packages/*/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/*/test/integration/**/*.test.ts'],
          setupFiles: ['./test/integration-setup.ts'],
          // 同一データベースを共有するため、並列実行せず順番に流す。
          fileParallelism: false,
          // 移行の検査は準備で専用のデータベースを作り、全 migration を複数回流す。
          // 開発機では他の処理と計算資源を分け合うため、余裕を持たせる。
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
