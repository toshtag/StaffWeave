import { createHmac } from 'node:crypto';
import { canonicalWebhookMessage } from '@staffweave/domain';
import { describe, expect, it } from 'vitest';
import { deriveWebhookSigningKey, signWebhookMessage } from './webhook-signature.js';

/**
 * 送信側の計算を固定値で押さえる。
 *
 * 期待値は実行時に同じ関数から作らない。作ってしまうと、実装を変えてもテストが追随して
 * 通り続け、受け取り側との食い違いに気付けなくなる。
 * connector 側の単体テストは同じ入力と同じ期待値を持つ。
 */

const SIGNING_SECRET = 'staffweave-webhook-test-secret';
const SIGNING_KEY = '9f28328480464f5f1f78f0ae6caa0a0fa60a1320682be36d787a7cb1eede40fd';

const MESSAGE = {
  eventId: 'event-test-001',
  eventType: 'attendance_request.approved',
  timestamp: '2026-04-01T00:00:00.000Z',
  body: '{"eventId":"event-test-001","eventType":"attendance_request.approved","occurredAt":"2026-04-01T00:00:00.000Z","data":{"requestId":"request-001"}}',
};

const SIGNATURE = 'JH81De/YHN5p9bimzE8FVzUCnDs9JtiZgXYb7fb2iSo=';

describe('deriveWebhookSigningKey', () => {
  it('固定の秘密から固定の鍵を導く', () => {
    expect(deriveWebhookSigningKey(SIGNING_SECRET)).toBe(SIGNING_KEY);
  });

  it('小文字 16 進数 64 文字を返す', () => {
    expect(deriveWebhookSigningKey('another-secret')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じ秘密からは同じ鍵になる', () => {
    expect(deriveWebhookSigningKey(SIGNING_SECRET)).toBe(deriveWebhookSigningKey(SIGNING_SECRET));
  });

  it('異なる秘密からは異なる鍵になる', () => {
    expect(deriveWebhookSigningKey(SIGNING_SECRET)).not.toBe(deriveWebhookSigningKey('other'));
  });
});

describe('signWebhookMessage', () => {
  it('固定の鍵と本文から固定の署名を作る', () => {
    expect(signWebhookMessage(SIGNING_KEY, MESSAGE)).toBe(SIGNATURE);
  });

  it('登録時の秘密から導いた鍵で同じ署名になる', () => {
    expect(signWebhookMessage(deriveWebhookSigningKey(SIGNING_SECRET), MESSAGE)).toBe(SIGNATURE);
  });

  it('署名対象は canonical な文字列だけで決まる', () => {
    const message = canonicalWebhookMessage(MESSAGE);

    expect(message.startsWith('staffweave-webhook/1\n')).toBe(true);
    expect(message.endsWith(MESSAGE.body)).toBe(true);
  });

  it('生のダイジェストを鍵にすると署名が変わる', () => {
    // 16 進数 64 文字をそのまま鍵にする、という取り決めを守れているかを見る。
    // 生の 32 バイトへ変えると、登録済みの送信先の署名がすべて変わってしまう。
    const withRawDigest = createHmac('sha256', Buffer.from(SIGNING_KEY, 'hex'))
      .update(canonicalWebhookMessage(MESSAGE), 'utf8')
      .digest('base64');

    expect(withRawDigest).not.toBe(SIGNATURE);
  });

  it('本文が変われば署名も変わる', () => {
    expect(signWebhookMessage(SIGNING_KEY, { ...MESSAGE, body: `${MESSAGE.body} ` })).not.toBe(
      SIGNATURE,
    );
  });

  it('送信時刻が変われば署名も変わる', () => {
    expect(
      signWebhookMessage(SIGNING_KEY, { ...MESSAGE, timestamp: '2026-04-01T00:00:01.000Z' }),
    ).not.toBe(SIGNATURE);
  });
});
