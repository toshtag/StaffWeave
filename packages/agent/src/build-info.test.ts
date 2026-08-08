/**
 * 配布物が持つ版と、動かしている Node の食い違いを見つけられること。
 *
 * 読み取り装置の部品は Node の版ごとの取り決め（ABI）に合わせて組み立てられる。
 * 別の版で読み込もうとすると、組み込みの側が落ちる。その言葉は端末の前の人に
 * 何をすればよいかを伝えないため、先にこちらの言葉で止める。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BuildInfo, loadBuildInfo, nodeMismatchOf, UNPACKAGED } from './build-info.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'staffweave-build-info-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function build(overrides: Partial<BuildInfo> = {}): BuildInfo {
  return {
    version: '0.1.0',
    sourceSha: '1111111111111111111111111111111111111111',
    nodeMajor: '24',
    reader: 'pcsclite@1.0.1',
    ...overrides,
  };
}

describe('Node の版の食い違い', () => {
  it('合っていれば、何も言わない', () => {
    expect(nodeMismatchOf(build(), '24.3.0')).toBeNull();
  });

  it('主版が違えば、どちらの版かを添えて止める', () => {
    const problem = nodeMismatchOf(build(), '22.14.0');

    expect(problem).toContain('Node 24');
    expect(problem).toContain('22');
  });

  /**
   * 読み取りの部品を持たない配布物は、版を選ばない。
   *
   * 組み立てた部品が無ければ、取り決めに縛られる理由も無い。ここで止めると、
   * 読み取り装置を使わない端末まで動かせなくなる。
   */
  it('読み取りの部品を持たなければ、版を問わない', () => {
    expect(nodeMismatchOf(build({ reader: '' }), '22.14.0')).toBeNull();
  });

  it('リポジトリから動かしているときは、版を問わない', () => {
    expect(nodeMismatchOf(UNPACKAGED, '22.14.0')).toBeNull();
  });
});

describe('配布物の情報を読む', () => {
  it('置かれていれば、そのまま読む', async () => {
    await writeFile(join(directory, 'build-info.json'), JSON.stringify(build()));

    expect(await loadBuildInfo(directory)).toEqual(build());
  });

  it('置かれていなければ、配布物ではないと分かる形で返す', async () => {
    // リポジトリから直接動かしているときは置かれていない。失敗にはしない。
    expect(await loadBuildInfo(directory)).toEqual(UNPACKAGED);
  });

  it('壊れていても、落とさない', async () => {
    await writeFile(join(directory, 'build-info.json'), '{');

    expect(await loadBuildInfo(directory)).toEqual(UNPACKAGED);
  });

  it('欠けている項目は、空として扱う', async () => {
    await writeFile(join(directory, 'build-info.json'), JSON.stringify({ version: '0.1.0' }));

    expect(await loadBuildInfo(directory)).toEqual({
      version: '0.1.0',
      sourceSha: '',
      nodeMajor: '',
      reader: '',
    });
  });
});
