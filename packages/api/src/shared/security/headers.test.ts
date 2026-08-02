import { describe, expect, it } from 'vitest';
import { stubDatabase } from '../../../test/support/fake-database.js';
import { createApp } from '../../app.js';
import { silentLogger } from '../logger.js';

function app(useSecureCookie = false) {
  return createApp({ db: stubDatabase(), logger: silentLogger, useSecureCookie });
}

describe('防御用のヘッダー', () => {
  it('API の応答へ付く', async () => {
    const response = await app().request('/api/health');
    const csp = response.headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it('経路が無い応答にも付く（画面を配る経路を含む）', async () => {
    const response = await app().request('/');

    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('HTTPS で終端する構成でだけ Strict-Transport-Security を送る', async () => {
    expect((await app(false).request('/api/health')).headers.get('strict-transport-security')).toBe(
      null,
    );
    expect((await app(true).request('/api/health')).headers.get('strict-transport-security')).toBe(
      'max-age=15552000; includeSubDomains',
    );
  });

  it('API の応答を保管させない', async () => {
    const response = await app().request('/api/health');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
