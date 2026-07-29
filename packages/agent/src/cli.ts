/**
 * 打刻端末シミュレーター。
 *
 * 実機を用意せずに、端末の登録から署名イベントの送信までを試せるようにする。
 * OS 固有の実装は含まない。ここで確かめるのはサーバーとの取り決めだけ。
 *
 *   pnpm agent enroll --url http://127.0.0.1:8787 --token <登録トークン>
 *   pnpm agent punch --employee E001 --type clock_in
 *   pnpm agent replay        直前に送ったイベントをそのまま再送する
 *   pnpm agent status        保存されている資格情報を表示する
 */
import { randomUUID } from 'node:crypto';
import type { AttendanceEventType } from '@staffweave/domain';
import { isAttendanceEventType } from '@staffweave/domain';
import { AgentRequestError, enroll, sendEvent } from './client.js';
import type { DeviceCredentials } from './credentials.js';
import { generateKeyPair, loadCredentials, saveCredentials } from './credentials.js';

const DEFAULT_STORE = '.staffweave-agent.json';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function storePath(): string {
  return option('store') ?? DEFAULT_STORE;
}

function requireOption(name: string): string {
  const value = option(name);
  if (value === undefined || value === '') {
    throw new Error(`--${name} を指定してください`);
  }
  return value;
}

interface LastEvent {
  sequence: number;
  requestId: string;
  employeeNumber: string;
  eventType: AttendanceEventType;
  occurredAt: string;
}

interface StoredCredentials extends DeviceCredentials {
  lastEvent?: LastEvent;
}

async function runEnroll(): Promise<void> {
  const baseUrl = requireOption('url').replace(/\/$/, '');
  const token = requireOption('token');
  const keyPair = generateKeyPair();

  const result = await enroll(baseUrl, {
    enrollmentToken: token,
    publicKey: keyPair.publicKeyPem,
  });

  const credentials: StoredCredentials = {
    baseUrl,
    deviceId: result.deviceId,
    workspaceSlug: result.workspaceSlug,
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
    nextSequence: result.device.lastSequence + 1,
  };
  await saveCredentials(storePath(), credentials);

  console.log(`端末を登録しました: ${result.device.name}（${result.deviceId}）`);
  console.log(`資格情報を保存しました: ${storePath()}`);
  console.log('秘密鍵はこのファイルにのみ存在します。共有しないでください。');
}

async function runPunch(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const employeeNumber = requireOption('employee');
  const eventType = option('type') ?? 'clock_in';
  if (!isAttendanceEventType(eventType)) {
    throw new Error(`--type が不正です: ${eventType}`);
  }

  const now = new Date();
  const occurredAt = option('at') ?? now.toISOString();
  const event: LastEvent = {
    sequence: credentials.nextSequence,
    requestId: randomUUID(),
    employeeNumber,
    eventType,
    occurredAt,
  };

  const { status, body } = await sendEvent(credentials, {
    ...event,
    deviceTime: now.toISOString(),
  });

  await saveCredentials(storePath(), {
    ...credentials,
    nextSequence: event.sequence + 1,
    lastEvent: event,
  });

  console.log(`${status === 201 ? '受理' : '再送として受理'}: ${body.outcome}`);
  console.log(`業務日: ${body.businessDate}`);
  if (body.sequenceStep > 1) {
    console.log(`連番の欠落: ${body.sequenceStep - 1} 件`);
  }
  console.log(`端末時計のずれ: ${body.clockSkewSeconds} 秒`);
}

async function runReplay(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const last = credentials.lastEvent;
  if (!last) throw new Error('再送できるイベントがありません');

  const { status, body } = await sendEvent(credentials, {
    ...last,
    deviceTime: new Date().toISOString(),
  });

  console.log(`再送の結果: ${body.outcome}（HTTP ${status}）`);
}

async function runStatus(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  console.log(`接続先: ${credentials.baseUrl}`);
  console.log(`ワークスペース: ${credentials.workspaceSlug}`);
  console.log(`端末: ${credentials.deviceId}`);
  console.log(`次の連番: ${credentials.nextSequence}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'enroll':
      return runEnroll();
    case 'punch':
      return runPunch();
    case 'replay':
      return runReplay();
    case 'status':
      return runStatus();
    default:
      throw new Error('enroll / punch / replay / status のいずれかを指定してください');
  }
}

main().catch((error: unknown) => {
  if (error instanceof AgentRequestError) {
    console.error(`サーバーが受け付けませんでした（HTTP ${error.status}）: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
