/**
 * 環境変数の読み取りと検証。
 * ここ以外で process.env を直接参照しない。
 */

/** Webhook 送信ワーカーの動作設定。既定値と許容範囲はこの一箇所で決める。 */
export interface WebhookWorkerConfig {
  /** 一度に取り出す送信待ちの件数。 */
  batchSize: number;
  /** 送信待ちが無かったときに次を確かめるまでの間隔。 */
  pollIntervalMs: number;
  /** 1 件の HTTP 送信を打ち切るまでの時間。 */
  sendTimeoutMs: number;
  /** 取り出した送信待ちを占有する時間。過ぎると他のワーカーが引き取れる。 */
  claimLeaseMs: number;
}

export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug: string;
  /**
   * IC カードの指紋を計算するための鍵。
   * データベースへは保存せず、登録時に Agent へ渡す。未設定ならカード機能は使えない。
   */
  cardFingerprintKey: string | null;
  /** ビルド済みの Web を配信する場合の場所。未設定なら配信しない。 */
  webDistPath: string | null;
  webhookWorker: WebhookWorkerConfig;
}

export class ConfigurationError extends Error {}

interface IntegerSetting {
  fallback: number;
  min: number;
  max: number;
}

const WEBHOOK_WORKER_SETTINGS = {
  WEBHOOK_WORKER_BATCH_SIZE: { fallback: 20, min: 1, max: 500 },
  WEBHOOK_WORKER_POLL_INTERVAL_MS: { fallback: 5_000, min: 100, max: 300_000 },
  WEBHOOK_SEND_TIMEOUT_MS: { fallback: 10_000, min: 100, max: 60_000 },
  WEBHOOK_CLAIM_LEASE_MS: { fallback: 60_000, min: 1_000, max: 3_600_000 },
} as const satisfies Record<string, IntegerSetting>;

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new ConfigurationError(`API_PORT の値が不正です: ${raw}`);
  }
  return value;
}

function readInteger(name: string, raw: string | undefined, setting: IntegerSetting): number {
  if (raw === undefined || raw === '') return setting.fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < setting.min || value > setting.max) {
    throw new ConfigurationError(
      `${name} の値が不正です: ${raw}（${setting.min} 以上 ${setting.max} 以下の整数）`,
    );
  }
  return value;
}

function readWebhookWorker(env: NodeJS.ProcessEnv): WebhookWorkerConfig {
  const read = (name: keyof typeof WEBHOOK_WORKER_SETTINGS): number =>
    readInteger(name, env[name], WEBHOOK_WORKER_SETTINGS[name]);

  const config: WebhookWorkerConfig = {
    batchSize: read('WEBHOOK_WORKER_BATCH_SIZE'),
    pollIntervalMs: read('WEBHOOK_WORKER_POLL_INTERVAL_MS'),
    sendTimeoutMs: read('WEBHOOK_SEND_TIMEOUT_MS'),
    claimLeaseMs: read('WEBHOOK_CLAIM_LEASE_MS'),
  };

  // 占有時間が送信の上限より短いと、まだ送信中の行を別のワーカーが引き取ってしまう。
  if (config.claimLeaseMs <= config.sendTimeoutMs) {
    throw new ConfigurationError(
      'WEBHOOK_CLAIM_LEASE_MS は WEBHOOK_SEND_TIMEOUT_MS より大きくしてください',
    );
  }

  return config;
}

function readEnvironment(raw: string | undefined): ApiConfig['environment'] {
  if (raw === undefined || raw === '') return 'development';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new ConfigurationError(`NODE_ENV の値が不正です: ${raw}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigurationError(
      'DATABASE_URL が設定されていません。.env.example を参考に設定してください。',
    );
  }

  return {
    databaseUrl,
    host: env.API_HOST ?? '127.0.0.1',
    port: readPort(env.API_PORT, 8787),
    environment: readEnvironment(env.NODE_ENV),
    defaultWorkspaceSlug: env.DEFAULT_WORKSPACE_SLUG ?? 'default',
    cardFingerprintKey: env.CARD_FINGERPRINT_KEY ?? null,
    webDistPath: env.WEB_DIST_PATH ?? null,
    webhookWorker: readWebhookWorker(env),
  };
}
