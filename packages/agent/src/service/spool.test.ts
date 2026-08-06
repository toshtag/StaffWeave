/**
 * 送信待ちが、落ちても消えないことを確かめる。
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileSpool, type SpooledPunch } from './spool.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-spool-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function punch(overrides: Partial<SpooledPunch> & { requestId: string }): SpooledPunch {
  return {
    employeeNumber: 'E001',
    eventType: 'clock_in',
    occurredAt: '2026-04-01T00:00:00.000Z',
    queuedAt: '2026-04-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('送信待ちの置き場', () => {
  it('積んだ順に返す', async () => {
    const spool = createFileSpool(directory);
    await spool.add(punch({ requestId: 'punch-0001' }));
    await spool.add(punch({ requestId: 'punch-0002' }));

    expect((await spool.list()).map((entry) => entry.requestId)).toEqual([
      'punch-0001',
      'punch-0002',
    ]);
  });

  it('別の手が読んでも、半端な内容を拾わない', async () => {
    const spool = createFileSpool(directory);
    await spool.add(punch({ requestId: 'punch-0001' }));

    // 書き途中のファイルは、名前を変えるまで送信待ちとして拾われない。
    const names = await readdir(directory);
    expect(names.every((name) => !name.endsWith('.partial'))).toBe(true);
  });

  it('送れたものを外す', async () => {
    const spool = createFileSpool(directory);
    await spool.add(punch({ requestId: 'punch-0001' }));
    await spool.add(punch({ requestId: 'punch-0002' }));

    await spool.remove('punch-0001');

    expect((await spool.list()).map((entry) => entry.requestId)).toEqual(['punch-0002']);
  });

  it('途中を外しても、同じ名前を二度使わない', async () => {
    const spool = createFileSpool(directory);
    await spool.add(punch({ requestId: 'punch-0001' }));
    await spool.add(punch({ requestId: 'punch-0002' }));
    await spool.remove('punch-0002');
    await spool.add(punch({ requestId: 'punch-0003' }));

    // 連番が戻ると、あとから積んだ打刻が先に送られる。
    expect((await spool.list()).map((entry) => entry.requestId)).toEqual([
      'punch-0001',
      'punch-0003',
    ]);
  });

  it('読めないものは印を付けて外し、捨てない', async () => {
    const spool = createFileSpool(directory);
    await spool.add(punch({ requestId: 'punch-0001' }));
    await writeFile(join(directory, '000000000002-broken.json'), '{ 途中で切れ');

    expect((await spool.list()).map((entry) => entry.requestId)).toEqual(['punch-0001']);
    // 中身を人が確かめて手で入れ直せるよう、ファイルは残す。
    expect(await spool.listUnreadable()).toEqual(['000000000002-broken.json.unreadable']);
  });

  it('形の違うものも、送信待ちとして扱わない', async () => {
    const spool = createFileSpool(directory);
    await writeFile(join(directory, '000000000001-wrong.json'), '{"requestId":"x"}');

    expect(await spool.list()).toEqual([]);
    expect(await spool.listUnreadable()).toHaveLength(1);
  });

  it('置き場が無ければ作る', async () => {
    const nested = join(directory, 'a', 'b');
    const spool = createFileSpool(nested);

    await spool.add(punch({ requestId: 'punch-0001' }));

    expect(await spool.list()).toHaveLength(1);
  });
});
