import type { RecordAttendanceEventResponse } from '@staffweave/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.ts';
import type { PendingPunch, PunchQueueDependencies, PunchQueueOwner } from './punch-queue.ts';
import { classifyPunchFailure, createPunchQueue, storageKeyOf } from './punch-queue.ts';

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

function createFakeStorage(initial: Record<string, string> = {}): {
  entries: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
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

  it('上書きが必要になっても、読めなかった内容を別の場所へ残す', async () => {
    const key = storageKeyOf(OWNER_A);
    const storage = createFakeStorage({ [key]: '{壊れた内容' });
    const harness = createHarness(storage);

    const queue = createPunchQueue(noopOptions(OWNER_A), harness.dependencies);
    await queue.enqueue('clock_in', new Date('2026-07-31T00:00:00.000Z'));

    expect(storage.entries.get(`${key}.unreadable`)).toBe('{壊れた内容');
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
});
