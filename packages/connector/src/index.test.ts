import { describe, expect, it } from 'vitest';
import { createConnector, deriveWebhookSigningKey, verifyWebhook } from './index.js';

/**
 * 受け取り側の計算を固定値で押さえる。
 *
 * 入力と期待値は `packages/api/src/integration/webhook-signature.test.ts` と同じもので、
 * どちらも実行時に計算し直さない。両方が同じ固定値を通ることが、
 * 送信側と受信側で計算が食い違っていないことの担保になる。
 */

const SIGNING_SECRET = 'staffweave-webhook-test-secret';
const SIGNING_KEY = '9f28328480464f5f1f78f0ae6caa0a0fa60a1320682be36d787a7cb1eede40fd';

const BODY =
  '{"eventId":"event-test-001","eventType":"attendance_request.approved","occurredAt":"2026-04-01T00:00:00.000Z","data":{"requestId":"request-001"}}';

const HEADERS = {
  'x-staffweave-event': 'attendance_request.approved',
  'x-staffweave-event-id': 'event-test-001',
  'x-staffweave-timestamp': '2026-04-01T00:00:00.000Z',
  'x-staffweave-signature': 'JH81De/YHN5p9bimzE8FVzUCnDs9JtiZgXYb7fb2iSo=',
};

const NOW = new Date('2026-04-01T00:00:00.000Z');

function verify(
  overrides: { headers?: Partial<typeof HEADERS>; body?: string; secret?: string; now?: Date } = {},
) {
  return verifyWebhook(
    overrides.secret ?? SIGNING_SECRET,
    { headers: { ...HEADERS, ...overrides.headers }, body: overrides.body ?? BODY },
    { now: overrides.now ?? NOW },
  );
}

describe('deriveWebhookSigningKey', () => {
  it('固定の秘密から固定の鍵を導く', () => {
    expect(deriveWebhookSigningKey(SIGNING_SECRET)).toBe(SIGNING_KEY);
  });

  it('小文字 16 進数 64 文字を返す', () => {
    expect(deriveWebhookSigningKey('another-secret')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('異なる秘密からは異なる鍵になる', () => {
    expect(deriveWebhookSigningKey(SIGNING_SECRET)).not.toBe(deriveWebhookSigningKey('other'));
  });
});

describe('verifyWebhook', () => {
  it('送信側が作った固定の署名を検証できる', () => {
    const verified = verify();

    expect(verified.eventId).toBe('event-test-001');
    expect(verified.eventType).toBe('attendance_request.approved');
    expect(verified.occurredAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('別の秘密では検証できない', () => {
    expect(() => verify({ secret: 'another-secret' })).toThrow(/署名が一致しません/);
  });

  it('本文を書き換えると検証できない', () => {
    expect(() => verify({ body: BODY.replace('request-001', 'request-002') })).toThrow(
      /署名が一致しません/,
    );
  });

  it('出来事の識別子を書き換えると検証できない', () => {
    expect(() => verify({ headers: { 'x-staffweave-event-id': 'event-test-002' } })).toThrow(
      /署名が一致しません/,
    );
  });

  it('出来事の種別を書き換えると検証できない', () => {
    expect(() => verify({ headers: { 'x-staffweave-event': 'monthly_closing.closed' } })).toThrow(
      /署名が一致しません/,
    );
  });

  it('送信時刻を書き換えると検証できない', () => {
    expect(() =>
      verify({ headers: { 'x-staffweave-timestamp': '2026-04-01T00:00:01.000Z' } }),
    ).toThrow(/署名が一致しません/);
  });

  it('許容範囲の内側なら受け付ける', () => {
    expect(verify({ now: new Date('2026-04-01T00:04:59.000Z') }).eventId).toBe('event-test-001');
  });

  it('許容範囲を超えた通知は受け付けない', () => {
    expect(() => verify({ now: new Date('2026-04-01T00:05:01.000Z') })).toThrow(/送信時刻/);
  });

  it('署名に必要なヘッダーが欠けていれば受け付けない', () => {
    expect(() => verify({ headers: { 'x-staffweave-signature': undefined } })).toThrow(
      /ヘッダーが足りません/,
    );
  });

  it('未知の種別は受け付けない', () => {
    expect(() => verify({ headers: { 'x-staffweave-event': 'unknown.event' } })).toThrow(
      /未知の出来事/,
    );
  });
});

/**
 * API キーはすべての要求へ付く。接続先が暗号化されていなければ、
 * キーも取り出すデータもそのまま観測できる。
 *
 * ここでは要求を出さない。生成の時点で断ることを固定する。
 */
describe('createConnector', () => {
  const apiKey = 'sw_00000000_connector-test-key';

  it.each([
    'http://staffweave.example',
    'http://203.0.113.10:8787',
    'http://10.0.0.1:8787',
    'http://[2001:db8::1]:8787',
  ])('ループバック以外の http %s では作らない', (baseUrl) => {
    expect(() => createConnector({ baseUrl, apiKey })).toThrow(/https/);
  });

  it.each(['https://staffweave.example', 'http://127.0.0.1:8787', 'http://localhost:8787'])(
    '%s なら作れる',
    (baseUrl) => {
      expect(() => createConnector({ baseUrl, apiKey })).not.toThrow();
    },
  );

  it('URL 内の認証情報を断る', () => {
    expect(() =>
      createConnector({ baseUrl: 'https://user:secret@staffweave.example', apiKey }),
    ).toThrow(/認証情報/);
  });

  it('断る理由に API キーを含めない', () => {
    const error = (() => {
      try {
        createConnector({ baseUrl: 'http://staffweave.example', apiKey });
        return null;
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    expect(error?.message).not.toContain(apiKey);
  });
});
