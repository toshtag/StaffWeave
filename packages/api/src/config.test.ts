import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('DATABASE_URL が無ければ設定エラーになる', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
  });

  it('既定値を補って設定を返す', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://localhost/staffweave' });
    expect(config).toEqual({
      databaseUrl: 'postgres://localhost/staffweave',
      host: '127.0.0.1',
      port: 8787,
      environment: 'development',
      defaultWorkspaceSlug: 'default',
      cardFingerprintKey: null,
      webDistPath: null,
      webhookWorker: {
        batchSize: 20,
        pollIntervalMs: 5_000,
        sendTimeoutMs: 10_000,
        claimLeaseMs: 60_000,
      },
    });
  });

  it('ポート番号が数値でなければ設定エラーになる', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', API_PORT: 'eight' })).toThrow(
      ConfigurationError,
    );
  });

  it('ポート番号が範囲外なら設定エラーになる', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', API_PORT: '70000' })).toThrow(
      ConfigurationError,
    );
  });

  it('未知の NODE_ENV は設定エラーになる', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'staging' })).toThrow(
      ConfigurationError,
    );
  });

  it('Webhook ワーカーの設定を環境変数から読む', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      WEBHOOK_WORKER_BATCH_SIZE: '5',
      WEBHOOK_WORKER_POLL_INTERVAL_MS: '500',
      WEBHOOK_SEND_TIMEOUT_MS: '1000',
      WEBHOOK_CLAIM_LEASE_MS: '30000',
    });
    expect(config.webhookWorker).toEqual({
      batchSize: 5,
      pollIntervalMs: 500,
      sendTimeoutMs: 1000,
      claimLeaseMs: 30_000,
    });
  });

  it('Webhook ワーカーの設定が許容範囲外なら設定エラーになる', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_WORKER_BATCH_SIZE: '0' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_SEND_TIMEOUT_MS: '1.5' }),
    ).toThrow(ConfigurationError);
  });

  it('占有時間が送信の上限以下なら設定エラーになる', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_SEND_TIMEOUT_MS: '10000',
        WEBHOOK_CLAIM_LEASE_MS: '10000',
      }),
    ).toThrow(ConfigurationError);
  });
});
