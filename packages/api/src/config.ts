/**
 * 環境変数の読み取りと検証。
 * ここ以外で process.env を直接参照しない。
 *
 * 読み取りはプロセスごとに分ける。API サーバーと Webhook 送信ワーカーは別のプロセスであり、
 * 一方の設定を誤っただけでもう一方が起動できなくなる状態にはしない。
 */

import type { WebhookNetworkPolicyMode } from './integration/webhook-network-policy.js';

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
  /** Webhook 送信先として許すネットワークの範囲。登録時の検査で使う。 */
  webhookNetworkPolicy: WebhookNetworkPolicyMode;
  /** 送信先の登録時に、URL と名前解決を確かめる上限時間。 */
  webhookTargetValidationTimeoutMs: number;
}

/** Webhook 送信ワーカーの動作設定。既定値と許容範囲はこの一箇所で決める。 */
export interface WebhookWorkerConfig {
  databaseUrl: string;
  /** 送信待ちが無かったときに次を確かめるまでの間隔。 */
  pollIntervalMs: number;
  /** 1 件の HTTP 送信を打ち切るまでの時間。 */
  sendTimeoutMs: number;
  /** 送信中の 1 件を占有する時間。過ぎると他のワーカーが引き取れる。 */
  claimLeaseMs: number;
  /** 送信先として許すネットワークの範囲。送信の直前に再検査する。 */
  webhookNetworkPolicy: WebhookNetworkPolicyMode;
}

export class ConfigurationError extends Error {}

interface IntegerSetting {
  fallback: number;
  min: number;
  max: number;
}

/** API が読む整数の設定。ワーカー側とは別に持ち、片方の設定ミスで両方を止めない。 */
const API_SETTINGS = {
  WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS: { fallback: 3_000, min: 100, max: 30_000 },
} as const satisfies Record<string, IntegerSetting>;

const WEBHOOK_WORKER_SETTINGS = {
  WEBHOOK_WORKER_POLL_INTERVAL_MS: { fallback: 5_000, min: 100, max: 300_000 },
  WEBHOOK_SEND_TIMEOUT_MS: { fallback: 10_000, min: 100, max: 60_000 },
  WEBHOOK_CLAIM_LEASE_MS: { fallback: 60_000, min: 1_000, max: 3_600_000 },
} as const satisfies Record<string, IntegerSetting>;

/**
 * 送信を終えてから結果を記録し、送信待ちを完了させるまでに要する時間の見込み。
 * 占有時間が送信の上限にこの猶予を足した値より短いと、正常に送れた場合でも
 * 記録の途中で占有期限が切れ、別のワーカーが同じ行を送り直しやすくなる。
 * これは重複送信を無くす保証ではなく、起こりやすい設定を拒むための下限。
 */
const MIN_WEBHOOK_COMPLETION_GRACE_MS = 5_000;

function readDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigurationError(
      'DATABASE_URL が設定されていません。.env.example を参考に設定してください。',
    );
  }
  return databaseUrl;
}

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

/**
 * 送信先のネットワーク範囲。
 *
 * これは API とワーカーで一致させるべき安全側の設定であり、ワーカー専用の性能設定とは扱いが違う。
 * 誤った値ではどちらのプロセスも起動させない。片方だけが緩い状態を作らないようにする。
 */
function readWebhookNetworkPolicy(raw: string | undefined): WebhookNetworkPolicyMode {
  if (raw === undefined || raw === '') return 'public-only';
  if (raw === 'public-only' || raw === 'allow-local') return raw;
  throw new ConfigurationError(
    `WEBHOOK_NETWORK_POLICY の値が不正です: ${raw}（public-only または allow-local）`,
  );
}

function readEnvironment(raw: string | undefined): ApiConfig['environment'] {
  if (raw === undefined || raw === '') return 'development';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new ConfigurationError(`NODE_ENV の値が不正です: ${raw}`);
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    databaseUrl: readDatabaseUrl(env),
    host: env.API_HOST ?? '127.0.0.1',
    port: readPort(env.API_PORT, 8787),
    environment: readEnvironment(env.NODE_ENV),
    defaultWorkspaceSlug: env.DEFAULT_WORKSPACE_SLUG ?? 'default',
    cardFingerprintKey: env.CARD_FINGERPRINT_KEY ?? null,
    webDistPath: env.WEB_DIST_PATH ?? null,
    webhookNetworkPolicy: readWebhookNetworkPolicy(env.WEBHOOK_NETWORK_POLICY),
    webhookTargetValidationTimeoutMs: readInteger(
      'WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS',
      env.WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS,
      API_SETTINGS.WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS,
    ),
  };
}

export function loadWebhookWorkerConfig(env: NodeJS.ProcessEnv = process.env): WebhookWorkerConfig {
  const read = (name: keyof typeof WEBHOOK_WORKER_SETTINGS): number =>
    readInteger(name, env[name], WEBHOOK_WORKER_SETTINGS[name]);

  const config: WebhookWorkerConfig = {
    databaseUrl: readDatabaseUrl(env),
    pollIntervalMs: read('WEBHOOK_WORKER_POLL_INTERVAL_MS'),
    sendTimeoutMs: read('WEBHOOK_SEND_TIMEOUT_MS'),
    claimLeaseMs: read('WEBHOOK_CLAIM_LEASE_MS'),
    webhookNetworkPolicy: readWebhookNetworkPolicy(env.WEBHOOK_NETWORK_POLICY),
  };

  const required = config.sendTimeoutMs + MIN_WEBHOOK_COMPLETION_GRACE_MS;
  if (config.claimLeaseMs < required) {
    throw new ConfigurationError(
      `WEBHOOK_CLAIM_LEASE_MS は、WEBHOOK_SEND_TIMEOUT_MS に ` +
        `${MIN_WEBHOOK_COMPLETION_GRACE_MS} ミリ秒を加えた値（${required}）以上にしてください`,
    );
  }

  return config;
}
