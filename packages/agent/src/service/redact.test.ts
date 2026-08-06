/**
 * ログへ秘密が出ないことを確かめる。
 *
 * 端末のログは現場に残り、保守のときに人の目に触れる。
 */
import { describe, expect, it } from 'vitest';
import { createAgentLogger, REDACTED, redact } from './redact.js';

describe('ログへ出す値', () => {
  it('秘密らしい名前の値を伏せる', () => {
    expect(
      redact({
        privateKeyPem: '-----BEGIN PRIVATE KEY-----',
        token: 'enroll-token',
        cardFingerprintKey: 'k',
        signature: 's',
        employeeNumber: 'E001',
      }),
    ).toEqual({
      privateKeyPem: REDACTED,
      token: REDACTED,
      cardFingerprintKey: REDACTED,
      signature: REDACTED,
      employeeNumber: 'E001',
    });
  });

  it('区切りの違う書き方でも見分ける', () => {
    expect(redact({ 'x-staffweave-signature': 'v', api_key_secret: 'v' })).toEqual({
      'x-staffweave-signature': REDACTED,
      api_key_secret: REDACTED,
    });
  });

  it('入れ子の中も見る', () => {
    expect(redact({ credentials: { privateKeyPem: 'v', deviceId: 'd' } })).toEqual({
      credentials: { privateKeyPem: REDACTED, deviceId: 'd' },
    });
  });

  it('並びの中も見る', () => {
    expect(redact([{ token: 'v' }, { deviceId: 'd' }])).toEqual([
      { token: REDACTED },
      { deviceId: 'd' },
    ]);
  });

  it('中身の分からないものは、そのまま出さない', () => {
    expect(redact({ handler: () => undefined })).toEqual({ handler: '[function]' });
  });

  it('深すぎる入れ子は打ち切る', () => {
    let nested: Record<string, unknown> = { deviceId: 'd' };
    for (let depth = 0; depth < 10; depth += 1) nested = { inner: nested };

    expect(JSON.stringify(redact(nested))).toContain(REDACTED);
  });

  it('書く側が忘れても、記録を作る時点で伏せる', () => {
    const lines: string[] = [];
    createAgentLogger((line) => lines.push(line)).info('agent.enrolled', {
      deviceId: 'device-1',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----',
    });

    expect(lines[0]).toContain('device-1');
    expect(lines[0]).not.toContain('BEGIN PRIVATE KEY');
  });
});
