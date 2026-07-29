/**
 * 環境変数の読み取りと検証。
 * ここ以外で process.env を直接参照しない。
 */

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
}

export class ConfigurationError extends Error {}

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new ConfigurationError(`API_PORT の値が不正です: ${raw}`);
  }
  return value;
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
  };
}
