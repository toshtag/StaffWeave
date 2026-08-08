/**
 * 常駐しているプロセスが、カードを待っている途中でも止まること。
 *
 * ここは実際にプロセスを立てて確かめます。関数を呼ぶだけの検査では、
 * 「合図が読み取りまで届いているか」を見たことになりません。実際、
 * `runStation()` が合図を `runCardStation()` へ渡していない状態のまま、
 * 関数の検査も Windows の検査も緑でした。
 *
 * 偽の装置は、打ち切られるまで輪を保ちます（`setInterval`）。保たないと、
 * 送信側さえ止まればプロセスは終われてしまい、合図が届いていなくても
 * この検査は通ります。本物の装置は待ち受けを持つため、プロセスは終われません。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(REPOSITORY_ROOT, 'packages/agent/src/cli.ts');

/** 上がるのを待つ上限。CI の遅い環境でも足りる長さにする。 */
const START_TIMEOUT_MS = 30_000;
/** 止まるのを待つ上限。合図が届いていなければ、ここで落ちる。 */
const STOP_TIMEOUT_MS = 20_000;

let directory: string;
let store: string;

/**
 * カードが来ないまま待ち続ける装置。
 *
 * `setInterval` を持たせて、待っている間はプロセスが終われないようにする。
 * これが無いと、合図が届いていなくても「止まった」ように見える。
 */
function transportSource(mode: 'card' | 'removal'): string {
  const waiting = `(signal) => new Promise((_resolve, reject) => {
      // 打ち切られるまで輪を保つ。本物の装置も待ち受けを持つ。
      const holder = setInterval(() => {}, 1000);
      const finish = () => {
        clearInterval(holder);
        reject(new Error('aborted'));
      };
      if (signal?.aborted) { finish(); return; }
      signal?.addEventListener('abort', finish, { once: true });
    })`;

  // 離脱待ちを試すときは、カードは即座に置かれたことにして、
  // 同じカードを返し続ける。二度目からは離脱待ちへ入る。
  return `export function createPcscTransport() {
  return {
    name: '${mode}',
    waitForCard: ${mode === 'card' ? waiting : 'async () => {}'},
    transmit: async () => new Uint8Array([0x04, 0xa1, 0xb2, 0xc3, 0x90, 0x00]),
    waitForRemoval: ${mode === 'removal' ? waiting : 'async () => {}'},
    reconnect: async () => {},
    close: async () => { console.log('transport-closed'); },
  };
}
`;
}

/** 端末として登録済みの資格情報。送り先へは繋がらないが、常駐は上がる。 */
const CREDENTIALS = {
  baseUrl: 'https://staffweave.invalid',
  deviceId: '00000000-0000-4000-8000-000000000000',
  workspaceSlug: 'default',
  privateKeyPem: '',
  publicKeyPem: '',
  nextSequence: 1,
  cardFingerprintKey: '0123456789abcdef',
};

function runCli(args: readonly string[]): ReturnType<typeof spawn> {
  return spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 出力に決めた文字列が出るまで待つ。出なければ、そこで諦める。 */
function waitForOutput(
  child: ReturnType<typeof spawn>,
  needle: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let seen = '';
    const timer = setTimeout(() => {
      reject(new Error(`「${needle}」が出ませんでした。出力: ${seen}`));
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      seen += chunk.toString();
      if (seen.includes(needle)) {
        clearTimeout(timer);
        resolvePromise(seen);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
  });
}

/** 終わるまで待つ。終わらなければ null を返す。 */
function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(null), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolvePromise(code ?? 0);
    });
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-station-stop-'));
  store = join(directory, 'agent.json');
  await writeFile(store, JSON.stringify(CREDENTIALS), { mode: 0o600 });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function stationStopsWhileWaiting(mode: 'card' | 'removal'): Promise<{
  code: number | null;
  output: string;
}> {
  const transport = join(directory, `${mode}-transport.mjs`);
  await writeFile(transport, transportSource(mode));

  const station = runCli(['station', '--store', store, '--pcsc', transport]);
  let output = await waitForOutput(station, 'agent.started', START_TIMEOUT_MS);
  station.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  // 読み取りが待ちに入るまで、少しだけ置く。
  await new Promise((done) => setTimeout(done, 1_000));

  const stop = runCli(['stop', '--store', store]);
  await waitForExit(stop, START_TIMEOUT_MS);

  const code = await waitForExit(station, STOP_TIMEOUT_MS);
  if (code === null) station.kill('SIGKILL');
  return { code, output };
}

describe('常駐している station を止める', () => {
  it(
    'カードを待っている途中でも止まり、装置を閉じる',
    async () => {
      const { code, output } = await stationStopsWhileWaiting('card');

      // 合図が読み取りまで届いていなければ、ここで null になる。
      expect(code).toBe(0);
      // 開いたまま終わると、次に上げたときに装置を掴めない。
      expect(output).toContain('transport-closed');
      expect(output).toContain('agent.stopped');
    },
    START_TIMEOUT_MS + STOP_TIMEOUT_MS + 10_000,
  );

  it(
    '離脱を待っている途中でも止まる',
    async () => {
      const { code } = await stationStopsWhileWaiting('removal');

      expect(code).toBe(0);
    },
    START_TIMEOUT_MS + STOP_TIMEOUT_MS + 10_000,
  );

  it(
    '止めても、送信待ちは消えない',
    async () => {
      const transport = join(directory, 'card-transport.mjs');
      await writeFile(transport, transportSource('card'));

      // 先に 1 件積んでおく。送り先へは繋がらないので、残ったままになる。
      const queued = runCli([
        'queue',
        '--store',
        store,
        '--employee',
        'E001',
        '--type',
        'clock_in',
      ]);
      await waitForExit(queued, START_TIMEOUT_MS);

      const station = runCli(['station', '--store', store, '--pcsc', transport]);
      await waitForOutput(station, 'agent.started', START_TIMEOUT_MS);
      await new Promise((done) => setTimeout(done, 1_000));

      const stop = runCli(['stop', '--store', store]);
      await waitForExit(stop, START_TIMEOUT_MS);
      const code = await waitForExit(station, STOP_TIMEOUT_MS);
      if (code === null) station.kill('SIGKILL');

      expect(code).toBe(0);

      // 送信待ちのファイルは残る。止めるたびに消えると、送れていない打刻が失われる。
      const { readdir } = await import('node:fs/promises');
      const spooled = await readdir(`${store}.spool`);
      expect(spooled.filter((name) => name.endsWith('.json'))).toHaveLength(1);
    },
    START_TIMEOUT_MS * 2 + STOP_TIMEOUT_MS + 10_000,
  );

  it(
    '止めたあと、合図のファイルを残さない',
    async () => {
      const transport = join(directory, 'card-transport.mjs');
      await writeFile(transport, transportSource('card'));

      const station = runCli(['station', '--store', store, '--pcsc', transport]);
      await waitForOutput(station, 'agent.started', START_TIMEOUT_MS);
      await new Promise((done) => setTimeout(done, 1_000));

      const stop = runCli(['stop', '--store', store]);
      await waitForExit(stop, START_TIMEOUT_MS);
      const code = await waitForExit(station, STOP_TIMEOUT_MS);
      if (code === null) station.kill('SIGKILL');

      expect(code).toBe(0);
      // 残したまま次に上げると、上がった直後に止まる。
      await expect(readFile(`${store}.spool.stop`, 'utf8')).rejects.toThrow();
    },
    START_TIMEOUT_MS + STOP_TIMEOUT_MS + 10_000,
  );
});
