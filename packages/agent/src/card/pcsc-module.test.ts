/**
 * 装置との受け渡しの読み込み。
 *
 * 形が合わない相手は、打刻の途中ではなく読み込みの時点で断る。
 * 途中で落ちると、端末の前の人が何が起きたのかを判断できない。
 */
import { describe, expect, it } from 'vitest';
import type { PcscTransport } from './pcsc.js';
import { loadPcscTransport } from './pcsc-module.js';

function transport(): PcscTransport {
  return {
    name: 'fake',
    async waitForCard() {},
    async transmit() {
      return Uint8Array.from([0x90, 0x00]);
    },
    async waitForRemoval() {},
    async reconnect() {},
    async close() {},
  };
}

describe('装置との受け渡しの読み込み', () => {
  it('取り決めどおりの相手を読み込む', async () => {
    const loaded = await loadPcscTransport('fake', async () => ({
      createPcscTransport: () => transport(),
    }));

    expect(loaded.name).toBe('fake');
  });

  it('読み込めない相手は、場所を添えて断る', async () => {
    await expect(
      loadPcscTransport('missing', async () => {
        throw new Error('見つかりません');
      }),
    ).rejects.toThrow(/missing/);
  });

  it('約束した関数が無い相手を断る', async () => {
    await expect(loadPcscTransport('fake', async () => ({}))).rejects.toThrow(
      /createPcscTransport がありません/,
    );
  });

  it('形の合わないものを返す相手を断る', async () => {
    await expect(
      loadPcscTransport('fake', async () => ({ createPcscTransport: () => ({ name: 'fake' }) })),
    ).rejects.toThrow(/PcscTransport の形ではありません/);
  });

  /**
   * ファイルの場所は、`import` が受け取れる形へ直してから渡すこと。
   *
   * Windows の絶対パス（`D:\...`）をそのまま渡すと、`d:` という仕組みの名前だと
   * 読まれて断られる。実際に、常駐が上がらない形で出た。
   */
  it('ファイルの場所を file URL へ直して渡す', async () => {
    const seen: string[] = [];
    await loadPcscTransport('/opt/staffweave/transport.js', async (specifier) => {
      seen.push(specifier);
      return { createPcscTransport: () => transport() };
    });

    expect(seen[0]?.startsWith('file:')).toBe(true);
  });

  it('名前で指す部品は、そのまま渡す', async () => {
    const seen: string[] = [];
    await loadPcscTransport('pcsclite', async (specifier) => {
      seen.push(specifier);
      return { createPcscTransport: () => transport() };
    });

    expect(seen[0]).toBe('pcsclite');
  });
});
