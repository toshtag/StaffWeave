/**
 * 打刻端末シミュレーター。
 *
 * 実機を用意せずに、端末の登録から署名イベントの送信までを試せるようにする。
 * OS 固有の実装は含まない。ここで確かめるのはサーバーとの取り決めだけ。
 *
 *   pnpm agent enroll --url https://staffweave.example --token-stdin
 *   pnpm agent punch --employee E001 --type clock_in
 *   pnpm agent replay        直前に送ったイベントをそのまま再送する
 *   pnpm agent status        保存されている資格情報を表示する
 *   pnpm agent card-register --token-file <path> [--reader | --card-stdin]
 *   pnpm agent card-punch --card-stdin
 *   pnpm agent station [--pcsc <モジュール>]     読み取りと送信を 1 つの常駐で行う
 *   pnpm agent session-observe --employee E001 --type sign_in [--at <ISO日時>]
 *   pnpm agent queue --employee E001 --type clock_in   送信待ちへ積むだけ
 *   pnpm agent serve                                   常駐して送信待ちを送り続ける
 *   pnpm agent diagnose                                設定と送信待ちの状態を出す
 *   pnpm agent --version                               配布物の版と元の commit を出す
 *
 * ループバック以外の接続先には https を指定する。
 * 端末登録トークン・署名付きの打刻・カード指紋を、暗号化なしで送らないため。
 *
 * 登録トークンとカード識別子は、標準入力・ファイル・端末からの非表示入力で渡す。
 * 引数（`--token` / `--card`）でも渡せるが、値がシェル履歴とプロセス一覧へ残る。将来やめる。
 *
 * カードの生の識別子は端末の中で指紋へ変換し、サーバーへは送らない。
 */
import { randomUUID } from 'node:crypto';
import { requireSecureBaseUrl } from '@staffweave/contracts';
import type { AttendanceEventType } from '@staffweave/domain';
import { isAttendanceEventType, isSessionObservationType } from '@staffweave/domain';
import { loadBuildInfo } from './build-info.js';
import { createPcscCardReader } from './card/pcsc.js';
import { BUNDLED_PCSC_MODULE, loadPcscTransport } from './card/pcsc-module.js';
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
import { requireSecret } from './secret-input.js';
import { createAgentLogger } from './service/redact.js';
import { runAgent, type SendOutcome } from './service/runner.js';
import { createSender } from './service/sender.js';
import { createFileSpool, type SpooledPunch } from './service/spool.js';
import { runCardStation } from './service/station.js';

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

/** 秘密値は引数を既定にしない。標準入力・ファイル・端末からの非表示入力で受け取る。 */
function secret(name: string, prompt: string): Promise<string> {
  return requireSecret({
    name,
    prompt,
    argv: process.argv,
    warn: (message) => console.error(message),
    interactive: process.stdin.isTTY === true,
  });
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
  const token = await secret('token', '登録トークン（入力は表示されません）: ');
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

/**
 * カードを登録する。
 *
 * `--reader` を付けると、読み取り装置へカードを置いて登録できる。付けなければ
 * 識別子を手で入れる。手入力しか無いと、登録の時だけカードの番号を人が読み取り、
 * 紙やメモへ書き写すことになる。写した番号は端末の外に残る。
 */
async function runCardRegister(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const token = await secret('token', '登録トークン（入力は表示されません）: ');

  let rawCardId: string;
  if (process.argv.includes('--reader')) {
    const transport = await loadPcscTransport(option('pcsc') ?? BUNDLED_PCSC_MODULE);
    const reader = createPcscCardReader(transport);
    console.log(`カードを置いてください: ${reader.name}`);
    rawCardId = await reader.read();
    await transport.close();
  } else {
    rawCardId = await secret('card', 'カード識別子（入力は表示されません）: ');
  }

  const credential = await registerCard(credentials, {
    registrationToken: token,
    cardFingerprint: cardFingerprint(requireCardKey(credentials), rawCardId),
  });

  console.log(`カードを登録しました: ${credential.id}`);
  console.log('生のカード識別子はサーバーへ送っていません。');
}

async function runCardPunch(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const rawCardId = await secret('card', 'カード識別子（入力は表示されません）: ');
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

/** 送信待ちの置き場。資格情報と同じところに置く。 */
function spoolPath(): string {
  return option('spool') ?? `${storePath()}.spool`;
}

/**
 * 送信待ちへ積むだけ。送信は serve が行う。
 *
 * 現場の端末では、打刻を受け取る側と送る側を分ける。
 * その場で送ろうとすると、回線が切れているあいだ利用者を待たせることになる。
 */
async function runQueue(): Promise<void> {
  const employeeNumber = requireOption('employee');
  const eventType = option('type') ?? 'clock_in';
  if (!isAttendanceEventType(eventType)) {
    throw new Error(`--type が不正です: ${eventType}`);
  }
  const now = new Date();
  await createFileSpool(spoolPath()).add({
    kind: 'employee',
    requestId: randomUUID(),
    sequence: await allocateSequence(),
    employeeNumber,
    eventType,
    occurredAt: option('at') ?? now.toISOString(),
    queuedAt: now.toISOString(),
  });
  console.log('送信待ちへ積みました。');
}

/**
 * 連番を 1 つ取り、次の値を先に保存する。
 *
 * 保存してから使うのは、途中で落ちたときに同じ連番を二度使わないため。
 * 連番が飛ぶのはサーバーが受け取るが、戻ると断られる。
 */
async function allocateSequence(): Promise<number> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const sequence = credentials.nextSequence;
  await saveCredentials(storePath(), { ...credentials, nextSequence: sequence + 1 });
  return sequence;
}

/** 送信待ちの 1 件を送る処理。従業員番号の打刻とカードの打刻の両方を通す。 */
function sender(): (punch: SpooledPunch) => Promise<SendOutcome> {
  return createSender({
    credentials: () => loadCredentials(storePath()),
    sendEvent,
    sendCardEvent,
    now: () => new Date(),
  });
}

/** 停止の合図で止まる常駐の足回り。待っている間に来た合図でも、次の周回まで待たせない。 */
function residency(logger: ReturnType<typeof createAgentLogger>): {
  running: () => boolean;
  sleep: (ms: number) => Promise<void>;
} {
  let running = true;
  let wake: (() => void) | null = null;
  const stop = (): void => {
    running = false;
    logger.info('agent.stopping');
    wake?.();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return {
    running: () => running,
    // 待ちは unref しない。unref すると、待っている間に他へ用が無いプロセスが終了し、
    // 常駐しているつもりの端末が最初の待ちで落ちる。
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, ms);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      }),
  };
}

/** 常駐して送信待ちを送り続ける。停止の合図を受けたら、今の 1 件を送り終えてから止まる。 */
async function runServe(): Promise<void> {
  const logger = createAgentLogger();
  const { running, sleep } = residency(logger);

  logger.info('agent.started', { store: storePath(), spool: spoolPath() });
  await runAgent({
    spool: createFileSpool(spoolPath()),
    logger,
    running,
    sleep,
    send: sender(),
  });
  logger.info('agent.stopped');
}

/**
 * 読み取りと送信を、1 つの常駐で行う。
 *
 * サービスとして登録するのはこれ 1 つ。読み取りと送信を別のプロセスに分けると、
 * 登録した側だけが動き、もう一方は誰も起動しない状態になる。
 *
 * `--pcsc` を省くと、配布物へ同梱している受け渡しを読む。装置の部品が端末に
 * 入っていなければ、その場で何をすればよいかを言って止まる。黙って読み取り
 * なしで立ち続けると、打刻できない端末が動いているように見える。
 */
async function runStation(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  const key = requireCardKey(credentials);
  const logger = createAgentLogger();
  const { running, sleep } = residency(logger);
  const spool = createFileSpool(spoolPath());

  const transport = await loadPcscTransport(option('pcsc') ?? BUNDLED_PCSC_MODULE);
  const reader = createPcscCardReader(transport, {
    log: (entry) => logger.info(`agent.${entry.event}`, entry.detail ?? {}),
  });

  logger.info('agent.started', { store: storePath(), spool: spoolPath(), reader: reader.name });

  // 読み取りと送信を並べて動かす。読み取りが待っている間も送信は進む。
  // 順番に動かすと、カードが置かれるまで送信待ちが出ていかない。
  await Promise.all([
    runCardStation({
      reader,
      spool,
      logger,
      fingerprint: (rawCardId) => cardFingerprint(key, rawCardId),
      allocateSequence,
      running,
      now: () => new Date(),
    }),
    runAgent({ spool, logger, running, sleep, send: sender() }),
  ]);

  await transport.close();
  logger.info('agent.stopped');
}

/** 設定と送信待ちの状態を出す。現場で「なぜ送れないのか」を切り分けるために使う。 */
async function runDiagnose(): Promise<void> {
  const build = await loadBuildInfo();
  console.log(`版: ${build.version}`);
  if (build.sourceSha !== '') console.log(`元の commit: ${build.sourceSha}`);

  const spool = createFileSpool(spoolPath());
  const pending = await spool.list();
  const unreadable = await spool.listUnreadable();

  let credentials: StoredCredentials | null = null;
  try {
    credentials = (await loadCredentials(storePath())) as StoredCredentials;
  } catch (error) {
    console.log(`資格情報を読めません: ${error instanceof Error ? error.message : error}`);
  }

  // 秘密鍵と指紋の鍵は出さない。診断のために保守の人が実行するため、画面にも残る。
  console.log(`接続先: ${credentials?.baseUrl ?? '（未登録）'}`);
  console.log(`端末: ${credentials?.deviceId ?? '（未登録）'}`);
  console.log(`次の連番: ${credentials?.nextSequence ?? '（未登録）'}`);
  console.log(`送信待ち: ${pending.length} 件`);
  // 種別ごとに分けて出す。カードの打刻だけが溜まっているなら、原因は装置ではなく
  // カードの登録の側にある。まとめて数えると、その切り分けができない。
  console.log(`  うちカード: ${pending.filter((punch) => punch.kind === 'card').length} 件`);
  console.log(`読めない送信待ち: ${unreadable.length} 件`);
  if (pending[0] !== undefined) {
    console.log(`いちばん古い送信待ち: ${pending[0].occurredAt}`);
  }

  // 装置は開けるかどうかだけを見る。開けたらすぐ閉じる。
  // 生の識別子・指紋・鍵は出さない。診断は保守の人が実行し、画面にも残る。
  const specifier = option('pcsc') ?? BUNDLED_PCSC_MODULE;
  try {
    const transport = await loadPcscTransport(specifier);
    console.log(`読み取り装置: ${transport.name}`);
    await transport.close();
  } catch (error) {
    console.log(`読み取り装置: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runStatus(): Promise<void> {
  const credentials = (await loadCredentials(storePath())) as StoredCredentials;
  console.log(`接続先: ${credentials.baseUrl}`);
  console.log(`ワークスペース: ${credentials.workspaceSlug}`);
  console.log(`端末: ${credentials.deviceId}`);
  console.log(`次の連番: ${credentials.nextSequence}`);
}

async function runVersion(): Promise<void> {
  const build = await loadBuildInfo();
  console.log(build.sourceSha === '' ? build.version : `${build.version} (${build.sourceSha})`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case '--version':
    case 'version':
      return runVersion();
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
    case 'queue':
      return runQueue();
    case 'serve':
      return runServe();
    case 'station':
      return runStation();
    case 'diagnose':
      return runDiagnose();
    default:
      throw new Error(
        'enroll / punch / replay / card-register / card-punch / session-observe / ' +
          'status / queue / serve / station / diagnose / --version のいずれかを指定してください',
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
