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
});
