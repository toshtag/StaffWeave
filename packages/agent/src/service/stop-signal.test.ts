/**
 * 行儀よく止める合図が、置ける・読める・片付くことを確かめる。
 *
 * Windows には「行儀よく終われ」という合図が無いため、この 1 つが止める道になる。
 * ここが動かないと、止めるたびに強制終了へ落ちる。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStop, isStopRequested, requestStop, stopSignalPath } from './stop-signal.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-stop-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('停止の合図', () => {
  it('送信待ちの隣に置く', () => {
    expect(stopSignalPath('/var/lib/staffweave/agent.json.spool')).toBe(
      '/var/lib/staffweave/agent.json.spool.stop',
    );
  });

  it('置くと読め、片付けると読めなくなる', async () => {
    const path = join(directory, 'agent.spool.stop');

    expect(await isStopRequested(path)).toBe(false);

    await requestStop(path);
    expect(await isStopRequested(path)).toBe(true);

    await clearStop(path);
    expect(await isStopRequested(path)).toBe(false);
  });

  it('置き場が無くても作って置ける', async () => {
    // 常駐する前に止めようとすることもある。送信待ちの置き場はまだ無い。
    const path = join(directory, 'not-yet', 'agent.spool.stop');

    await requestStop(path);

    expect(await isStopRequested(path)).toBe(true);
  });

  it('二度置いても失敗しない', async () => {
    const path = join(directory, 'agent.spool.stop');

    await requestStop(path);
    await requestStop(path);

    expect(await isStopRequested(path)).toBe(true);
  });

  it('片付けるものが無くても失敗しない', async () => {
    // 強制終了のあとは、合図が残っていないことも残っていることもある。
    await expect(clearStop(join(directory, 'nothing.stop'))).resolves.toBeUndefined();
  });

  it('置き場がディレクトリでも、読めないとは言わない', async () => {
    // 何かがそこに在ること自体を合図として扱う。中身は約束しない。
    const path = join(directory, 'agent.spool.stop');
    await writeFile(path, 'ignored');

    expect(await isStopRequested(path)).toBe(true);
  });
});
