import type {
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
} from '@staffweave/contracts';
import type { AttendanceEventType } from '@staffweave/domain';
import { ApiRequestError, api } from '../api/client.ts';

/**
 * 打刻の送信待ち行列。
 *
 * 通信できないときでも打刻の操作を受け付け、後からまとめて送る。
 * 冪等キーは行列へ入れた時点で決めるため、何度再送しても記録は 1 件に収まる。
 * 打刻した時刻も入れた時点のものを使い、送信が遅れても実際の時刻がずれない。
 *
 * 同じ端末を複数人が使うため、保存した打刻は Workspace・利用者・従業員の 3 値で区切る。
 * 現在の利用者に属さない打刻は、読み込みも送信も行わない。
 */

const STORAGE_PREFIX = 'staffweave.pendingPunches.v2';

/** 所有者を持たない旧形式の保存先。読むだけで、書き換えも削除もしない。 */
const LEGACY_STORAGE_KEY = 'staffweave.pendingPunches';

const SCHEMA_VERSION = 2;

/** 読めない保存内容を退避する先。上書きで消さないために使う。 */
const UNREADABLE_SUFFIX = '.unreadable';

/** 送信待ち打刻の持ち主。この 3 値がひとつでも違えば別の行列として扱う。 */
export interface PunchQueueOwner {
  workspaceId: string;
  userId: string;
  employeeId: string;
}

export interface PendingPunch {
  requestId: string;
  eventType: AttendanceEventType;
  occurredAt: string;
  /** 送信を試みた回数。次の再送までの待ち時間を決めるのに使う。 */
  attempts: number;
}

/** 保存する内容。所有者と版を打刻本体と一緒に持ち、読み込み時に照合する。 */
interface StoredPunchQueue {
  schemaVersion: typeof SCHEMA_VERSION;
  owner: PunchQueueOwner;
  entries: PendingPunch[];
}

export interface PunchQueueSnapshot {
  pending: PendingPunch[];
  /** 所有者が分からない旧形式の保存内容が残っているか。 */
  hasLegacyEntries: boolean;
}

export type QueueListener = (snapshot: PunchQueueSnapshot) => void;

/**
 * 保存先の名前。
 * 組み立てはここだけで行い、画面やテストへ書き写さない。
 */
export function storageKeyOf(owner: PunchQueueOwner): string {
  const parts = [owner.workspaceId, owner.userId, owner.employeeId].map((value) =>
    encodeURIComponent(value),
  );
  return `${STORAGE_PREFIX}:${parts.join(':')}`;
}

function sameOwner(left: PunchQueueOwner, right: PunchQueueOwner): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.userId === right.userId &&
    left.employeeId === right.employeeId
  );
}

function isOwner(value: unknown): value is PunchQueueOwner {
  if (typeof value !== 'object' || value === null) return false;
  const owner = value as Partial<PunchQueueOwner>;
  return (
    typeof owner.workspaceId === 'string' &&
    typeof owner.userId === 'string' &&
    typeof owner.employeeId === 'string'
  );
}

function isPendingPunch(value: unknown): value is PendingPunch {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<PendingPunch>;
  return (
    typeof entry.requestId === 'string' &&
    entry.requestId !== '' &&
    typeof entry.eventType === 'string' &&
    typeof entry.occurredAt === 'string' &&
    typeof entry.attempts === 'number' &&
    Number.isInteger(entry.attempts) &&
    entry.attempts >= 0
  );
}

/**
 * 保存内容を現在の所有者のものとして読み出す。
 * 版・所有者・要素のいずれかが合わない場合は、1 件も取り出さない。
 */
function parseStored(raw: string, owner: PunchQueueOwner): PendingPunch[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const stored = parsed as Partial<StoredPunchQueue>;
  if (stored.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isOwner(stored.owner) || !sameOwner(stored.owner, owner)) return null;
  if (!Array.isArray(stored.entries)) return null;
  if (!stored.entries.every(isPendingPunch)) return null;

  return [...stored.entries];
}

export interface PunchQueueDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  send: (input: RecordAttendanceEventRequest) => Promise<RecordAttendanceEventResponse>;
  createRequestId: () => string;
  subscribeOnline: (listener: () => void) => () => void;
}

/** ブラウザで使う依存。単体テストからは偽の実装へ差し替える。 */
export function browserPunchQueueDependencies(): PunchQueueDependencies {
  return {
    storage: window.localStorage,
    send: (input) => api.recordAttendanceEvent(input),
    createRequestId: () => crypto.randomUUID(),
    subscribeOnline: (listener) => {
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
  };
}

export interface PunchQueue {
  /** 打刻を行列へ入れ、可能ならすぐ送る。 */
  enqueue(eventType: AttendanceEventType, occurredAt: Date): Promise<void>;
  /** 溜まっている打刻を古い順に送る。 */
  flush(): Promise<void>;
  snapshot(): PunchQueueSnapshot;
  subscribe(listener: QueueListener): () => void;
  /** 購読を解除し、以降の自動送信と通知を止める。何度呼んでも安全。 */
  dispose(): void;
}

export interface PunchQueueOptions {
  /** 送信待ち打刻の持ち主。従業員が紐づかない利用者には行列を作らない。 */
  owner: PunchQueueOwner;
  /** 送信に成功したときの反映。最新の勤務日を受け取る。 */
  onAccepted: (result: RecordAttendanceEventResponse) => void;
  /** 送信できたが受け付けられなかったときの通知。 */
  onRejected: (pending: PendingPunch, message: string) => void;
}

export function createPunchQueue(
  options: PunchQueueOptions,
  dependencies: PunchQueueDependencies = browserPunchQueueDependencies(),
): PunchQueue {
  const { owner } = options;
  const { storage, send, createRequestId, subscribeOnline } = dependencies;
  const key = storageKeyOf(owner);

  const listeners = new Set<QueueListener>();
  let pending: PendingPunch[] = [];
  let flushing = false;
  let disposed = false;

  /** 読めなかった保存内容。空で上書きして消さないよう、書き込む前に退避する。 */
  let unreadable: string | null = null;

  const stored = storage.getItem(key);
  if (stored !== null) {
    const loaded = parseStored(stored, owner);
    if (loaded === null) {
      unreadable = stored;
    } else {
      pending = loaded;
    }
  }

  /** 旧形式の保存内容は所有者が分からないため、件数も中身も現在の利用者へ結びつけない。 */
  function hasLegacyEntries(): boolean {
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === null) return false;
    try {
      const parsed: unknown = JSON.parse(legacy);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }

  function currentSnapshot(): PunchQueueSnapshot {
    return { pending: [...pending], hasLegacyEntries: hasLegacyEntries() };
  }

  function persist(): void {
    if (unreadable !== null) {
      storage.setItem(`${key}${UNREADABLE_SUFFIX}`, unreadable);
      unreadable = null;
    }
    const next: StoredPunchQueue = { schemaVersion: SCHEMA_VERSION, owner, entries: pending };
    storage.setItem(key, JSON.stringify(next));
  }

  function notify(): void {
    if (disposed) return;
    const snapshot = currentSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  async function flush(): Promise<void> {
    if (disposed || flushing) return;
    flushing = true;
    try {
      while (pending.length > 0) {
        const entry = pending[0];
        if (entry === undefined) break;

        try {
          const result = await send({
            eventType: entry.eventType,
            occurredAt: entry.occurredAt,
            requestId: entry.requestId,
            source: 'mobile',
          });
          pending = pending.slice(1);
          persist();
          notify();
          if (disposed) break;
          options.onAccepted(result);
        } catch (error) {
          if (error instanceof ApiRequestError) {
            // サーバーが受け取ったうえで断った打刻は、何度送っても結果は変わらない。
            pending = pending.slice(1);
            persist();
            notify();
            if (disposed) break;
            options.onRejected(entry, error.message);
            continue;
          }
          // 通信できない場合は行列に残し、次の機会に送る。
          entry.attempts += 1;
          persist();
          notify();
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  const unsubscribeOnline = subscribeOnline(() => {
    void flush();
  });

  return {
    async enqueue(eventType, occurredAt) {
      if (disposed) return;
      pending = [
        ...pending,
        {
          requestId: createRequestId(),
          eventType,
          occurredAt: occurredAt.toISOString(),
          attempts: 0,
        },
      ];
      persist();
      notify();
      await flush();
    },
    flush,
    snapshot: currentSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(currentSnapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeOnline();
      listeners.clear();
    },
  };
}
