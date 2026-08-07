import type { AttendanceEventType } from '@staffweave/domain';
import { AgentRequestError } from '../client.js';
import type { DeviceCredentials } from '../credentials.js';
import type { SendOutcome } from './runner.js';
import type { SpooledPunch } from './spool.js';

/**
 * 送信待ちの 1 件を送る。
 *
 * 従業員番号の打刻とカードの打刻は、送り先も署名の対象も違う。
 * 呼ぶ側で分岐させると、常駐のループと 1 回きりの実行で違う判断が入り込む。
 * ここに 1 つだけ置き、どちらの経路も同じものを通す。
 *
 * 連番は積むときに決めてある。ここでは触らない。ここで決めると、
 * 「サーバーは受理したが応答を失った」場合に同じ連番が二度出ていく。
 */

export interface SendDependencies {
  credentials: () => Promise<DeviceCredentials>;
  sendEvent: (
    credentials: DeviceCredentials,
    input: {
      sequence: number;
      requestId: string;
      employeeNumber: string;
      eventType: AttendanceEventType;
      occurredAt: string;
      deviceTime: string;
    },
  ) => Promise<unknown>;
  sendCardEvent: (
    credentials: DeviceCredentials,
    input: {
      sequence: number;
      requestId: string;
      cardFingerprint: string;
      eventType?: AttendanceEventType;
      occurredAt: string;
      deviceTime: string;
    },
  ) => Promise<unknown>;
  now: () => Date;
}

/**
 * 送り直しても同じ答えしか返らないかどうか。
 *
 * 相手が落ちている・混んでいる・時間切れは、待てば通る。
 * それ以外の 4xx は、こちらの言い分が受け取られていない。残しても後ろが詰まる。
 */
function outcomeOfError(error: unknown): SendOutcome {
  if (error instanceof AgentRequestError) {
    return error.status >= 500 || error.status === 429 || error.status === 408
      ? { kind: 'retry', reason: `HTTP ${error.status}` }
      : { kind: 'rejected', reason: `HTTP ${error.status}` };
  }
  return { kind: 'retry', reason: '接続できません' };
}

export function createSender(
  deps: SendDependencies,
): (punch: SpooledPunch) => Promise<SendOutcome> {
  return async (punch) => {
    const credentials = await deps.credentials();
    const deviceTime = deps.now().toISOString();

    try {
      if (punch.kind === 'card') {
        await deps.sendCardEvent(credentials, {
          sequence: punch.sequence,
          requestId: punch.requestId,
          cardFingerprint: punch.cardFingerprint,
          ...(punch.eventType === undefined
            ? {}
            : { eventType: punch.eventType as AttendanceEventType }),
          occurredAt: punch.occurredAt,
          deviceTime,
        });
      } else {
        await deps.sendEvent(credentials, {
          sequence: punch.sequence,
          requestId: punch.requestId,
          employeeNumber: punch.employeeNumber,
          eventType: punch.eventType as AttendanceEventType,
          occurredAt: punch.occurredAt,
          deviceTime,
        });
      }
      return { kind: 'accepted' };
    } catch (error) {
      return outcomeOfError(error);
    }
  };
}
