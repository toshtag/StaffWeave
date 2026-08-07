import { randomUUID } from 'node:crypto';
import type { CardReader } from '../card/reader.js';
import type { AgentLogger } from './redact.js';
import type { Spool } from './spool.js';

/**
 * 据え置き端末の常駐。
 *
 * 読み取りと送信を 1 つのプロセスで持つ。分けると、サービスとして登録した側だけが
 * 動き、もう一方は誰も起動しない。実際に「Windows サービスは送信だけを登録し、
 * カードの読み取りはサービスに入っていない」という状態になっていた。
 *
 * 読んだカードは、その場で送らずに送信待ちへ積む。その場で送ると、回線が切れて
 * いる間の打刻がどこにも残らない。端末の前の人は打刻したつもりで立ち去る。
 *
 * 積むときに連番を決め、資格情報へ先に書く。書いてから積むのは、途中で落ちた
 * ときに同じ連番を二度使わないため。連番が飛ぶのはサーバーが受け取るが、
 * 戻るのは断られる。
 */

export interface CardStationOptions {
  reader: CardReader;
  spool: Spool;
  logger: AgentLogger;
  /** 生の識別子を指紋へ変える。生の値はこの先へ渡さない。 */
  fingerprint: (rawCardId: string) => string;
  /** 連番を 1 つ取り、次の値を保存する。 */
  allocateSequence: () => Promise<number>;
  running: () => boolean;
  now: () => Date;
  /** 冪等キー。検査から差し替えるために開ける。 */
  newRequestId?: () => string;
}

/**
 * カードを 1 枚読み、送信待ちへ積む。
 *
 * 読み取りの失敗で止めない。装置が外れた・カードが読めなかったときに止めると、
 * 直った後も端末は立っているだけで、次の人が打刻できない。
 */
export async function readCardIntoSpool(options: CardStationOptions): Promise<boolean> {
  let rawCardId: string;
  try {
    rawCardId = await options.reader.read();
  } catch (error) {
    options.logger.error('agent.card_read_failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const sequence = await options.allocateSequence();
  const now = options.now().toISOString();
  await options.spool.add({
    kind: 'card',
    requestId: (options.newRequestId ?? randomUUID)(),
    sequence,
    // 指紋だけを置く。送信待ちはディスクに残るため、生の識別子を書くと、
    // 拾った人が物理カードと結び付けられる。
    cardFingerprint: options.fingerprint(rawCardId),
    occurredAt: now,
    queuedAt: now,
  });

  // 記録にも生の識別子と指紋は出さない。診断のために保守の人が読む場所で、
  // 出せば端末のログへ残り続ける。
  options.logger.info('agent.card_queued', { sequence });
  return true;
}

/** カードを読み続け、送信待ちへ積み続ける。 */
export async function runCardStation(options: CardStationOptions): Promise<void> {
  options.logger.info('agent.reader_started', { reader: options.reader.name });
  while (options.running()) {
    await readCardIntoSpool(options);
  }
  options.logger.info('agent.reader_stopped');
}
