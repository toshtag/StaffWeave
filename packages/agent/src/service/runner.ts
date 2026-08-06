import { DEFAULT_RETRY_POLICY, type RetryPolicy, retryDelayMs } from '@staffweave/domain';
import type { AgentLogger } from './redact.js';
import type { Spool, SpooledPunch } from './spool.js';

/**
 * 送信待ちを順に送る処理。
 *
 * 常駐のループとは分けてある。ループごと動かさないと確かめられない形にすると、
 * 待ち時間ぶんだけ検査が遅くなり、遅いから確かめない、という方向へ進む。
 *
 * 打刻は起きた順に送る。1 件でも送れなければ、そこで止めて次の機会に回す。
 * 飛ばして先へ進むと、サーバー側の連番が飛び、あとの打刻まで拒まれる。
 *
 * サーバーが「その要求は受け取れない」と答えたものは、送信待ちから外す。
 * 残しても同じ答えしか返らず、後ろの打刻が永久に出られなくなる。
 * 外したことは記録に残し、あとから何が落ちたかを辿れるようにする。
 */

export type SendOutcome =
  /** 受け付けられた。 */
  | { kind: 'accepted' }
  /** 送れなかった。相手が復旧すれば通る。 */
  | { kind: 'retry'; reason: string }
  /** 送り直しても同じ答えしか返らない。 */
  | { kind: 'rejected'; reason: string };

export interface FlushResult {
  sent: number;
  /** 送り直しても通らないとして外した件数。 */
  dropped: number;
  /** まだ送信待ちに残っている件数。 */
  remaining: number;
}

export interface FlushDependencies {
  spool: Spool;
  send: (punch: SpooledPunch) => Promise<SendOutcome>;
  logger: AgentLogger;
}

export async function flushSpool(deps: FlushDependencies): Promise<FlushResult> {
  const pending = await deps.spool.list();
  let sent = 0;
  let dropped = 0;

  for (const punch of pending) {
    const outcome = await deps.send(punch);

    if (outcome.kind === 'accepted') {
      await deps.spool.remove(punch.requestId);
      sent += 1;
      continue;
    }

    if (outcome.kind === 'rejected') {
      await deps.spool.remove(punch.requestId);
      dropped += 1;
      // 落としたことは残す。残さないと、届かなかった打刻が誰にも見えない。
      deps.logger.error('agent.punch_dropped', {
        requestId: punch.requestId,
        eventType: punch.eventType,
        occurredAt: punch.occurredAt,
        reason: outcome.reason,
      });
      continue;
    }

    // 送れなかったところで止める。飛ばすとサーバー側の連番が飛ぶ。
    deps.logger.info('agent.flush_paused', {
      requestId: punch.requestId,
      reason: outcome.reason,
    });
    break;
  }

  return { sent, dropped, remaining: pending.length - sent - dropped };
}

export interface RunnerOptions extends FlushDependencies {
  /** 送信待ちが残っているときに、次に試すまでの間隔を決める方針。 */
  retryPolicy?: RetryPolicy;
  /** 送信待ちが無いときに、次に見に行くまでの間隔。 */
  idleIntervalMs?: number;
  /** 待つ処理。検査では即座に返す実装へ差し替える。 */
  sleep: (ms: number) => Promise<void>;
  /** 続けるかどうか。停止の要求を受けたら false を返す。 */
  running: () => boolean;
  /** 間隔をずらす 0 以上 1 未満の値。 */
  jitter?: () => number;
}

/**
 * 常駐して送り続ける。
 *
 * 送れない間は間隔を広げる。広げないと、切れている回線へ数秒ごとに出続け、
 * 端末の電池と現場の回線を無駄に使う。
 */
export async function runAgent(options: RunnerOptions): Promise<void> {
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const idle = options.idleIntervalMs ?? 5_000;
  const jitter = options.jitter ?? Math.random;
  let failures = 0;

  while (options.running()) {
    const result = await flushSpool(options);

    if (result.remaining === 0) {
      failures = 0;
      await options.sleep(idle);
      continue;
    }

    failures += 1;
    await options.sleep(retryDelayMs(policy, failures, jitter()));
  }
}
