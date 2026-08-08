/**
 * 読み取り装置の抜き差しから、実際に戻れること。
 *
 * #194 は「読み取り装置を抜き差ししても、常駐が落ちず読み取りへ戻る」ことを
 * 求めています。これまでの作りでは戻れませんでした。
 *
 *   装置が抜かれても、待っているのは `status` だけだった。抜かれたら状態は
 *   二度と来ないため、待ち続けたまま固まる。
 *
 *   最初に見つけた装置を抱え込んでいた。差し直しても、死んだ装置へ
 *   つなぎ直そうとする。
 *
 * ここでは、出来事を出す偽物で本物の取り決めを再現し、抜いて差し直しても
 * 読み取りへ戻れることを見ます。
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPcscCardReader, GET_UID_APDU, parseUid } from './pcsc.js';
import { createPcscTransport, ReaderGone } from './pcsc-winscard.js';
import { CardReadAborted } from './reader.js';

/** カードの識別子 04A1B2C3 と、成功の状態語。 */
const UID_RESPONSE = Buffer.from([0x04, 0xa1, 0xb2, 0xc3, 0x90, 0x00]);

/**
 * `pcsclite` が返す装置の代わり。
 *
 * 本物は OS ごとに組み立てが要るため、ここでは使えません。再現するのは
 * 出来事の出し方（`status` / `end` / `error`）と、待ち受けの足し外しだけです。
 */
class FakeReader extends EventEmitter {
  readonly SCARD_SHARE_SHARED = 2;
  readonly SCARD_STATE_PRESENT = 0x20;
  readonly SCARD_PROTOCOL_T0 = 1;
  readonly SCARD_PROTOCOL_T1 = 2;
  readonly SCARD_LEAVE_CARD = 0;
  closed = false;

  constructor(readonly name: string) {
    super();
    // 溜まったことを検査で数えたいので、警告で止めない。
    this.setMaxListeners(0);
  }

  connect(_options: { share_mode: number }, callback: (e: Error | null, p: number) => void): void {
    callback(null, 2);
  }

  disconnect(_disposition: number, callback: (e: Error | null) => void): void {
    callback(null);
  }

  transmit(
    _input: Buffer,
    _length: number,
    _protocol: number,
    callback: (e: Error | null, output: Buffer) => void,
  ): void {
    callback(null, UID_RESPONSE);
  }

  close(): void {
    this.closed = true;
  }

  /** カードが置かれた／離れた。 */
  card(present: boolean): void {
    this.emit('status', { state: present ? this.SCARD_STATE_PRESENT : 0 });
  }

  /** 装置が抜かれた。 */
  unplug(): void {
    this.emit('end');
  }

  /** 待ち受けの数。抜き差しのたびに増えていないことを見る。 */
  waiting(): number {
    return this.listenerCount('status') + this.listenerCount('end') + this.listenerCount('error');
  }
}

/** `pcsclite` そのものの代わり。装置の出現を出す。 */
class FakePcsc extends EventEmitter {
  closed = false;

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  close(): void {
    this.closed = true;
  }

  plug(reader: FakeReader): void {
    this.emit('reader', reader);
  }

  waiting(): number {
    return this.listenerCount('reader') + this.listenerCount('error');
  }
}

/**
 * 待ち受けが置かれるまで進める。
 *
 * `Promise.resolve()` 1 回では足りない。受け渡しを作る側は、部品の読み込みから
 * 装置待ちまでにいくつか await を挟む。数を数えて合わせると、実装を触るたびに
 * 検査が壊れる。
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 装置を 1 台掴んだ状態の受け渡しを作る。
 *
 * 受け渡しそのものは装置が無くても作れる。掴むのは最初の `waitForCard` なので、
 * ここで 1 回通しておく。
 */
async function connected(
  pcsc: FakePcsc,
  reader: FakeReader,
): Promise<Awaited<ReturnType<typeof createPcscTransport>>> {
  const transport = await createPcscTransport(async () => () => pcsc as never);
  const placed = transport.waitForCard();
  await tick();
  pcsc.plug(reader);
  await tick();
  reader.card(true);
  await placed;
  return transport;
}

describe('読み取り装置の抜き差し', () => {
  it('カードを待っている間に抜かれたら、固まらずに返す', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    const waiting = transport.waitForCard();
    await tick();
    readerA.unplug();

    // 状態が来ないまま待ち続けると、ここで時間切れになる。
    await expect(waiting).rejects.toBeInstanceOf(ReaderGone);
  });

  it('差し直すと、新しい装置で読み取りへ戻る', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    // 抜く。
    const lost = transport.waitForCard();
    await tick();
    readerA.unplug();
    await expect(lost).rejects.toBeInstanceOf(ReaderGone);

    // 差し直す。抱え込んでいると、ここで死んだ装置を使い続ける。
    const readerB = new FakeReader('B');
    const resumed = transport.waitForCard();
    await tick();
    pcsc.plug(readerB);
    await tick();
    readerB.card(true);
    await resumed;

    // 新しい装置から、識別子まで読める。
    expect(parseUid(await transport.transmit(GET_UID_APDU))).toBe('04A1B2C3');
  });

  it('抜き差しを繰り返しても、待ち受けが増えない', async () => {
    const pcsc = new FakePcsc();
    let current = new FakeReader('0');
    const transport = await connected(pcsc, current);

    for (let index = 1; index <= 100; index += 1) {
      const lost = transport.waitForCard();
      await tick();
      current.unplug();
      await expect(lost).rejects.toBeInstanceOf(ReaderGone);

      // 抜けた装置に、待ち受けを残さない。
      expect(current.waiting()).toBe(0);

      const next = new FakeReader(String(index));
      const resumed = transport.waitForCard();
      await tick();
      pcsc.plug(next);
      await tick();
      next.card(true);
      await resumed;

      current = next;
    }

    expect(current.waiting()).toBe(0);
    // 装置の出現を待つ側にも残さない。
    expect(pcsc.waiting()).toBe(0);
  });

  it('装置を待っている間でも、止めろと言われれば返す', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    const lost = transport.waitForCard();
    await tick();
    readerA.unplug();
    await expect(lost).rejects.toBeInstanceOf(ReaderGone);

    // 差し直されないまま、止めろと言われる。
    const stopper = new AbortController();
    const waiting = transport.waitForCard(stopper.signal);
    await tick();
    stopper.abort();

    await expect(waiting).rejects.toBeInstanceOf(CardReadAborted);
    expect(pcsc.waiting()).toBe(0);
  });

  it('カードを待っている間に止めても、待ち受けを残さない', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    for (let index = 0; index < 100; index += 1) {
      const stopper = new AbortController();
      const waiting = transport.waitForCard(stopper.signal);
      await tick();
      stopper.abort();
      await expect(waiting).rejects.toBeInstanceOf(CardReadAborted);
    }

    expect(readerA.waiting()).toBe(0);
  });

  it('タップと離脱を繰り返しても、待ち受けを残さない', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    for (let index = 0; index < 500; index += 1) {
      const placed = transport.waitForCard();
      await tick();
      readerA.card(true);
      await placed;

      const removed = transport.waitForRemoval();
      await tick();
      readerA.card(false);
      await removed;
    }

    expect(readerA.waiting()).toBe(0);
  });

  it('抜けている間に送ろうとしたら、使えないと言う', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    const lost = transport.waitForCard();
    await tick();
    readerA.unplug();
    await expect(lost).rejects.toBeInstanceOf(ReaderGone);

    // 抜けたまま送ると、黙って古い装置へ流さない。
    await expect(transport.transmit(GET_UID_APDU)).rejects.toBeInstanceOf(ReaderGone);
  });

  /**
   * 起動したときに装置が無くても、受け渡しは作れること。
   *
   * 作る時点で待つと、端末の起動時に装置がまだ見えていないだけで常駐そのものが
   * 終わる。認識が遅い、あとから挿す、USB の口の初期化が遅れる、はどれも普通に
   * 起こる。タスクスケジューラの上げ直しは 3 回しかなく、数分見えなければ
   * 止まったままになっていた。
   */
  it('装置が 1 台も無くても、受け渡しは作れる', async () => {
    const pcsc = new FakePcsc();

    const transport = await createPcscTransport(async () => () => pcsc as never, 10);

    // まだ見つけていないことが、名前から分かる。
    expect(transport.name).toContain('待っています');
  });

  it('1 回の待ちを越えても終わらず、あとから挿すと読める', async () => {
    const pcsc = new FakePcsc();
    // 1 回の待ちを短くする。実機の 30 秒を、何度も越える状況にあたる。
    const transport = await createPcscTransport(async () => () => pcsc as never, 10);
    const card = createPcscCardReader(transport, {
      debounceMs: 0,
      sleep: async () => {},
      reconnectDelaysMs: [0],
    });

    const reading = card.read();

    // 待ちを何度も越える。終わっていれば、このあと挿しても読めない。
    for (let round = 0; round < 5; round += 1) await tick();

    const reader = new FakeReader('late');
    pcsc.plug(reader);
    for (let round = 0; round < 5; round += 1) await tick();
    reader.card(true);

    expect(await reading).toBe('04A1B2C3');
    expect(transport.name).toBe('late');
  });

  it('装置が 1 台も無いまま止めても、短い時間で返る', async () => {
    const pcsc = new FakePcsc();
    const transport = await createPcscTransport(async () => () => pcsc as never, 10_000);

    const stopper = new AbortController();
    const waiting = transport.waitForCard(stopper.signal);
    await tick();
    stopper.abort();

    await expect(waiting).rejects.toBeInstanceOf(CardReadAborted);
    expect(pcsc.waiting()).toBe(0);
  });

  it('待ちを越えたときは、待ち受けを残さずに区切る', async () => {
    const pcsc = new FakePcsc();
    const transport = await createPcscTransport(async () => () => pcsc as never, 10);

    await expect(transport.waitForCard()).rejects.toThrow('読み取り装置が見つかりません');

    // 区切っただけ。次の待ちへ入れる形で残っていないこと。
    expect(pcsc.waiting()).toBe(0);
  });

  /**
   * 読み取りの側から見ても、抜き差しをまたいで戻れること。
   *
   * #194 が求めているのはここ。受け渡しが戻せても、その上の読み取りが
   * 開き直しの輪へ入らなければ、端末は止まったままになる。
   */
  it('読み取りの側も、抜き差しをまたいで同じカードを読める', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);
    const card = createPcscCardReader(transport, {
      debounceMs: 0,
      sleep: async () => {},
      reconnectDelaysMs: [0],
    });

    // 1 枚読む。
    const first = card.read();
    await tick();
    readerA.card(true);
    expect(await first).toBe('04A1B2C3');

    // 待っている途中で抜く。読み取りは開き直しの輪へ入る。
    const across = card.read();
    await tick();
    readerA.unplug();

    // 差し直すと、新しい装置で読める。戻れなければ、ここで時間切れになる。
    const readerB = new FakeReader('B');
    for (let attempt = 0; attempt < 5; attempt += 1) await tick();
    pcsc.plug(readerB);
    for (let attempt = 0; attempt < 5; attempt += 1) await tick();
    readerB.card(true);

    expect(await across).toBe('04A1B2C3');
  });

  it('閉じると、装置も土台も閉じる', async () => {
    const pcsc = new FakePcsc();
    const readerA = new FakeReader('A');
    const transport = await connected(pcsc, readerA);

    await transport.close();

    expect(readerA.closed).toBe(true);
    expect(pcsc.closed).toBe(true);
  });
});
