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
      webhookNetworkPolicy: 'public-only',
      webhookTargetValidationTimeoutMs: 3_000,
      maxRequestBodyBytes: 256 * 1024,
      maxBulkRequestBodyBytes: 8 * 1024 * 1024,
      allowedOrigins: [],
      loginAttemptPolicy: {
        account: { maxFailures: 5, windowMs: 900_000, blockMs: 900_000 },
        source: { maxFailures: 50, windowMs: 900_000, blockMs: 900_000 },
      },
      trustProxyForClientAddress: false,
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

  describe('IC カードの指紋鍵', () => {
    const key = (raw: string | undefined) =>
      loadApiConfig({
        DATABASE_URL: 'postgres://x',
        ...(raw === undefined ? {} : { CARD_FINGERPRINT_KEY: raw }),
      }).cardFingerprintKey;

    // 空文字を鍵として通すと、鍵を知らない相手でも同じ指紋を計算できる。
    it.each(['', '   '])('空の値 %j は未設定として扱う', (raw) => {
      expect(key(raw)).toBeNull();
    });

    it('短すぎる鍵では起動しない', () => {
      expect(() => key('short-key')).toThrow(ConfigurationError);
      expect(() => key('short-key')).toThrow(/32 文字以上/);
    });

    // 公開されている見本は秘密ではない。長さを満たしていても鍵として使わせない。
    it('見本のままの鍵では起動しない', () => {
      expect(() => key('change-me-to-a-long-random-value')).toThrow(/見本のまま/);
    });

    it('十分な長さの鍵を読む', () => {
      expect(key('a'.repeat(32))).toBe('a'.repeat(32));
    });

    it('前後の空白を落とす', () => {
      expect(key(`  ${'b'.repeat(40)}  `)).toBe('b'.repeat(40));
    });
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

  it('送信先のネットワーク範囲を読む', () => {
    expect(
      loadApiConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_NETWORK_POLICY: 'allow-local' })
        .webhookNetworkPolicy,
    ).toBe('allow-local');
  });

  // 送信先の制限は API とワーカーで一致させる。誤った値では API も起動させない。
  it('送信先のネットワーク範囲が不正なら設定エラーになる', () => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_NETWORK_POLICY: 'disabled' }),
    ).toThrow(ConfigurationError);
  });

  it('登録時の検査の上限時間を読む', () => {
    expect(
      loadApiConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS: '5000',
      }).webhookTargetValidationTimeoutMs,
    ).toBe(5_000);
  });

  it.each(['99', '30001', '3.5', 'すぐ'])(
    '登録時の検査の上限時間が %s なら設定エラーになる',
    (raw) => {
      expect(() =>
        loadApiConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS: raw }),
      ).toThrow(ConfigurationError);
    },
  );

  it('要求本文の上限を読む', () => {
    const config = loadApiConfig({
      DATABASE_URL: 'postgres://x',
      MAX_REQUEST_BODY_BYTES: '65536',
      MAX_BULK_REQUEST_BODY_BYTES: '1048576',
    });
    expect(config.maxRequestBodyBytes).toBe(65_536);
    expect(config.maxBulkRequestBodyBytes).toBe(1_048_576);
  });

  it.each(['0', '4095', '8388609', '1.5', 'おおきめ'])(
    '要求本文の上限が %s なら設定エラーになる',
    (raw) => {
      expect(() =>
        loadApiConfig({ DATABASE_URL: 'postgres://x', MAX_REQUEST_BODY_BYTES: raw }),
      ).toThrow(ConfigurationError);
    },
  );

  it.each(['0', '4095', '134217729'])(
    'まとまった量を受け取る要求の上限が %s なら設定エラーになる',
    (raw) => {
      expect(() =>
        loadApiConfig({ DATABASE_URL: 'postgres://x', MAX_BULK_REQUEST_BODY_BYTES: raw }),
      ).toThrow(ConfigurationError);
    },
  );

  it('許す送信元を読み、表記を揃える', () => {
    expect(
      loadApiConfig({
        DATABASE_URL: 'postgres://x',
        ALLOWED_ORIGINS: 'https://a.example.com/, https://b.example.com:443',
      }).allowedOrigins,
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it.each(['example.com', 'ftp://example.com', 'https://'])(
    '許す送信元が %s なら設定エラーになる',
    (raw) => {
      expect(() => loadApiConfig({ DATABASE_URL: 'postgres://x', ALLOWED_ORIGINS: raw })).toThrow(
        ConfigurationError,
      );
    },
  );

  it('ログイン試行の基準を読む', () => {
    const policy = loadApiConfig({
      DATABASE_URL: 'postgres://x',
      LOGIN_MAX_FAILURES_PER_ACCOUNT: '10',
      LOGIN_MAX_FAILURES_PER_SOURCE: '200',
      LOGIN_FAILURE_WINDOW_MS: '600000',
      LOGIN_BLOCK_MS: '1800000',
    }).loginAttemptPolicy;

    expect(policy.account).toEqual({ maxFailures: 10, windowMs: 600_000, blockMs: 1_800_000 });
    expect(policy.source).toEqual({ maxFailures: 200, windowMs: 600_000, blockMs: 1_800_000 });
  });

  it.each(['2', '101', '5.5', 'すこし'])('利用者ごとの上限が %s なら設定エラーになる', (raw) => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: 'postgres://x', LOGIN_MAX_FAILURES_PER_ACCOUNT: raw }),
    ).toThrow(ConfigurationError);
  });

  it('転送元の頭書きを信用するかを読む', () => {
    const trust = (raw?: string) =>
      loadApiConfig({
        DATABASE_URL: 'postgres://x',
        ...(raw === undefined ? {} : { TRUST_PROXY_FOR_CLIENT_ADDRESS: raw }),
      }).trustProxyForClientAddress;

    expect(trust()).toBe(false);
    expect(trust('true')).toBe(true);
    expect(trust('false')).toBe(false);
  });

  // 直接受ける構成で信用すると、送信元を自由に名乗れて数える意味がなくなる。
  it.each(['yes', '1', 'True'])('転送元の設定が %s なら設定エラーになる', (raw) => {
    expect(() =>
      loadApiConfig({ DATABASE_URL: 'postgres://x', TRUST_PROXY_FOR_CLIENT_ADDRESS: raw }),
    ).toThrow(ConfigurationError);
  });

  it('経路を含む指定はオリジンだけを見る', () => {
    expect(
      loadApiConfig({
        DATABASE_URL: 'postgres://x',
        ALLOWED_ORIGINS: 'https://example.com/staffweave',
      }).allowedOrigins,
    ).toEqual(['https://example.com']);
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
      webhookNetworkPolicy: 'public-only',
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
      webhookNetworkPolicy: 'public-only',
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

  it('送信先のネットワーク範囲を読む', () => {
    expect(
      loadWebhookWorkerConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_NETWORK_POLICY: 'allow-local',
      }).webhookNetworkPolicy,
    ).toBe('allow-local');
  });

  it('送信先のネットワーク範囲が不正なら許容値を添えて設定エラーになる', () => {
    expect(() =>
      loadWebhookWorkerConfig({ DATABASE_URL: 'postgres://x', WEBHOOK_NETWORK_POLICY: 'invalid' }),
    ).toThrow(/public-only または allow-local/);
  });

  // 登録時の検査は API だけが行う。ワーカーは送信全体の上限時間を使う。
  it('登録時の検査の上限時間が不正でもワーカーは起動できる', () => {
    expect(
      loadWebhookWorkerConfig({
        DATABASE_URL: 'postgres://x',
        WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS: 'すぐ',
      }).sendTimeoutMs,
    ).toBe(10_000);
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
