/**
 * 据え置きの端末を、長く動かし続けても壊れないこと。
 *
 * 端末は何か月も電源を入れたまま置かれます。1 回の打刻では出ない問題が、
 * 繰り返すうちに積み上がって出ます。ここで見るのは 2 つ。
 *
 *   止めろと言われたら、カードを待っている途中でも戻ってくること
 *   繰り返し読んでも、積む数と連番が崩れないこと
 *
 * 装置の側の待ち受けが溜まらないことは、受け渡しの検査
 * （`card/pcsc-winscard.test.ts`）で見ています。
 */
import { describe, expect, it, vi } from 'vitest';
import { createPcscCardReader, type PcscTransport } from '../card/pcsc.js';
import { CardReadAborted, createScriptedCardReader } from '../card/reader.js';
import { createAgentLogger } from './redact.js';
import type { Spool, SpooledPunch } from './spool.js';
import { runCardStation } from './station.js';

function memorySpool(): Spool & { entries: SpooledPunch[] } {
  const entries: SpooledPunch[] = [];
  return {
    entries,
    add: async (punch) => {
      entries.push(punch);
    },
    list: async () => [...entries],
    remove: async () => {},
    listUnreadable: async () => [],
  };
}

/**
 * 何度でもカードを返す読み取り装置。
 *
 * `createScriptedCardReader` は与えた枚数で尽きる。繰り返しの検査では、
 * 尽きた時点で別の失敗へ変わってしまう。
 */
function repeatingReader(cardId: string): {
  name: string;
  read: (signal?: AbortSignal) => Promise<string>;
} {
  return {
    name: 'repeating',
    read: async (signal) => {
      if (signal?.aborted === true) throw new CardReadAborted();
      return cardId;
    },
  };
}

/** カードが来ないまま待ち続ける装置。据え置きの端末の、ほとんどの時間。 */
function idleTransport(): PcscTransport {
  return {
    name: 'idle',
    waitForCard: (signal) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new CardReadAborted());
          return;
        }
        signal?.addEventListener('abort', () => reject(new CardReadAborted()), { once: true });
      }),
    transmit: async () => Uint8Array.from([0x90, 0x00]),
    waitForRemoval: async () => {},
    reconnect: async () => {},
    close: async () => {},
  };
}

describe('長く動かし続ける', () => {
  it('カードを待っている途中でも、止めろと言われれば戻る', async () => {
    const stopper = new AbortController();
    const reader = createPcscCardReader(idleTransport());
    let running = true;

    const station = runCardStation({
      reader,
      spool: memorySpool(),
      logger: createAgentLogger(),
      fingerprint: (raw) => raw,
      allocateSequence: async () => 1,
      running: () => running,
      signal: stopper.signal,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    // 待ちに入るところまで進める。
    await new Promise((resolve) => setTimeout(resolve, 10));

    running = false;
    stopper.abort();

    // 打ち切りが届かなければ、ここで時間切れになる。
    await expect(station).resolves.toBeUndefined();
  });

  it('打ち切ったあとは、送信待ちへ何も積まない', async () => {
    const stopper = new AbortController();
    stopper.abort();
    const spool = memorySpool();

    await runCardStation({
      reader: repeatingReader('04A1B2C3'),
      spool,
      logger: createAgentLogger(),
      fingerprint: (raw) => raw,
      allocateSequence: async () => 1,
      running: () => true,
      signal: stopper.signal,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    expect(spool.entries).toHaveLength(0);
  });

  it('繰り返し読んでも、送信待ちは読んだ回数だけ増える', async () => {
    const taps = 200;
    const spool = memorySpool();
    let remaining = taps;
    let sequence = 0;

    await runCardStation({
      reader: repeatingReader('04A1B2C3'),
      spool,
      logger: createAgentLogger(),
      fingerprint: (raw) => `fp-${raw}`,
      allocateSequence: async () => {
        sequence += 1;
        return sequence;
      },
      running: () => {
        remaining -= 1;
        return remaining >= 0;
      },
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    expect(spool.entries).toHaveLength(taps);
    // 連番は 1 つずつ進む。飛びも戻りも無い。
    expect(spool.entries.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: taps }, (_unused, index) => index + 1),
    );
    // 生の識別子は残らない。
    expect(spool.entries.every((entry) => JSON.stringify(entry).includes('fp-'))).toBe(true);
  });

  it('装置の抜き差しを繰り返しても、待ち受けが残らない', async () => {
    const listeners = new Set<(status: { state: number }) => void>();
    let failures = 5;

    const transport: PcscTransport = {
      name: 'flaky',
      waitForCard: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('装置が外れています');
        }
        for (const listener of listeners) listener({ state: 0x20 });
      },
      transmit: async () => Uint8Array.from([0x04, 0xa1, 0x90, 0x00]),
      waitForRemoval: async () => {},
      reconnect: async () => {},
      close: async () => {},
    };

    const reader = createPcscCardReader(transport, {
      debounceMs: 0,
      sleep: async () => {},
      reconnectDelaysMs: [0],
    });

    await reader.read();

    expect(listeners.size).toBe(0);
  });

  it('開き直しの待ちの途中で止めても、装置へ問い合わせ直さない', async () => {
    const stopper = new AbortController();
    const reconnect = vi.fn(async () => {});

    const transport: PcscTransport = {
      name: 'always-failing',
      waitForCard: async () => {
        throw new Error('装置が外れています');
      },
      transmit: async () => Uint8Array.from([0x90, 0x00]),
      waitForRemoval: async () => {},
      reconnect,
      close: async () => {},
    };

    const reader = createPcscCardReader(transport, {
      // 待っている間に止める。止めたあとは開き直しへ進まない。
      sleep: async () => {
        stopper.abort();
      },
      reconnectDelaysMs: [0],
    });

    await expect(reader.read(stopper.signal)).rejects.toBeInstanceOf(CardReadAborted);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('読み取れるカードが尽きても、打ち切りとは区別する', async () => {
    const spool = memorySpool();
    let remaining = 2;

    await runCardStation({
      reader: createScriptedCardReader(['04A1B2C3']),
      spool,
      logger: createAgentLogger(),
      fingerprint: (raw) => raw,
      allocateSequence: async () => 1,
      running: () => {
        remaining -= 1;
        return remaining >= 0;
      },
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    // 1 枚目は積まれ、2 回目は読めずに終わる。読めなかったことで止めない。
    expect(spool.entries).toHaveLength(1);
  });
});
