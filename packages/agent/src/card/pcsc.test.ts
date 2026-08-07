/**
 * PC/SC を通した読み取り。
 *
 * ここで固定したいのは 3 つ。
 *
 *   応答の状態語を見て、読めなかったカードを打刻にしないこと
 *   同じカードの連続タップを 1 回として扱うこと
 *   装置が外れても止まらず、間を広げながら開き直すこと
 */
import { describe, expect, it } from 'vitest';
import type { PcscTransport } from './pcsc.js';
import { createPcscCardReader, GET_UID_APDU, parseUid } from './pcsc.js';

function response(uid: readonly number[], status = [0x90, 0x00]): Uint8Array {
  return Uint8Array.from([...uid, ...status]);
}

interface FakeOptions {
  /** 読み取りのたびに返すもの。Error なら投げる。 */
  reads: readonly (Uint8Array | Error)[];
}

function fakeTransport(options: FakeOptions): PcscTransport & {
  reconnects: number;
  removals: number;
  sent: Uint8Array[];
} {
  let index = 0;
  const transport = {
    name: 'fake',
    reconnects: 0,
    removals: 0,
    sent: [] as Uint8Array[],
    async waitForCard(): Promise<void> {},
    async transmit(command: Uint8Array): Promise<Uint8Array> {
      transport.sent.push(command);
      const next = options.reads[index];
      index += 1;
      if (next === undefined) throw new Error('読み取るものがありません');
      if (next instanceof Error) throw next;
      return next;
    },
    async waitForRemoval(): Promise<void> {
      transport.removals += 1;
    },
    async reconnect(): Promise<void> {
      transport.reconnects += 1;
    },
    async close(): Promise<void> {},
  };
  return transport;
}

describe('応答の読み取り', () => {
  it('成功した応答から識別子を取り出す', () => {
    expect(parseUid(response([0x04, 0xa2, 0x3b, 0x1f]))).toBe('04A23B1F');
  });

  it('状態語が成功でなければ断る', () => {
    expect(() => parseUid(response([0x04], [0x6a, 0x82]))).toThrow(/6A82/);
  });

  it('識別子を返さない応答を断る', () => {
    expect(() => parseUid(response([]))).toThrow(/識別子を返しませんでした/);
  });

  it('短すぎる応答を断る', () => {
    expect(() => parseUid(Uint8Array.from([0x90]))).toThrow(/短すぎます/);
  });
});

describe('読み取りのアダプター', () => {
  const noSleep = async (): Promise<void> => {};

  it('カードの識別子を返す', async () => {
    const transport = fakeTransport({ reads: [response([0x04, 0xa2])] });
    const reader = createPcscCardReader(transport, { sleep: noSleep });

    expect(await reader.read()).toBe('04A2');
    expect(transport.sent[0]).toEqual(GET_UID_APDU);
  });

  it('同じカードの連続タップを 1 回として扱う', async () => {
    const transport = fakeTransport({
      reads: [response([0x04, 0xa2]), response([0x04, 0xa2]), response([0x0b, 0x0b])],
    });
    let clock = 0;
    const reader = createPcscCardReader(transport, {
      sleep: noSleep,
      now: () => clock,
      debounceMs: 3_000,
    });

    expect(await reader.read()).toBe('04A2');
    // 1 秒後に同じカード。これは飛ばし、次の別のカードを返す。
    clock = 1_000;
    expect(await reader.read()).toBe('0B0B');
    expect(transport.removals).toBe(1);
  });

  it('時間が経てば、同じカードでも次の打刻として扱う', async () => {
    const transport = fakeTransport({ reads: [response([0x04, 0xa2]), response([0x04, 0xa2])] });
    let clock = 0;
    const reader = createPcscCardReader(transport, {
      sleep: noSleep,
      now: () => clock,
      debounceMs: 3_000,
    });

    expect(await reader.read()).toBe('04A2');
    clock = 5_000;
    expect(await reader.read()).toBe('04A2');
    expect(transport.removals).toBe(0);
  });

  it('読めなかったカードは打刻にせず、読み取りへ戻る', async () => {
    const transport = fakeTransport({
      reads: [response([0x04], [0x6a, 0x82]), response([0x04, 0xa2])],
    });
    const reader = createPcscCardReader(transport, { sleep: noSleep });

    expect(await reader.read()).toBe('04A2');
    expect(transport.reconnects).toBe(1);
  });

  it('装置が外れても止まらず、間を広げながら開き直す', async () => {
    const transport = fakeTransport({
      reads: [
        new Error('装置が外れました'),
        new Error('装置が外れました'),
        new Error('装置が外れました'),
        response([0x04, 0xa2]),
      ],
    });
    const waited: number[] = [];
    const reader = createPcscCardReader(transport, {
      sleep: async (milliseconds) => {
        waited.push(milliseconds);
      },
      reconnectDelaysMs: [10, 20, 40],
    });

    expect(await reader.read()).toBe('04A2');
    expect(waited).toEqual([10, 20, 40]);
    expect(transport.reconnects).toBe(3);
  });

  it('復帰したら、待ちの間隔を最初へ戻す', async () => {
    const transport = fakeTransport({
      reads: [
        new Error('装置が外れました'),
        response([0x04, 0xa2]),
        new Error('装置が外れました'),
        response([0x0b, 0x0b]),
      ],
    });
    const waited: number[] = [];
    const reader = createPcscCardReader(transport, {
      sleep: async (milliseconds) => {
        waited.push(milliseconds);
      },
      reconnectDelaysMs: [10, 20, 40],
    });

    await reader.read();
    await reader.read();

    expect(waited).toEqual([10, 10]);
  });

  it('診断の記録に、カードの識別子を出さない', async () => {
    const transport = fakeTransport({
      reads: [response([0x04], [0x6a, 0x82]), response([0x04, 0xa2])],
    });
    const events: { event: string; detail?: Record<string, unknown> }[] = [];
    const reader = createPcscCardReader(transport, {
      sleep: noSleep,
      log: (entry) => events.push(entry),
    });

    await reader.read();

    expect(events.map((entry) => entry.event)).toContain('card.reader_reconnecting');
    expect(JSON.stringify(events)).not.toContain('04A2');
  });
});
