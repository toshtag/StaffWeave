import { describe, expect, it } from 'vitest';
import { deriveCardFingerprintKey } from './card-fingerprint-key.js';

/**
 * 端末へ配る鍵が Workspace ごとに分かれていることを固定する。
 *
 * 共通の鍵をそのまま配ると、ある Workspace で端末を登録できる者が、
 * 他の Workspace のカード指紋を計算して照合できる。
 */

const MASTER_KEY = 'master-key-for-card-fingerprints';

describe('deriveCardFingerprintKey', () => {
  it('同じ Workspace なら同じ鍵になる', () => {
    expect(deriveCardFingerprintKey(MASTER_KEY, 'workspace-1')).toBe(
      deriveCardFingerprintKey(MASTER_KEY, 'workspace-1'),
    );
  });

  it('Workspace が違えば鍵も違う', () => {
    expect(deriveCardFingerprintKey(MASTER_KEY, 'workspace-1')).not.toBe(
      deriveCardFingerprintKey(MASTER_KEY, 'workspace-2'),
    );
  });

  it('共通の鍵が違えば鍵も違う', () => {
    expect(deriveCardFingerprintKey(MASTER_KEY, 'workspace-1')).not.toBe(
      deriveCardFingerprintKey(`${MASTER_KEY}-2`, 'workspace-1'),
    );
  });

  it('共通の鍵そのものは配らない', () => {
    const derived = deriveCardFingerprintKey(MASTER_KEY, 'workspace-1');

    expect(derived).not.toBe(MASTER_KEY);
    expect(derived).not.toContain(MASTER_KEY);
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
  });
});
