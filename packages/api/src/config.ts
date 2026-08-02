/**
 * 環境変数の読み取りと検証。
 * ここ以外で process.env を直接参照しない。
 *
 * 読み取りはプロセスごとに分ける。API サーバーと Webhook 送信ワーカーは別のプロセスであり、
 * 一方の設定を誤っただけでもう一方が起動できなくなる状態にはしない。
 */

import { DEFAULT_API_KEY_USAGE_INTERVAL_MS } from '@staffweave/domain';
import type { WebhookNetworkPolicyMode } from './integration/webhook-network-policy.js';
import {
  DEFAULT_BULK_REQUEST_BODY_MAX_BYTES,
  DEFAULT_REQUEST_BODY_MAX_BYTES,
} from './shared/security/body-limit.js';
import type { LoginAttemptPolicies } from './shared/security/login-attempts.js';
import { DEFAULT_LOGIN_ATTEMPT_POLICY } from './shared/security/login-attempts.js';
import { normalizeOrigin } from './shared/security/origin.js';

export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug: string;
  /**
   * IC カードの指紋鍵の元になる共通の鍵。
   *
   * データベースへは保存しない。端末へ渡すのはここから Workspace ごとに導出した鍵で、
   * この値そのものではない。未設定ならカード機能は無効になる。
   */
  cardFingerprintKey: string | null;
  /** ビルド済みの Web を配信する場合の場所。未設定なら配信しない。 */
  webDistPath: string | null;
  /** Webhook 送信先として許すネットワークの範囲。登録時の検査で使う。 */
  webhookNetworkPolicy: WebhookNetworkPolicyMode;
  /** 送信先の登録時に、URL と名前解決を確かめる上限時間。 */
  webhookTargetValidationTimeoutMs: number;
  /** ふつうの要求の本文の上限。 */
  maxRequestBodyBytes: number;
  /** CSV の取り込みなど、まとまった量を受け取る要求の本文の上限。 */
  maxBulkRequestBodyBytes: number;
  /**
   * Cookie の資格情報を使う要求で許す送信元。
   * 空なら、要求が届いた宛先と同じホストだけを許す。
   */
  allowedOrigins: string[];
  /** ログインの失敗を何回まで受け付けるか。 */
  loginAttemptPolicy: LoginAttemptPolicies;
  /** 逆プロキシが付ける転送元の頭書きを信用するか。 */
  trustProxyForClientAddress: boolean;
  /** API キーの最後に使った時刻を書き直す間隔。 */
  apiKeyUsageIntervalMs: number;
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
  // 下限は、この製品がふつうに送る要求（打刻・認証）が通る大きさ。
  // 上限は、1 つの要求で確保させてよいメモリの目安。
  MAX_REQUEST_BODY_BYTES: {
    fallback: DEFAULT_REQUEST_BODY_MAX_BYTES,
    min: 4 * 1024,
    max: 8 * 1024 * 1024,
  },
  MAX_BULK_REQUEST_BODY_BYTES: {
    fallback: DEFAULT_BULK_REQUEST_BODY_MAX_BYTES,
    min: 4 * 1024,
    max: 128 * 1024 * 1024,
  },
  // 下限は、書き込みをまとめる意味が出る間隔。上限は、使われているキーを
  // 使われていないものと読み違えない長さ。
  API_KEY_USAGE_INTERVAL_MS: {
    fallback: DEFAULT_API_KEY_USAGE_INTERVAL_MS,
    min: 1_000,
    max: 24 * 60 * 60 * 1000,
  },
  // 少なすぎると打ち間違いで締め出す。多すぎると総当たりを妨げられない。
  LOGIN_MAX_FAILURES_PER_ACCOUNT: {
    fallback: DEFAULT_LOGIN_ATTEMPT_POLICY.account.maxFailures,
    min: 3,
    max: 100,
  },
  LOGIN_MAX_FAILURES_PER_SOURCE: {
    fallback: DEFAULT_LOGIN_ATTEMPT_POLICY.source.maxFailures,
    min: 5,
    max: 10_000,
  },
  LOGIN_FAILURE_WINDOW_MS: {
    fallback: DEFAULT_LOGIN_ATTEMPT_POLICY.account.windowMs,
    min: 60_000,
    max: 24 * 60 * 60 * 1000,
  },
  LOGIN_BLOCK_MS: {
    fallback: DEFAULT_LOGIN_ATTEMPT_POLICY.account.blockMs,
    min: 60_000,
    max: 24 * 60 * 60 * 1000,
  },
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

/**
 * IC カードの指紋鍵に求める最小の長さ。
 * 短い鍵は総当たりで求められ、指紋から元のカード識別子を言い当てられる。
 */
const MIN_CARD_FINGERPRINT_KEY_LENGTH = 32;

/**
 * 鍵として受け付けない値。
 * 0.0.0 の .env.example が配っていた見本で、公開されているため秘密ではない。
 */
const PUBLISHED_CARD_FINGERPRINT_KEYS: readonly string[] = ['change-me-to-a-long-random-value'];

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

/**
 * IC カードの指紋鍵。
 *
 * 空白だけの値は未設定として扱う。`??` では空文字が鍵として通り、
 * 鍵を知らない相手でも同じ指紋を計算できる状態のまま起動してしまうため。
 * 未設定ならカード機能を無効にし、短すぎる値は起動時に断る。
 */
function readCardFingerprintKey(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (value.length < MIN_CARD_FINGERPRINT_KEY_LENGTH) {
    throw new ConfigurationError(
      `CARD_FINGERPRINT_KEY が短すぎます（${MIN_CARD_FINGERPRINT_KEY_LENGTH} 文字以上）。` +
        'openssl rand -hex 32 の出力のような、推測できない値を設定してください。',
    );
  }
  if (PUBLISHED_CARD_FINGERPRINT_KEYS.includes(value)) {
    throw new ConfigurationError(
      'CARD_FINGERPRINT_KEY が見本のままです。' +
        'openssl rand -hex 32 の出力のような、推測できない値を設定してください。',
    );
  }
  return value;
}

/**
 * 許す送信元の一覧。
 *
 * 逆プロキシが `Host` を書き換える構成では、実際に画面が置かれるオリジンを並べる。
 * 誤った値では起動させない。黙って読み飛ばすと、意図した送信元だけを許したつもりで
 * すべての送信元を許した状態になる。
 */
function readAllowedOrigins(raw: string | undefined): string[] {
  const values = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  return values.map((value) => {
    const normalized = normalizeOrigin(value);
    if (normalized === null) {
      throw new ConfigurationError(
        `ALLOWED_ORIGINS に解釈できない値があります: ${value}` +
          '（https://example.com のような、経路を含まない形で指定してください）',
      );
    }
    return normalized;
  });
}

/**
 * 真偽値の設定。
 *
 * 未知の値は起動を止める。`no` や `off` を「偽」と読み替える実装にすると、
 * 書いた側の意図と食い違ったまま動いてしまう。
 */
function readBoolean(name: string, raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigurationError(`${name} の値が不正です: ${raw}（true または false）`);
}

/**
 * ログインの失敗を数える基準。
 *
 * 窓と断る時間は単位で分けない。運用者が把握する値を増やさないため。
 * 回数だけを分け、送信元は共有回線を巻き込まないよう緩くする。
 */
function readLoginAttemptPolicy(env: NodeJS.ProcessEnv): LoginAttemptPolicies {
  const windowMs = readInteger(
    'LOGIN_FAILURE_WINDOW_MS',
    env.LOGIN_FAILURE_WINDOW_MS,
    API_SETTINGS.LOGIN_FAILURE_WINDOW_MS,
  );
  const blockMs = readInteger('LOGIN_BLOCK_MS', env.LOGIN_BLOCK_MS, API_SETTINGS.LOGIN_BLOCK_MS);

  return {
    account: {
      maxFailures: readInteger(
        'LOGIN_MAX_FAILURES_PER_ACCOUNT',
        env.LOGIN_MAX_FAILURES_PER_ACCOUNT,
        API_SETTINGS.LOGIN_MAX_FAILURES_PER_ACCOUNT,
      ),
      windowMs,
      blockMs,
    },
    source: {
      maxFailures: readInteger(
        'LOGIN_MAX_FAILURES_PER_SOURCE',
        env.LOGIN_MAX_FAILURES_PER_SOURCE,
        API_SETTINGS.LOGIN_MAX_FAILURES_PER_SOURCE,
      ),
      windowMs,
      blockMs,
    },
  };
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
    cardFingerprintKey: readCardFingerprintKey(env.CARD_FINGERPRINT_KEY),
    webDistPath: env.WEB_DIST_PATH ?? null,
    webhookNetworkPolicy: readWebhookNetworkPolicy(env.WEBHOOK_NETWORK_POLICY),
    webhookTargetValidationTimeoutMs: readInteger(
      'WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS',
      env.WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS,
      API_SETTINGS.WEBHOOK_TARGET_VALIDATION_TIMEOUT_MS,
    ),
    maxRequestBodyBytes: readInteger(
      'MAX_REQUEST_BODY_BYTES',
      env.MAX_REQUEST_BODY_BYTES,
      API_SETTINGS.MAX_REQUEST_BODY_BYTES,
    ),
    maxBulkRequestBodyBytes: readInteger(
      'MAX_BULK_REQUEST_BODY_BYTES',
      env.MAX_BULK_REQUEST_BODY_BYTES,
      API_SETTINGS.MAX_BULK_REQUEST_BODY_BYTES,
    ),
    allowedOrigins: readAllowedOrigins(env.ALLOWED_ORIGINS),
    loginAttemptPolicy: readLoginAttemptPolicy(env),
    trustProxyForClientAddress: readBoolean(
      'TRUST_PROXY_FOR_CLIENT_ADDRESS',
      env.TRUST_PROXY_FOR_CLIENT_ADDRESS,
    ),
    apiKeyUsageIntervalMs: readInteger(
      'API_KEY_USAGE_INTERVAL_MS',
      env.API_KEY_USAGE_INTERVAL_MS,
      API_SETTINGS.API_KEY_USAGE_INTERVAL_MS,
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
