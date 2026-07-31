import type {
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
} from '@staffweave/contracts';
import type { AttendanceEventType } from '@staffweave/domain';
import { isAttendanceEventType } from '@staffweave/domain';
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

const UNREADABLE_SCHEMA_VERSION = 1;

/**
 * API 契約に合わせた冪等キーの長さ。
 * ここで弾いておけば、送っても必ず断られる打刻を行列に抱え込まずに済む。
 */
const REQUEST_ID_MIN_LENGTH = 8;
const REQUEST_ID_MAX_LENGTH = 128;

/**
 * 読めなかった保存内容の控え。
 * 破損が二度起きても前の内容を失わないよう、1 件ずつ足していく。
 */
interface UnreadablePunchArchive {
  schemaVersion: typeof UNREADABLE_SCHEMA_VERSION;
  entries: { capturedAt: string; raw: string }[];
}

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

/**
 * 送信できなかった打刻の扱い。
 *
 * 行列から取り除いてよいのは、同じ要求をそのまま送り直しても結果が変わらないと
 * API の契約で決まっているものだけとする。
 * 判断できない失敗は残す側へ倒す。消してしまえば打刻は取り戻せない。
 */
export type PunchFailureDisposition =
  | 'authentication_required'
  | 'permission_blocked'
  | 'permanent_rejection'
  | 'retry_later';

export function classifyPunchFailure(error: unknown): PunchFailureDisposition {
  if (!(error instanceof ApiRequestError)) return 'retry_later';
  if (error.status === 401 && error.code === 'unauthenticated') return 'authentication_required';
  if (error.status === 403 && error.code === 'forbidden') return 'permission_blocked';
  if (error.status === 400 && error.code === 'invalid_request') return 'permanent_rejection';
  if (error.status === 409 && error.code === 'conflict') return 'permanent_rejection';
  return 'retry_later';
}

/** 行列が止まっている理由。利用者へ次に何をすればよいかを伝えるために使う。 */
export type PunchBlockedReason = Exclude<PunchFailureDisposition, 'permanent_rejection'>;

export interface PunchQueueSnapshot {
  pending: PendingPunch[];
  /** 送信を止めている理由。送れている間は null。 */
  blocked: { reason: PunchBlockedReason; message: string } | null;
  /** 所有者が分からない旧形式の保存内容が残っているか。 */
  hasLegacyEntries: boolean;
  /** 現在の所有者の保存内容のうち、読み取れず退避したものが残っているか。 */
  hasUnreadableEntries: boolean;
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

/** 識別子として使える文字列か。空文字と空白だけの値は、誰のものとも決められない。 */
function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isOwner(value: unknown): value is PunchQueueOwner {
  if (typeof value !== 'object' || value === null) return false;
  const owner = value as Partial<PunchQueueOwner>;
  return (
    isIdentifier(owner.workspaceId) && isIdentifier(owner.userId) && isIdentifier(owner.employeeId)
  );
}

/**
 * 保存されていた 1 件を、そのまま画面の計算と送信に使えるか。
 *
 * 保存先は利用者が書き換えられるため、信用できる入力ではない。
 * 種別は正本の判定を使う。未知の種別が画面の集計へ入ると、そこで落ちる。
 */
function isPendingPunch(value: unknown): value is PendingPunch {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<PendingPunch>;

  if (typeof entry.requestId !== 'string') return false;
  if (entry.requestId.length < REQUEST_ID_MIN_LENGTH) return false;
  if (entry.requestId.length > REQUEST_ID_MAX_LENGTH) return false;

  if (typeof entry.eventType !== 'string') return false;
  if (!isAttendanceEventType(entry.eventType)) return false;

  if (typeof entry.occurredAt !== 'string') return false;
  if (!Number.isFinite(new Date(entry.occurredAt).getTime())) return false;

  // 経過時間による受理の可否はサーバーが決める。ここでは日時として読めることだけを見る。
  return (
    typeof entry.attempts === 'number' && Number.isInteger(entry.attempts) && entry.attempts >= 0
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
  if (!isOwner(owner)) return null;

  const stored = parsed as Partial<StoredPunchQueue>;
  if (stored.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isOwner(stored.owner) || !sameOwner(stored.owner, owner)) return null;
  if (!Array.isArray(stored.entries)) return null;
  // 1 件でも読めなければ、まとめて読まない。
  // 読める分だけ送ると、利用者が把握できない形で打刻の順序が変わる。
  if (!stored.entries.every(isPendingPunch)) return null;

  return [...stored.entries];
}

/** 退避先の内容。読めない場合は null を返し、上書きの判断へ回す。 */
function parseUnreadableArchive(raw: string): UnreadablePunchArchive['entries'] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const archive = parsed as Partial<UnreadablePunchArchive>;
  if (archive.schemaVersion !== UNREADABLE_SCHEMA_VERSION) return null;
  if (!Array.isArray(archive.entries)) return null;

  const valid = archive.entries.every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { capturedAt?: unknown }).capturedAt === 'string' &&
      typeof (entry as { raw?: unknown }).raw === 'string',
  );
  if (!valid) return null;

  return [...archive.entries];
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
  /** 認証が切れていたときの通知。打刻は残したまま、再ログインへ導くために使う。 */
  onAuthenticationRequired?: () => void;
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
  let blocked: PunchQueueSnapshot['blocked'] = null;
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

  const unreadableKey = `${key}${UNREADABLE_SUFFIX}`;

  /**
   * 旧形式の保存内容は所有者が分からないため、件数も中身も現在の利用者へ結びつけない。
   * 読めない内容も「無い」とは扱わない。誰のものか分からない打刻が残っていることに変わりはない。
   */
  function hasLegacyEntries(): boolean {
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === null || legacy.trim() === '') return false;
    try {
      const parsed: unknown = JSON.parse(legacy);
      return Array.isArray(parsed) ? parsed.length > 0 : true;
    } catch {
      return true;
    }
  }

  function hasUnreadableEntries(): boolean {
    if (unreadable !== null) return true;
    const archived = storage.getItem(unreadableKey);
    if (archived === null) return false;
    const entries = parseUnreadableArchive(archived);
    // 退避先そのものが読めない場合も、読めない内容が残っていることに変わりはない。
    return entries === null ? true : entries.length > 0;
  }

  function currentSnapshot(): PunchQueueSnapshot {
    return {
      pending: [...pending],
      blocked,
      hasLegacyEntries: hasLegacyEntries(),
      hasUnreadableEntries: hasUnreadableEntries(),
    };
  }

  /**
   * 読めなかった内容を控えへ足す。
   * 控え自体が読めない場合は、それも失わないよう何も書かない。
   */
  function archiveUnreadable(raw: string): boolean {
    const archived = storage.getItem(unreadableKey);
    let entries: UnreadablePunchArchive['entries'] = [];
    if (archived !== null) {
      const parsed = parseUnreadableArchive(archived);
      if (parsed === null) return false;
      entries = parsed;
    }
    if (!entries.some((entry) => entry.raw === raw)) {
      entries = [...entries, { capturedAt: new Date().toISOString(), raw }];
    }
    const archive: UnreadablePunchArchive = {
      schemaVersion: UNREADABLE_SCHEMA_VERSION,
      entries,
    };
    storage.setItem(unreadableKey, JSON.stringify(archive));
    return true;
  }

  function persist(): void {
    if (unreadable !== null) {
      // 退避できないうちは、読めない内容を上書きしない。
      if (!archiveUnreadable(unreadable)) return;
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
          blocked = null;
          persist();
          notify();
          if (disposed) break;
          options.onAccepted(result);
        } catch (error) {
          const disposition = classifyPunchFailure(error);
          const message = error instanceof ApiRequestError ? error.message : '';

          if (disposition === 'permanent_rejection') {
            // 同じ要求をそのまま送り直しても成立しないと契約で決まっている応答だけを取り除く。
            pending = pending.slice(1);
            blocked = null;
            persist();
            notify();
            if (disposed) break;
            options.onRejected(entry, message);
            continue;
          }

          // 送れなかった打刻は残す。後続も送らず、順番を保ったまま次の機会を待つ。
          if (disposition === 'retry_later') entry.attempts += 1;
          blocked = { reason: disposition, message };
          persist();
          notify();
          if (disposition === 'authentication_required' && !disposed) {
            options.onAuthenticationRequired?.();
          }
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
