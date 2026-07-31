import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadApiConfig, loadWebhookWorkerConfig } from './config.js';

describe('loadApiConfig', () => {
  it('DATABASE_URL が無ければ設定エラーになる', () => {
    expect(() => loadApiConfig({})).toThrow(ConfigurationError);
  });

  it('既定値を補って設定を返す', () => {
    const config = loadApiConfig({ DATABASE_URL: 'postgres://localhost/staffweave' });
    expect(config).toEqual({
      databaseUrl: 'postgres://localhost/staffweave',
      host: '127.0.0.1',
      port: 8787,
      environment: 'development',
      defaultWorkspaceSlug: 'default',
      cardFingerprintKey: null,
      webDistPath: null,
    });
  });

  it('ポート番号が数値でなければ設定エラーになる', () => {
    expect(() => loadApiConfig({ DATABASE_URL: 'postgres://x', API_PORT: 'eight' })).toThrow(
      ConfigurationError,
    );
  });

  it('ポート番号が範囲外なら設定エラーになる', () => {
    expect(() => loadApiConfig({ DATABASE_URL: 'postgres://x', API_PORT: '70000' })).toThrow(
      ConfigurationError,
    );
  });

  it('未知の NODE_ENV は設定エラーになる', () => {
    expect(() => loadApiConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'staging' })).toThrow(
      ConfigurationError,
    );
  });

  it('Webhook ワーカーの設定が不正でも API は起動できる', () => {
    // API は Webhook を送らない。ワーカーの設定ミスで API まで止めない。
    const config = loadApiConfig({
      DATABASE_URL: 'postgres://x',
      WEBHOOK_SEND_TIMEOUT_MS: '10000',
      WEBHOOK_CLAIM_LEASE_MS: '10000',
      WEBHOOK_WORKER_POLL_INTERVAL_MS: 'いくつか',
    });
    expect(config.databaseUrl).toBe('postgres://x');
  });
});

describe('loadWebhookWorkerConfig', () => {
  it('DATABASE_URL が無ければ設定エラーになる', () => {
    expect(() => loadWebhookWorkerConfig({})).toThrow(ConfigurationError);
  });

  it('既定値を補って設定を返す', () => {
    expect(loadWebhookWorkerConfig({ DATABASE_URL: 'postgres://x' })).toEqual({
      databaseUrl: 'postgres://x',
      pollIntervalMs: 5_000,
      sendTimeoutMs: 10_000,
      claimLeaseMs: 60_000,
    });
  });

  it('環境変数から設定を読む', () => {
    expect(
      loadWebhookWorkerConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_WORKER_POLL_INTERVAL_MS: '500',
        WEBHOOK_SEND_TIMEOUT_MS: '1000',
        WEBHOOK_CLAIM_LEASE_MS: '30000',
      }),
    ).toEqual({
      databaseUrl: 'postgres://x',
      pollIntervalMs: 500,
      sendTimeoutMs: 1000,
      claimLeaseMs: 30_000,
    });
  });

  it('許容範囲外なら設定エラーになる', () => {
    expect(() =>
      loadWebhookWorkerConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_SEND_TIMEOUT_MS: '1.5' }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadWebhookWorkerConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_WORKER_POLL_INTERVAL_MS: '0',
      }),
    ).toThrow(ConfigurationError);
  });

  describe('占有時間と送信上限の関係', () => {
    const lease = (sendTimeoutMs: string, claimLeaseMs: string) =>
      loadWebhookWorkerConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_SEND_TIMEOUT_MS: sendTimeoutMs,
        WEBHOOK_CLAIM_LEASE_MS: claimLeaseMs,
      });

    // 送信の後には結果の記録と完了更新が続く。その猶予が無い設定は受け付けない。
    it('送信上限と同じなら設定エラーになる', () => {
      expect(() => lease('10000', '10000')).toThrow(ConfigurationError);
    });

    it('猶予が 1 ミリ秒しかなければ設定エラーになる', () => {
      expect(() => lease('10000', '10001')).toThrow(ConfigurationError);
    });

    it('猶予が 5000 ミリ秒に足りなければ設定エラーになる', () => {
      expect(() => lease('10000', '14999')).toThrow(ConfigurationError);
    });

    it('猶予がちょうど 5000 ミリ秒なら受け付ける', () => {
      expect(lease('10000', '15000').claimLeaseMs).toBe(15_000);
    });

    it('必要な最小値をエラーへ含める', () => {
      expect(() => lease('10000', '10001')).toThrow(/15000/);
    });
  });
});
