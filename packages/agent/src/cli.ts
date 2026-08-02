/**
 * 打刻端末シミュレーター。
 *
 * 実機を用意せずに、端末の登録から署名イベントの送信までを試せるようにする。
 * OS 固有の実装は含まない。ここで確かめるのはサーバーとの取り決めだけ。
 *
 *   pnpm agent enroll --url http://127.0.0.1:8787 --token <登録トークン>
 *
 * ループバック以外の接続先には https を指定する。
 * 端末登録トークン・署名付きの打刻・カード指紋を、暗号化なしで送らないため。
 *   pnpm agent punch --employee E001 --type clock_in
 *   pnpm agent replay        直前に送ったイベントをそのまま再送する
 *   pnpm agent status        保存されている資格情報を表示する
 *   pnpm agent card-register --token <登録トークン> --card <カード識別子>
 *   pnpm agent card-punch --card <カード識別子>
 *   pnpm agent session-observe --employee E001 --type sign_in [--at <ISO日時>]
 *
 * カードの生の識別子は端末の中で指紋へ変換し、サーバーへは送らない。
 */
import { randomUUID } from 'node:crypto';
import { requireSecureBaseUrl } from '@staffweave/contracts';
import type { AttendanceEventType } from '@staffweave/domain';
import { isAttendanceEventType, isSessionObservationType } from '@staffweave/domain';
import { cardFingerprint } from './card/reader.js';
import {
  AgentRequestError,
  enroll,
  registerCard,
  sendCardEvent,
  sendEvent,
  sendSessionObservations,
} from './client.js';
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
  // 登録トークンと公開鍵を送る前に確かめる。送ってからでは遅い。
  const baseUrl = requireSecureBaseUrl(requireOption('url'));
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
    ...(result.cardFingerprintKey === undefined
      ? {}
      : { cardFingerprintKey: result.cardFingerprintKey }),
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

function requireCardKey(credentials: StoredCredentials): string {
  if (credentials.cardFingerprintKey === undefined) {
    throw new Error(
      'サーバーでカードの指紋鍵が設定されていません。CARD_FINGERPRINT_KEY を設定して登録し直してください。',
    );
  }
  return credentials.cardFingerprintKey;
}

async function runCardRegister(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const token = requireOption('token');
  // 実機の読み取り装置の代わりに、指定された識別子を読み取ったものとして扱う。
  const rawCardId = requireOption('card');

  const credential = await registerCard(credentials, {
    registrationToken: token,
    cardFingerprint: cardFingerprint(requireCardKey(credentials), rawCardId),
  });

  console.log(`カードを登録しました: ${credential.id}`);
  console.log('生のカード識別子はサーバーへ送っていません。');
}

async function runCardPunch(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const rawCardId = requireOption('card');
  const eventType = option('type');
  if (eventType !== undefined && !isAttendanceEventType(eventType)) {
    throw new Error(`--type が不正です: ${eventType}`);
  }

  const now = new Date();
  const { status, body } = await sendCardEvent(credentials, {
    sequence: credentials.nextSequence,
    requestId: randomUUID(),
    cardFingerprint: cardFingerprint(requireCardKey(credentials), rawCardId),
    ...(eventType === undefined ? {} : { eventType }),
    occurredAt: option('at') ?? now.toISOString(),
    deviceTime: now.toISOString(),
  });

  await saveCredentials(storePath(), {
    ...credentials,
    nextSequence: credentials.nextSequence + 1,
  });

  console.log(`${status === 201 ? '受理' : '再送として受理'}: ${body.employeeDisplayName}`);
  console.log(`記録した打刻: ${body.eventType}（${body.businessDate}）`);
}

async function runSessionObserve(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const employeeNumber = requireOption('employee');
  const observationType = option('type') ?? 'sign_in';
  if (!isSessionObservationType(observationType)) {
    throw new Error(`--type が不正です: ${observationType}`);
  }

  const now = new Date();
  const { status, body } = await sendSessionObservations(credentials, {
    sequence: credentials.nextSequence,
    requestId: randomUUID(),
    workstationName: option('workstation') ?? 'simulated-workstation',
    observations: [
      { employeeNumber, observationType, occurredAt: option('at') ?? now.toISOString() },
    ],
  });

  await saveCredentials(storePath(), {
    ...credentials,
    nextSequence: credentials.nextSequence + 1,
  });

  console.log(
    `${status === 201 ? '受理' : '再送として受理'}: 記録 ${body.accepted} 件 / 対象外 ${body.skipped} 件`,
  );
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
    case 'card-register':
      return runCardRegister();
    case 'card-punch':
      return runCardPunch();
    case 'session-observe':
      return runSessionObserve();
    case 'status':
      return runStatus();
    default:
      throw new Error(
        'enroll / punch / replay / card-register / card-punch / session-observe / status のいずれかを指定してください',
      );
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
