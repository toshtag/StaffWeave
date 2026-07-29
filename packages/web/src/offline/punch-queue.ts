import type { RecordAttendanceEventResponse } from '@staffweave/contracts';
import type { AttendanceEventType } from '@staffweave/domain';
import { ApiRequestError, api } from '../api/client.ts';

/**
 * 打刻の送信待ち行列。
 *
 * 通信できないときでも打刻の操作を受け付け、後からまとめて送る。
 * 冪等キーは行列へ入れた時点で決めるため、何度再送しても記録は 1 件に収まる。
 * 打刻した時刻も入れた時点のものを使い、送信が遅れても実際の時刻がずれない。
 */

const STORAGE_KEY = 'staffweave.pendingPunches';

export interface PendingPunch {
  requestId: string;
  eventType: AttendanceEventType;
  occurredAt: string;
  /** 送信を試みた回数。次の再送までの待ち時間を決めるのに使う。 */
  attempts: number;
}

export type QueueListener = (pending: PendingPunch[]) => void;

function load(): PendingPunch[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingPunch =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as PendingPunch).requestId === 'string' &&
        typeof (entry as PendingPunch).eventType === 'string' &&
        typeof (entry as PendingPunch).occurredAt === 'string',
    );
  } catch {
    return [];
  }
}

function save(pending: PendingPunch[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

export interface PunchQueue {
  /** 打刻を行列へ入れ、可能ならすぐ送る。 */
  enqueue(eventType: AttendanceEventType, occurredAt: Date): Promise<void>;
  /** 溜まっている打刻を古い順に送る。 */
  flush(): Promise<void>;
  pending(): PendingPunch[];
  subscribe(listener: QueueListener): () => void;
}

export interface PunchQueueOptions {
  /** 送信に成功したときの反映。最新の勤務日を受け取る。 */
  onAccepted: (result: RecordAttendanceEventResponse) => void;
  /** 送信できたが受け付けられなかったときの通知。 */
  onRejected: (pending: PendingPunch, message: string) => void;
}

export function createPunchQueue(options: PunchQueueOptions): PunchQueue {
  let pending = load();
  const listeners = new Set<QueueListener>();
  let flushing = false;

  function notify(): void {
    save(pending);
    for (const listener of listeners) listener([...pending]);
  }

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      while (pending.length > 0) {
        const entry = pending[0];
        if (entry === undefined) break;

        try {
          const result = await api.recordAttendanceEvent({
            eventType: entry.eventType,
            occurredAt: entry.occurredAt,
            requestId: entry.requestId,
            source: 'mobile',
          });
          pending = pending.slice(1);
          notify();
          options.onAccepted(result);
        } catch (error) {
          if (error instanceof ApiRequestError) {
            // サーバーが受け取ったうえで断った打刻は、何度送っても結果は変わらない。
            pending = pending.slice(1);
            notify();
            options.onRejected(entry, error.message);
            continue;
          }
          // 通信できない場合は行列に残し、次の機会に送る。
          entry.attempts += 1;
          notify();
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void flush();
    });
  }

  return {
    async enqueue(eventType, occurredAt) {
      pending = [
        ...pending,
        {
          requestId: crypto.randomUUID(),
          eventType,
          occurredAt: occurredAt.toISOString(),
          attempts: 0,
        },
      ];
      notify();
      await flush();
    },
    flush,
    pending: () => [...pending],
    subscribe(listener) {
      listeners.add(listener);
      listener([...pending]);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
