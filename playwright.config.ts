import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// ローカル実行では .env を読み込む。CI などで未配置の場合は環境変数をそのまま使う。
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/** 系統ごとに流す検査。ここに無いものは chromium だけで流す。 */
const CROSS_BROWSER_SPECS = ['**/cross-browser.spec.ts', '**/accessibility.spec.ts'];

// 開発サーバーと衝突しないポートを使う。
const API_PORT = '8788';
const WEB_PORT = '5174';

function e2eDatabaseUrl(): string {
  const base =
    process.env.DATABASE_URL ?? 'postgres://staffweave:staffweave@localhost:5433/staffweave';
  const url = new URL(base);
  url.pathname = '/staffweave_e2e';
  return url.toString();
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/setup/prepare-database.ts',
  // 同じデータベースを共有するため、順番に実行する。
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  /*
   * 主要な 3 系統で確かめる。同じ HTML でも、日付の入力欄・焦点の移り方・
   * 書字の折り返しは実装ごとに違う。1 つだけで確かめると、
   * 他の系統でだけ壊れていることに気付けない。
   *
   * ただし全部の検査を 3 回流すことはしない。画面テストは 1 つのデータベースを
   * 共有し、パスワードの変更のように「一度きり」の検査が混ざっている。
   * 二度目からは前提が崩れ、系統の違いではなく順番のせいで落ちる。
   *
   * 系統ごとに流すのは、系統差が出る操作だけを集めた検査に絞る。
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: CROSS_BROWSER_SPECS,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: CROSS_BROWSER_SPECS,
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @staffweave/api start',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        API_PORT,
        API_HOST: '127.0.0.1',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'pnpm --filter @staffweave/web dev',
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT, WEB_PORT },
    },
  ],
});
