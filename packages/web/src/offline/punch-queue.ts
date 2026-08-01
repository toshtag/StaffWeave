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

/**
 * 行列が止まっている理由。利用者へ次に何をすればよいかを伝えるために使う。
 *
 * 端末へ保存できないことは API の失敗ではないため、応答の分類とは別に持つ。
 */
export type PunchBlockedReason =
  | Exclude<PunchFailureDisposition, 'permanent_rejection'>
  | 'storage_read_unavailable'
  | 'storage_write_unavailable';

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
 * 新しい打刻を受け付けてよい状態か。
 *
 * 保存内容を読めていない間は、送信待ちが残っているかどうかを確かめられない。
 * その状態で打刻を受け取ると、すでに保存されている同じ打刻と二重になる。
 */
export function acceptsNewPunch(snapshot: PunchQueueSnapshot): boolean {
  return snapshot.blocked?.reason !== 'storage_read_unavailable';
}

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

/**
 * 送信待ち打刻の持ち主として使える値か。
 *
 * 所有者の 3 値がこの機能の安全性の根拠なので、保存内容にも現在の利用者にも同じ判定を使う。
 */
export function isPunchQueueOwner(value: unknown): value is PunchQueueOwner {
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
  if (!isPunchQueueOwner(owner)) return null;

  const stored = parsed as Partial<StoredPunchQueue>;
  if (stored.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isPunchQueueOwner(stored.owner) || !sameOwner(stored.owner, owner)) return null;
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

/**
 * ブラウザで使う依存。単体テストからは偽の実装へ差し替える。
 *
 * localStorage は取り出す時点でも例外を投げ得るため、呼び出しのたびに評価する。
 */
export function browserPunchQueueDependencies(): PunchQueueDependencies {
  return {
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    },
    send: (input) => api.recordAttendanceEvent(input),
    createRequestId: () => crypto.randomUUID(),
    subscribeOnline: (listener) => {
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
  };
}

/**
 * 端末保存の読み書き。
 *
 * 保存領域は容量や設定によって例外を投げる。
 * 失敗を戻り値にして、API の失敗と混ざらないようにする。
 * 例外の中身は利用者の役に立たないため、画面へは持ち出さない。
 */
function readStorage(
  storage: PunchQueueDependencies['storage'],
  key: string,
): { ok: true; value: string | null } | { ok: false } {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

function writeStorage(
  storage: PunchQueueDependencies['storage'],
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 旧形式の保存内容が残っているか。読めない場合も残っているものとして扱う。 */
function containsLegacyEntries(raw: string | null): boolean {
  if (raw === null || raw.trim() === '') return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length > 0 : true;
  } catch {
    return true;
  }
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

  // 所有者を特定できないまま保存先を作ると、誰のものとも言えない打刻が残る。
  // 保存も購読も送信も始める前に断る。
  if (!isPunchQueueOwner(owner)) {
    throw new Error('送信待ち打刻の持ち主を特定できません');
  }

  const { storage, send, createRequestId, subscribeOnline } = dependencies;
  const key = storageKeyOf(owner);

  const listeners = new Set<QueueListener>();
  let pending: PendingPunch[] = [];
  let blocked: PunchQueueSnapshot['blocked'] = null;
  let flushing = false;
  let disposed = false;

  const unreadableKey = `${key}${UNREADABLE_SUFFIX}`;

  /** 読めなかった保存内容。空で上書きして消さないよう、書き込む前に退避する。 */
  let unreadable: string | null = null;

  /**
   * 保存内容を読めたかどうか。
   * 読めないまま書くと、その所有者の打刻を退避もできずに消してしまう。
   *
   * false になるのは読み込みに失敗したときだけで、その間は保存も送信もしない。
   * つまり、この値が false の間に行列の中身が増えることはない。
   */
  let readable = true;

  let hasLegacy = false;
  let hasUnreadable = false;

  const stored = readStorage(storage, key);
  if (!stored.ok) {
    readable = false;
    blocked = { reason: 'storage_read_unavailable', message: '' };
  } else if (stored.value !== null) {
    const loaded = parseStored(stored.value, owner);
    if (loaded === null) {
      unreadable = stored.value;
      hasUnreadable = true;
    } else {
      pending = loaded;
    }
  }

  const legacy = readStorage(storage, LEGACY_STORAGE_KEY);
  // 旧形式の保存内容は所有者が分からないため、件数も中身も現在の利用者へ結びつけない。
  hasLegacy = legacy.ok && containsLegacyEntries(legacy.value);

  if (!hasUnreadable) {
    const archived = readStorage(storage, unreadableKey);
    if (archived.ok && archived.value !== null) {
      const entries = parseUnreadableArchive(archived.value);
      // 控えそのものが読めない場合も、読めない内容が残っていることに変わりはない。
      hasUnreadable = entries === null || entries.length > 0;
    }
  }

  function currentSnapshot(): PunchQueueSnapshot {
    return {
      pending: [...pending],
      blocked,
      hasLegacyEntries: hasLegacy,
      hasUnreadableEntries: hasUnreadable,
    };
  }

  /**
   * 読めなかった内容を控えへ足す。
   * 控え自体が読めない場合は、その生の内容も 1 件として包み直し、どちらも失わない。
   */
  function archiveUnreadable(raw: string): boolean {
    const archived = readStorage(storage, unreadableKey);
    if (!archived.ok) return false;

    let entries: UnreadablePunchArchive['entries'] = [];
    if (archived.value !== null) {
      entries = parseUnreadableArchive(archived.value) ?? [
        { capturedAt: new Date().toISOString(), raw: archived.value },
      ];
    }
    if (!entries.some((entry) => entry.raw === raw)) {
      entries = [...entries, { capturedAt: new Date().toISOString(), raw }];
    }

    const archive: UnreadablePunchArchive = {
      schemaVersion: UNREADABLE_SCHEMA_VERSION,
      entries,
    };
    if (!writeStorage(storage, unreadableKey, JSON.stringify(archive))) return false;

    hasUnreadable = true;
    return true;
  }

  /**
   * 提案された行列を端末へ保存する。
   * 成功した場合だけ true を返す。呼び出し側は、成功してから内部の状態を進める。
   */
  function persistEntries(entries: readonly PendingPunch[]): boolean {
    if (!readable) return false;
    if (unreadable !== null) {
      // 退避できないうちは、読めない内容を上書きしない。
      if (!archiveUnreadable(unreadable)) return false;
      unreadable = null;
    }
    const next: StoredPunchQueue = {
      schemaVersion: SCHEMA_VERSION,
      owner,
      entries: [...entries],
    };
    return writeStorage(storage, key, JSON.stringify(next));
  }

  function notify(): void {
    if (disposed) return;
    const snapshot = currentSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  function blockOnStorageRead(): void {
    blocked = { reason: 'storage_read_unavailable', message: '' };
    notify();
  }

  function blockOnStorageWrite(): void {
    blocked = { reason: 'storage_write_unavailable', message: '' };
    notify();
  }

  /**
   * 保存内容を読み直す。
   *
   * 保存領域の障害は、設定の変更や空き容量の確保で解消することがある。
   * 読めないままにすると、画面が案内する再操作では直らず、読み込み直すしかなくなる。
   *
   * 読めない間は保存も送信もしていないため、ここで読み直した内容が正本になる。
   */
  function restoreCurrentEntries(): boolean {
    const stored = readStorage(storage, key);
    if (!stored.ok) {
      blockOnStorageRead();
      return false;
    }

    if (stored.value === null) {
      pending = [];
      unreadable = null;
    } else {
      const loaded = parseStored(stored.value, owner);
      if (loaded === null) {
        pending = [];
        unreadable = stored.value;
        hasUnreadable = true;
      } else {
        pending = loaded;
        unreadable = null;
      }
    }

    readable = true;
    // 認証や権限など、保存以外の理由で止まっている場合はそのままにする。
    if (blocked?.reason === 'storage_read_unavailable') blocked = null;
    notify();
    return true;
  }

  /**
   * 送信に失敗したときの後始末。
   * 次の打刻へ進んでよい場合だけ true を返す。
   */
  function handleSendFailure(entry: PendingPunch, error: unknown): boolean {
    const disposition = classifyPunchFailure(error);
    const message = error instanceof ApiRequestError ? error.message : '';

    if (disposition === 'permanent_rejection') {
      // 同じ要求をそのまま送り直しても成立しないと契約で決まっている応答だけを取り除く。
      const next = pending.slice(1);
      if (!persistEntries(next)) {
        blockOnStorageWrite();
        return false;
      }
      pending = next;
      blocked = null;
      notify();
      if (disposed) return false;
      options.onRejected(entry, message);
      return true;
    }

    if (disposition === 'retry_later') {
      // 試行回数も保存できた場合だけ数える。
      const next = [{ ...entry, attempts: entry.attempts + 1 }, ...pending.slice(1)];
      if (!persistEntries(next)) {
        blockOnStorageWrite();
        return false;
      }
      pending = next;
    }

    // 認証と権限の失敗では行列の中身が変わらないため、端末へは書かない。
    blocked = { reason: disposition, message };
    notify();
    if (disposition === 'authentication_required' && !disposed) {
      options.onAuthenticationRequired?.();
    }
    return false;
  }

  async function flush(): Promise<void> {
    if (disposed || flushing) return;
    if (!readable && !restoreCurrentEntries()) return;
    flushing = true;
    try {
      while (pending.length > 0) {
        const entry = pending[0];
        if (entry === undefined) break;

        let result: RecordAttendanceEventResponse;
        try {
          // 例外として扱うのは通信だけにする。
          // 端末保存や画面への通知まで囲むと、その失敗を API の失敗として分類してしまう。
          result = await send({
            eventType: entry.eventType,
            occurredAt: entry.occurredAt,
            requestId: entry.requestId,
            source: 'mobile',
          });
        } catch (error) {
          if (handleSendFailure(entry, error)) continue;
          break;
        }

        // 受理された打刻は、行列から外した状態を保存できてから取り除く。
        // 先に取り除くと、保存に失敗したときに冪等キーごと失う。
        const next = pending.slice(1);
        if (!persistEntries(next)) {
          blockOnStorageWrite();
          break;
        }
        pending = next;
        blocked = null;
        notify();
        if (disposed) break;
        options.onAccepted(result);
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

      if (!readable) {
        // 保存できないうちは冪等キーも発行しない。使われない値を増やさない。
        if (!restoreCurrentEntries()) return;

        // 読み直して送信待ちが見つかった場合、利用者の操作はその打刻を送ることで満たされる。
        // 画面には送信待ちが見えていないため、同じ打刻をもう一度押していることが多い。
        // ここで足すと二重に送り、サーバーに断られて利用者へエラーだけが残る。
        if (pending.length > 0) {
          await flush();
          return;
        }
      }

      const entry: PendingPunch = {
        requestId: createRequestId(),
        eventType,
        occurredAt: occurredAt.toISOString(),
        attempts: 0,
      };
      const next = [...pending, entry];

      // 端末へ保存できない打刻は受理しない。
      // 送信待ちとして見せた打刻が再読み込みで消えると、利用者は失われたことに気付けない。
      if (!persistEntries(next)) {
        blockOnStorageWrite();
        return;
      }

      pending = next;
      blocked = null;
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
