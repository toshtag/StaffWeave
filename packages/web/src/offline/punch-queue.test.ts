import type { RecordAttendanceEventResponse } from '@staffweave/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import type { PendingPunch, PunchQueueDependencies, PunchQueueOwner } from './punch-queue.ts';
import {
  classifyPunchFailure,
  createPunchQueue,
  isPunchQueueOwner,
  storageKeyOf,
} from './punch-queue.ts';

/**
 * 送信待ち行列の単体テスト。
 *
 * ブラウザの機能はすべて偽の実装で差し替え、Node のまま所有者境界と再送の挙動を確かめる。
 */

const OWNER_A: PunchQueueOwner = {
  workspaceId: 'workspace-1',
  userId: 'user-a',
  employeeId: 'employee-a',
};

const OWNER_B: PunchQueueOwner = {
  workspaceId: 'workspace-1',
  userId: 'user-b',
  employeeId: 'employee-b',
};

const LEGACY_STORAGE_KEY = 'staffweave.pendingPunches';

const ACCEPTED = { duplicate: false } as unknown as RecordAttendanceEventResponse;

interface FakeStorage {
  entries: Map<string, string>;
  /** 保存領域の失敗を試すための差し込み口。既定では成功する。 */
  failGetItem: (key: string) => boolean;
  failSetItem: (key: string) => boolean;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const entries = new Map(Object.entries(initial));
  const storage: FakeStorage = {
    entries,
    failGetItem: () => false,
    failSetItem: () => false,
    getItem: (key) => {
      if (storage.failGetItem(key)) throw new Error('読み取れません');
      return entries.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (storage.failSetItem(key)) throw new Error('保存できません');
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
  return storage;
}

function createFakeOnline(): {
  listenerCount: () => number;
  emit: () => void;
  subscribe: (listener: () => void) => () => void;
} {
  const listeners = new Set<() => void>();
  return {
    listenerCount: () => listeners.size,
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 保存済みの打刻を用意する。所有者を明示できるようにし、保存形式の組み立てを画面と共有する。 */
function storedQueue(
  owner: PunchQueueOwner,
  entries: PendingPunch[],
  overrides: { schemaVersion?: number; owner?: PunchQueueOwner } = {},
): string {
  return JSON.stringify({
    schemaVersion: overrides.schemaVersion ?? 2,
    owner: overrides.owner ?? owner,
    entries,
  });
}

function punch(requestId: string, occurredAt = '2026-07-31T00:00:00.000Z'): PendingPunch {
  return { requestId, eventType: 'clock_in', occurredAt, attempts: 0 };
}

/** 保存内容の検証を試すため、契約に合わない値も置けるようにする。 */
function storedRaw(owner: PunchQueueOwner, entries: unknown[]): string {
  return JSON.stringify({ schemaVersion: 2, owner, entries });
}

interface Harness {
  storage: ReturnType<typeof createFakeStorage>;
  online: ReturnType<typeof createFakeOnline>;
  send: ReturnType<typeof vi.fn>;
  dependencies: PunchQueueDependencies;
  requestIds: string[];
}

function createHarness(storage = createFakeStorage()): Harness {
  const online = createFakeOnline();
  const send = vi.fn(async () => ACCEPTED);
  const requestIds: string[] = [];
  let issued = 0;

  return {
    storage,
    online,
    send,
    requestIds,
    dependencies: {
      storage,
      send: send as unknown as PunchQueueDependencies['send'],
      createRequestId: () => {
        issued += 1;
        const id = `request-${issued}`;
        requestIds.push(id);
        return id;
      },
      subscribeOnline: online.subscribe,
    },
  };
}

function noopOptions(owner: PunchQueueOwner): {
  owner: PunchQueueOwner;
  onAccepted: () => void;
  onRejected: () => void;
} {
  return { owner, onAccepted: () => {}, onRejected: () => {} };
}

describe('送信待ち行列の所有者境界', () => {
  it('利用者 A の未送信打刻を利用者 B が送信しない', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_B), harness.dependencies);
    await queue.flush();

    expect(harness.send).not.toHaveBeenCalled();
  });

  it('利用者 B には利用者 A の件数を表示しない', () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a'), punch('request-a2')]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_B), harness.dependencies);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('利用者 A が戻ると自分の打刻を読み込める', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);

    createPunchQueue(noopOptions(OWNER_B), harness.dependencies);
    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().pending.map((entry) => entry.requestId)).toEqual(['request-a']);

    await queue.flush();
    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it('Workspace が異なれば行列を共有しない', () => {
    const other: PunchQueueOwner = { ...OWNER_A, workspaceId: 'workspace-2' };
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(other), harness.dependencies);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('利用者が同じでも従業員が異なれば行列を共有しない', () => {
    const other: PunchQueueOwner = { ...OWNER_A, employeeId: 'employee-other' };
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(other), harness.dependencies);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('保存内容の所有者が保存先と食い違う場合は送信しない', async () => {
    const storage = createFakeStorage({
      // 保存先は A でも、中身が B のものであれば読み出さない。
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-b')], { owner: OWNER_B }),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(queue.snapshot().pending).toHaveLength(0);
    expect(harness.send).not.toHaveBeenCalled();
  });
});

describe('現在の所有者の検証', () => {
  const blanks: [string, PunchQueueOwner][] = [
    ['workspaceId が空', { ...OWNER_A, workspaceId: '' }],
    ['userId が空白だけ', { ...OWNER_A, userId: '   ' }],
    ['employeeId が空', { ...OWNER_A, employeeId: '' }],
  ];

  for (const [name, owner] of blanks) {
    it(`${name}であれば行列を作らない`, () => {
      const harness = createHarness();

      expect(() => createPunchQueue(noopOptions(owner), harness.dependencies)).toThrow();
    });
  }

  it('所有者を特定できない場合は、保存も購読も送信も始めない', () => {
    const storage = createFakeStorage();
    const harness = createHarness(storage);
    const blank: PunchQueueOwner = { workspaceId: ' ', userId: ' ', employeeId: ' ' };

    expect(() => createPunchQueue(noopOptions(blank), harness.dependencies)).toThrow();

    expect(storage.entries.size).toBe(0);
    expect(harness.online.listenerCount()).toBe(0);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('保存先の名前を作る前に断る', () => {
    expect(isPunchQueueOwner(OWNER_A)).toBe(true);
    expect(isPunchQueueOwner({ ...OWNER_A, userId: '' })).toBe(false);
    expect(isPunchQueueOwner(null)).toBe(false);
    expect(isPunchQueueOwner({})).toBe(false);
  });
});

describe('送信できなかったときの扱い', () => {
  function harnessWithOnePunch(): Harness {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    return createHarness(storage);
  }

  it('取り除いてよい応答は 400 invalid_request と 409 conflict だけとする', () => {
    expect(classifyPunchFailure(new ApiRequestError(400, 'invalid_request', ''))) //
      .toBe('permanent_rejection');
    expect(classifyPunchFailure(new ApiRequestError(409, 'conflict', ''))) //
      .toBe('permanent_rejection');
    expect(classifyPunchFailure(new ApiRequestError(401, 'unauthenticated', ''))) //
      .toBe('authentication_required');
    expect(classifyPunchFailure(new ApiRequestError(403, 'forbidden', ''))) //
      .toBe('permission_blocked');
    expect(classifyPunchFailure(new ApiRequestError(500, 'internal_error', ''))) //
      .toBe('retry_later');
    expect(classifyPunchFailure(new ApiRequestError(404, 'not_found', ''))) //
      .toBe('retry_later');
    expect(classifyPunchFailure(new ApiRequestError(418, 'unknown', ''))) //
      .toBe('retry_later');
    expect(classifyPunchFailure(new TypeError('offline'))).toBe('retry_later');
  });

  it('401 では打刻を残し、再ログインが必要だと伝える', async () => {
    const harness = harnessWithOnePunch();
    harness.send.mockRejectedValue(
      new ApiRequestError(401, 'unauthenticated', 'セッションの有効期限が切れました'),
    );
    const onAuthenticationRequired = vi.fn();

    const queue = createPunchQueue(
      { ...noopOptions(OWNER_A), onAuthenticationRequired },
      harness.dependencies,
    );
    await queue.flush();

    expect(queue.snapshot().pending).toHaveLength(1);
    expect(queue.snapshot().blocked).toEqual({
      reason: 'authentication_required',
      message: 'セッションの有効期限が切れました',
    });
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
  });

  it('401 では後続の打刻も送らない', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-1'), punch('request-2')]),
    });
    const harness = createHarness(storage);
    harness.send.mockRejectedValue(new ApiRequestError(401, 'unauthenticated', ''));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().pending).toHaveLength(2);
  });

  it('403 では打刻を残し、設定の確認が必要だと伝える', async () => {
    const harness = harnessWithOnePunch();
    harness.send.mockRejectedValue(
      new ApiRequestError(403, 'forbidden', 'この操作を行う権限がありません'),
    );

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(queue.snapshot().pending).toHaveLength(1);
    expect(queue.snapshot().blocked?.reason).toBe('permission_blocked');
  });

  it('500 では打刻を残す', async () => {
    const harness = harnessWithOnePunch();
    harness.send.mockRejectedValue(new ApiRequestError(500, 'internal_error', ''));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(queue.snapshot().pending).toHaveLength(1);
    expect(queue.snapshot().blocked?.reason).toBe('retry_later');
  });

  it('契約にない応答でも打刻を消さない', async () => {
    const harness = harnessWithOnePunch();
    harness.send.mockRejectedValue(new ApiRequestError(404, 'not_found', ''));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(queue.snapshot().pending).toHaveLength(1);
  });

  it('400 invalid_request では対象の打刻だけを取り除く', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-1'), punch('request-2')]),
    });
    const harness = createHarness(storage);
    harness.send.mockRejectedValueOnce(
      new ApiRequestError(400, 'invalid_request', '要求の内容が正しくありません'),
    );
    const onRejected = vi.fn();

    const queue = createPunchQueue({ ...noopOptions(OWNER_A), onRejected }, harness.dependencies);
    await queue.flush();

    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledTimes(2);
    expect(queue.snapshot().pending).toHaveLength(0);
    expect(queue.snapshot().blocked).toBeNull();
  });

  it('409 conflict では対象の打刻だけを取り除く', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-1'), punch('request-2')]),
    });
    const harness = createHarness(storage);
    harness.send.mockRejectedValueOnce(new ApiRequestError(409, 'conflict', 'すでに退勤済みです'));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(harness.send).toHaveBeenCalledTimes(2);
    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('送信できるようになれば停止の理由を消す', async () => {
    const harness = harnessWithOnePunch();
    harness.send.mockRejectedValueOnce(new ApiRequestError(401, 'unauthenticated', ''));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();
    expect(queue.snapshot().blocked?.reason).toBe('authentication_required');

    await queue.flush();

    expect(queue.snapshot().blocked).toBeNull();
    expect(queue.snapshot().pending).toHaveLength(0);
  });
});

describe('送信待ち行列のライフサイクル', () => {
  it('online が起きると送信する', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);
    createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    harness.online.emit();
    await vi.waitFor(() => expect(harness.send).toHaveBeenCalledTimes(1));
  });

  it('dispose すると online の購読を解除する', () => {
    const harness = createHarness();
    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(harness.online.listenerCount()).toBe(1);
    queue.dispose();
    expect(harness.online.listenerCount()).toBe(0);
  });

  it('dispose 後の online では送信しない', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);
    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    queue.dispose();
    harness.online.emit();
    await queue.flush();

    expect(harness.send).not.toHaveBeenCalled();
  });

  it('dispose を複数回呼んでも問題ない', () => {
    const harness = createHarness();
    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    queue.dispose();
    queue.dispose();

    expect(harness.online.listenerCount()).toBe(0);
  });

  it('dispose 後は購読者へ通知しない', async () => {
    const harness = createHarness();
    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    const listener = vi.fn();
    queue.subscribe(listener);
    listener.mockClear();

    queue.dispose();
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('同時に flush を呼んでも二重に送信しない', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);
    let release: (() => void) | undefined;
    harness.send.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return ACCEPTED;
    });

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    const first = queue.flush();
    const second = queue.flush();
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.();
    await Promise.all([first, second]);

    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it('生成直後の flush で保存済みの打刻を送れる', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().pending).toHaveLength(0);
  });
});

describe('送信待ち行列の保存内容', () => {
  it('成功した打刻を古い順に取り除く', async () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [
        punch('request-1', '2026-07-31T00:00:00.000Z'),
        punch('request-2', '2026-07-31T01:00:00.000Z'),
      ]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    const sentIds = harness.send.mock.calls.map(
      ([input]) => (input as { requestId: string }).requestId,
    );
    expect(sentIds).toEqual(['request-1', 'request-2']);
    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('再送しても冪等キーと打刻時刻を作り直さない', async () => {
    const harness = createHarness();
    harness.send.mockRejectedValueOnce(new TypeError('offline'));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));
    const [saved] = queue.snapshot().pending;
    expect(saved?.attempts).toBe(1);

    await queue.flush();

    expect(harness.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: saved?.requestId, occurredAt: saved?.occurredAt }),
    );
  });

  it('通信できないときは行列に残し、試行回数を数える', async () => {
    const harness = createHarness();
    harness.send.mockRejectedValue(new TypeError('offline'));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));
    await queue.flush();

    const [entry] = queue.snapshot().pending;
    expect(entry?.attempts).toBe(2);
  });

  it('壊れた保存内容は送信せず、上書きで消さない', async () => {
    const key = storageKeyOf(OWNER_A);
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(harness.send).not.toHaveBeenCalled();
    expect(storage.entries.get(key)).toBe('{壊れた内容');
  });

  it('版が違う保存内容を読み込まない', () => {
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedQueue(OWNER_A, [punch('request-a')], { schemaVersion: 1 }),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().pending).toHaveLength(0);
  });
});

describe('保存内容の検証', () => {
  function queueFor(entries: unknown[]): {
    queue: ReturnType<typeof createPunchQueue>;
    sent: Harness['send'];
  } {
    const storage = createFakeStorage({ [storageKeyOf(OWNER_A)]: storedRaw(OWNER_A, entries) });
    const harness = createHarness(storage);
    return {
      queue: createPunchQueue(noopOptions(OWNER_A), harness.dependencies),
      sent: harness.send,
    };
  }

  it('契約にない打刻の種別を読み込まない', async () => {
    const { queue, sent } = queueFor([{ ...punch('request-1'), eventType: 'nap_start' }]);
    await queue.flush();

    // 未知の種別は画面の集計を落とすため、行列にも送信にも渡さない。
    expect(queue.snapshot().pending).toHaveLength(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it('日時として読めない occurredAt を読み込まない', () => {
    const { queue } = queueFor([{ ...punch('request-1'), occurredAt: '昨日の朝' }]);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('契約より短い requestId を読み込まない', () => {
    const { queue } = queueFor([punch('short')]);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('契約より長い requestId を読み込まない', () => {
    const { queue } = queueFor([punch('r'.repeat(129))]);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('保存された所有者の識別子が空であれば読み込まない', () => {
    const blank = { ...OWNER_A, employeeId: '   ' };
    const storage = createFakeStorage({
      [storageKeyOf(OWNER_A)]: storedRaw(blank, [punch('request-1')]),
    });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('1 件でも読めなければ、同じ保存内容の他の打刻も送らない', async () => {
    const { queue, sent } = queueFor([
      punch('request-1'),
      { ...punch('request-2'), eventType: 'nap_start' },
    ]);
    await queue.flush();

    expect(queue.snapshot().pending).toHaveLength(0);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('読み取れない保存内容', () => {
  const key = storageKeyOf(OWNER_A);
  const archiveKey = `${key}.unreadable`;

  it('残っていることを利用者へ知らせる', () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().hasUnreadableEntries).toBe(true);
  });

  it('新しい打刻を保存するときに元の内容を退避する', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    const archive = JSON.parse(storage.entries.get(archiveKey) ?? 'null');
    expect(archive.entries.map((entry: { raw: string }) => entry.raw)).toEqual(['{壊れた内容']);
  });

  it('別の壊れた内容を退避しても前の内容を失わない', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const first = createHarness(storage);

    const one = createPunchQueue(noopOptions(OWNER_A), first.dependencies);
    await one.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    storage.entries.set(key, '{別の壊れた内容');
    const second = createHarness(storage);
    const two = createPunchQueue(noopOptions(OWNER_A), second.dependencies);
    await two.enqueue('clock_in', new Date('2026-07-31T01:00:00.000Z'));

    const archive = JSON.parse(storage.entries.get(archiveKey) ?? 'null');
    expect(archive.entries.map((entry: { raw: string }) => entry.raw)) //
      .toEqual(['{壊れた内容', '{別の壊れた内容']);
  });

  it('同じ壊れた内容を重ねて退避しない', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const first = createHarness(storage);

    const one = createPunchQueue(noopOptions(OWNER_A), first.dependencies);
    await one.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    storage.entries.set(key, '{壊れた内容');
    const second = createHarness(storage);
    const two = createPunchQueue(noopOptions(OWNER_A), second.dependencies);
    await two.enqueue('clock_in', new Date('2026-07-31T01:00:00.000Z'));

    const archive = JSON.parse(storage.entries.get(archiveKey) ?? 'null');
    expect(archive.entries).toHaveLength(1);
  });

  it('退避した後も、次に開いたときに知らせ続ける', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const first = createHarness(storage);

    const one = createPunchQueue(noopOptions(OWNER_A), first.dependencies);
    await one.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    const second = createHarness(storage);
    const two = createPunchQueue(noopOptions(OWNER_A), second.dependencies);

    expect(two.snapshot().hasUnreadableEntries).toBe(true);
  });

  it('控えが読めない場合も、退避を進めて打刻を保存できる', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容', [archiveKey]: '{壊れた控え' });
    const harness = createHarness(storage);
    harness.send.mockRejectedValue(new TypeError('offline'));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    // 読めない控えは捨てず、生の内容として新しい控えへ包み直す。
    const archive = JSON.parse(storage.entries.get(archiveKey) ?? 'null');
    expect(archive.entries.map((entry: { raw: string }) => entry.raw)) //
      .toEqual(['{壊れた控え', '{壊れた内容']);
    expect(queue.snapshot().pending).toHaveLength(1);
    expect(queue.snapshot().hasUnreadableEntries).toBe(true);
  });
});

describe('端末へ保存できないとき', () => {
  const key = storageKeyOf(OWNER_A);
  const archiveKey = `${key}.unreadable`;

  it('保存できない打刻を受理せず、API へも送らない', async () => {
    const storage = createFakeStorage();
    storage.failSetItem = () => true;
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await expect(
      queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z')),
    ).resolves.toBeUndefined();

    // 送信待ちとして見せた打刻が再読み込みで消えると、失われたことに気付けない。
    expect(queue.snapshot().pending).toHaveLength(0);
    expect(queue.snapshot().blocked?.reason).toBe('storage_unavailable');
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('保存できた打刻は再び読み込める', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容', [archiveKey]: '{壊れた控え' });
    const first = createHarness(storage);
    first.send.mockRejectedValue(new TypeError('offline'));

    const queue = createPunchQueue(noopOptions(OWNER_A), first.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));
    expect(queue.snapshot().pending).toHaveLength(1);
    queue.dispose();

    const second = createHarness(storage);
    const restored = createPunchQueue(noopOptions(OWNER_A), second.dependencies);

    expect(restored.snapshot().pending).toHaveLength(1);
  });

  it('読み取れない控えも、生の内容として新しい控えへ包み直す', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容', [archiveKey]: '{壊れた控え' });
    const harness = createHarness(storage);
    harness.send.mockRejectedValue(new TypeError('offline'));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    const archive = JSON.parse(storage.entries.get(archiveKey) ?? 'null');
    expect(archive.entries.map((entry: { raw: string }) => entry.raw)) //
      .toEqual(['{壊れた控え', '{壊れた内容']);
  });

  it('控えを書けない場合は、元の保存内容も控えも上書きしない', async () => {
    const storage = createFakeStorage({ [key]: '{壊れた内容', [archiveKey]: '{壊れた控え' });
    storage.failSetItem = (target) => target === archiveKey;
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    expect(storage.entries.get(key)).toBe('{壊れた内容');
    expect(storage.entries.get(archiveKey)).toBe('{壊れた控え');
    expect(queue.snapshot().blocked?.reason).toBe('storage_unavailable');
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('読み取れない場合は、内容を書き換えず送信もしない', async () => {
    const storage = createFakeStorage({
      [key]: storedQueue(OWNER_A, [punch('request-a')]),
    });
    storage.failGetItem = (target) => target === key;
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    expect(queue.snapshot().blocked?.reason).toBe('storage_unavailable');
    expect(harness.send).not.toHaveBeenCalled();
    expect(storage.entries.get(key)).toBe(storedQueue(OWNER_A, [punch('request-a')]));
  });

  it('API が受理しても保存できなければ、冪等キーを保って再試行できる', async () => {
    const storage = createFakeStorage({ [key]: storedQueue(OWNER_A, [punch('request-a')]) });
    const harness = createHarness(storage);
    const onAccepted = vi.fn();

    const queue = createPunchQueue({ ...noopOptions(OWNER_A), onAccepted }, harness.dependencies);

    storage.failSetItem = () => true;
    await queue.flush();

    // 先に取り除くと、保存に失敗したときに冪等キーごと失う。
    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(queue.snapshot().pending.map((entry) => entry.requestId)).toEqual(['request-a']);
    expect(queue.snapshot().blocked?.reason).toBe('storage_unavailable');

    storage.failSetItem = () => false;
    await queue.flush();

    // 同じ冪等キーで送り直すため、サーバー側の記録は 1 件に収まる。
    expect(harness.send).toHaveBeenCalledTimes(2);
    expect(harness.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'request-a' }),
    );
    expect(queue.snapshot().pending).toHaveLength(0);
    expect(queue.snapshot().blocked).toBeNull();
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it('恒久的な拒否も、保存できてから取り除く', async () => {
    const storage = createFakeStorage({ [key]: storedQueue(OWNER_A, [punch('request-a')]) });
    const harness = createHarness(storage);
    const onRejected = vi.fn();
    harness.send.mockRejectedValue(new ApiRequestError(409, 'conflict', 'すでに退勤済みです'));

    const queue = createPunchQueue({ ...noopOptions(OWNER_A), onRejected }, harness.dependencies);

    storage.failSetItem = () => true;
    await queue.flush();

    expect(onRejected).not.toHaveBeenCalled();
    expect(queue.snapshot().pending).toHaveLength(1);
    expect(queue.snapshot().blocked?.reason).toBe('storage_unavailable');

    storage.failSetItem = () => false;
    await queue.flush();

    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('試行回数も、保存できてから数える', async () => {
    const storage = createFakeStorage({ [key]: storedQueue(OWNER_A, [punch('request-a')]) });
    const harness = createHarness(storage);
    harness.send.mockRejectedValue(new TypeError('offline'));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    storage.failSetItem = () => true;
    await queue.flush();

    expect(queue.snapshot().pending[0]?.attempts).toBe(0);
    expect(queue.snapshot().blocked?.reason).toBe('storage_unavailable');
  });

  it('保存の失敗を送信の失敗として扱わない', async () => {
    const storage = createFakeStorage({ [key]: storedQueue(OWNER_A, [punch('request-a')]) });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    storage.failSetItem = () => true;
    await queue.flush();

    // 通信は成功しているため、一時的な送信失敗として見せてはいけない。
    expect(queue.snapshot().blocked?.reason).not.toBe('retry_later');
  });

  it('認証切れでは端末へ書き込まない', async () => {
    const storage = createFakeStorage({ [key]: storedQueue(OWNER_A, [punch('request-a')]) });
    const harness = createHarness(storage);
    harness.send.mockRejectedValue(new ApiRequestError(401, 'unauthenticated', ''));

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    storage.failSetItem = () => true;
    await queue.flush();

    // 行列の中身が変わらないため、保存に失敗しても影響を受けない。
    expect(queue.snapshot().blocked?.reason).toBe('authentication_required');
    expect(queue.snapshot().pending).toHaveLength(1);
  });
});

describe('旧形式の保存内容', () => {
  const legacy = JSON.stringify([
    { requestId: 'legacy-1', eventType: 'clock_in', occurredAt: '2026-07-30T00:00:00.000Z' },
  ]);

  it('現在の利用者のものとして送信しない', async () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: legacy });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.flush();

    expect(harness.send).not.toHaveBeenCalled();
    expect(queue.snapshot().pending).toHaveLength(0);
  });

  it('自動で削除しない', async () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: legacy });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    expect(storage.entries.get(LEGACY_STORAGE_KEY)).toBe(legacy);
  });

  it('残っていることを利用者へ知らせる', () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: legacy });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().hasLegacyEntries).toBe(true);
  });

  it('空であれば知らせない', () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: '[]' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().hasLegacyEntries).toBe(false);
  });

  it('読めない内容でも知らせる', () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: '{壊れた内容' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    // 読めないだけで、誰のものか分からない打刻が残っていることに変わりはない。
    expect(queue.snapshot().hasLegacyEntries).toBe(true);
  });

  it('配列でない内容でも知らせる', () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: '{"requestId":"legacy"}' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().hasLegacyEntries).toBe(true);
  });

  it('空白だけであれば知らせない', () => {
    const storage = createFakeStorage({ [LEGACY_STORAGE_KEY]: '   ' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);

    expect(queue.snapshot().hasLegacyEntries).toBe(false);
  });
});
