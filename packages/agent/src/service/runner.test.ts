/**
 * 送信待ちを順に送る処理を確かめる。
 *
 * 大事なのは「飛ばさないこと」。飛ばすとサーバー側の連番が飛び、
 * あとの打刻まで拒まれる。
 */
import { describe, expect, it } from 'vitest';
import { createAgentLogger } from './redact.js';
import { flushSpool, runAgent, type SendOutcome } from './runner.js';
import type { Spool, SpooledPunch } from './spool.js';

function punch(requestId: string, sequence = 1): SpooledPunch {
  return {
    kind: 'employee',
    requestId,
    sequence,
    employeeNumber: 'E001',
    eventType: 'clock_in',
    occurredAt: '2026-04-01T00:00:00.000Z',
    queuedAt: '2026-04-01T00:00:01.000Z',
  };
}

function memorySpool(initial: SpooledPunch[]): Spool & { entries: SpooledPunch[] } {
  const entries = [...initial];
  return {
    entries,
    add: async (item) => {
      entries.push(item);
    },
    list: async () => [...entries],
    remove: async (requestId) => {
      const index = entries.findIndex((entry) => entry.requestId === requestId);
      if (index >= 0) entries.splice(index, 1);
    },
    listUnreadable: async () => [],
  };
}

const lines: string[] = [];
const logger = createAgentLogger((line) => lines.push(line));

describe('送信待ちを送る', () => {
  it('受け付けられたものを外す', async () => {
    const spool = memorySpool([punch('a'), punch('b')]);

    const result = await flushSpool({
      spool,
      logger,
      send: async () => ({ kind: 'accepted' }),
    });

    expect(result).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(spool.entries).toEqual([]);
  });

  it('送れなかったところで止める', async () => {
    const spool = memorySpool([punch('a'), punch('b'), punch('c')]);
    const tried: string[] = [];

    const result = await flushSpool({
      spool,
      logger,
      send: async (item) => {
        tried.push(item.requestId);
        return item.requestId === 'b'
          ? ({ kind: 'retry', reason: '接続できません' } as SendOutcome)
          : ({ kind: 'accepted' } as SendOutcome);
      },
    });

    // 飛ばして c を送らない。飛ばすと連番が飛ぶ。
    expect(tried).toEqual(['a', 'b']);
    expect(result).toEqual({ sent: 1, dropped: 0, remaining: 2 });
  });

  it('送り直しても通らないものは外し、記録に残す', async () => {
    const spool = memorySpool([punch('a'), punch('b')]);
    lines.length = 0;

    const result = await flushSpool({
      spool,
      logger,
      send: async (item) =>
        item.requestId === 'a'
          ? ({ kind: 'rejected', reason: '従業員が見つかりません' } as SendOutcome)
          : ({ kind: 'accepted' } as SendOutcome),
    });

    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    // 残さないと、届かなかった打刻が誰にも見えない。
    expect(lines.join('\n')).toContain('agent.punch_dropped');
  });
});

describe('常駐して送り続ける', () => {
  it('送れない間は間隔を広げる', async () => {
    const spool = memorySpool([punch('a')]);
    const waits: number[] = [];
    let rounds = 0;

    await runAgent({
      spool,
      logger,
      send: async () => ({ kind: 'retry', reason: '接続できません' }),
      sleep: async (ms) => {
        waits.push(ms);
      },
      running: () => {
        rounds += 1;
        return rounds <= 3;
      },
      retryPolicy: {
        initialDelayMs: 100,
        multiplier: 2,
        maximumDelayMs: 10_000,
        maximumAttempts: 99,
      },
      jitter: () => 0,
    });

    expect(waits).toEqual([100, 200, 400]);
  });

  it('送り切ったら、決めた間隔で見に行く', async () => {
    const spool = memorySpool([punch('a')]);
    const waits: number[] = [];
    let rounds = 0;

    await runAgent({
      spool,
      logger,
      send: async () => ({ kind: 'accepted' }),
      sleep: async (ms) => {
        waits.push(ms);
      },
      running: () => {
        rounds += 1;
        return rounds <= 2;
      },
      idleIntervalMs: 5_000,
      jitter: () => 0,
    });

    expect(waits).toEqual([5_000, 5_000]);
  });
});
