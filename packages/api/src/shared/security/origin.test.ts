import { describe, expect, it } from 'vitest';
import { stubDatabase } from '../../../test/support/fake-database.js';
import { createApp } from '../../app.js';
import { SESSION_COOKIE_NAME } from '../../identity/routes.js';
import { silentLogger } from '../logger.js';
import { normalizeOrigin } from './origin.js';

function app(allowedOrigins: readonly string[] = []) {
  return createApp({ db: stubDatabase(), logger: silentLogger, allowedOrigins });
}

const COOKIE = `${SESSION_COOKIE_NAME}=dummy-session-token`;
const HOST = 'staffweave.example.com';

/** 打刻（状態を変える経路）を、指定した頭書きで叩く。 */
async function punch(
  instance: ReturnType<typeof app>,
  headers: Record<string, string>,
): Promise<Response> {
  return instance.request('/api/attendance/events', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ eventType: 'clock_in', requestId: 'origin-check-1' }),
  });
}

describe('送信元の検査', () => {
  it('別のオリジンからの状態変更を断る', async () => {
    const response = await punch(app(), { cookie: COOKIE, origin: 'https://wiki.example.com' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'forbidden', message: '要求元を確認できません' },
    });
  });

  it('同じホストからの状態変更は通す', async () => {
    const response = await punch(app(), { cookie: COOKIE, origin: `https://${HOST}` });

    // セッションは実在しないため 401 になるが、送信元では断られない。
    expect(response.status).toBe(401);
  });

  it('明示的に許したオリジンは通す', async () => {
    const response = await punch(app(['https://portal.example.com']), {
      cookie: COOKIE,
      origin: 'https://portal.example.com',
    });

    expect(response.status).toBe(401);
  });

  it('許すオリジンを指定したら、宛先と同じホストでも自動では通さない', async () => {
    const response = await punch(app(['https://portal.example.com']), {
      cookie: COOKIE,
      origin: `https://${HOST}`,
    });

    expect(response.status).toBe(403);
  });

  it('Cookie を送らない要求は検査の対象にしない', async () => {
    // 端末の署名や API キーで来る要求は、ブラウザの資格情報を使わない。
    const response = await punch(app(), { origin: 'https://wiki.example.com' });

    expect(response.status).toBe(401);
  });

  it('読み取りは検査の対象にしない', async () => {
    const response = await app().request('/api/auth/session', {
      method: 'GET',
      headers: { host: HOST, cookie: COOKIE, origin: 'https://wiki.example.com' },
    });

    expect(response.status).toBe(401);
  });

  it('Origin を持たない要求は通す', async () => {
    const response = await punch(app(), { cookie: COOKIE });

    expect(response.status).toBe(401);
  });

  it('解釈できない Origin を断る', async () => {
    for (const origin of ['null', 'file://', 'ftp://example.com', 'example.com']) {
      const response = await punch(app(), { cookie: COOKIE, origin });
      expect(response.status).toBe(403);
    }
  });
});

describe('normalizeOrigin', () => {
  it('表記の揺れを吸収する', () => {
    expect(normalizeOrigin('https://example.com/')).toBe('https://example.com');
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com');
    expect(normalizeOrigin('http://example.com:8787')).toBe('http://example.com:8787');
  });

  it('http と https 以外を受け付けない', () => {
    expect(normalizeOrigin('ftp://example.com')).toBe(null);
    expect(normalizeOrigin('null')).toBe(null);
    expect(normalizeOrigin('')).toBe(null);
  });
});
