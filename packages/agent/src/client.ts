import type {
  CardCredentialRecord,
  CardEventRequest,
  CardEventResponse,
  DeviceEventRequest,
  DeviceEventResponse,
  EnrollDeviceResponse,
  ErrorResponse,
  RecordSessionObservationsRequest,
  RecordSessionObservationsResponse,
  RegisterCardRequest,
} from '@staffweave/contracts';
import {
  canonicalCardEvent,
  canonicalCardRegistration,
  canonicalSessionObservations,
} from '@staffweave/domain';
import type { DeviceCredentials } from './credentials.js';
import { signMessage, signPayload } from './credentials.js';

/**
 * Agent からサーバーへの送信。
 * 送信待ちの再送は呼び出し側が行う。ここでは 1 回の送信だけを担う。
 *
 * 接続先の検査は、設定した URL に対してだけ行える。
 * リダイレクトへ追従すると、検査していない宛先へ登録トークンや打刻が出る。
 * 307 と 308 は手法と本文を保つため、そのまま再送される。
 * そこで追従はせず、3xx はその場で失敗として扱う。
 */

export class AgentRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AgentRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * リダイレクトを受け取ったときの失敗。
 *
 * 転送先（`Location`）も、送った本文も、資格情報も理由に含めない。
 * 利用者が直すのに要るのは「追従しない」という事実と応答コードだけ。
 */
function rejectRedirect(response: Response): never {
  throw new AgentRequestError(
    response.status,
    'redirect_not_followed',
    'サーバーがリダイレクトを返しました。Agent は追従しません。最終的に応答する URL を指定してください。',
  );
}

async function readError(response: Response): Promise<never> {
  if (response.status >= 300 && response.status < 400) rejectRedirect(response);

  const body: unknown = await response.json().catch(() => null);
  const error = (body as ErrorResponse | null)?.error;
  throw new AgentRequestError(
    response.status,
    error?.code ?? 'unknown',
    error?.message ?? 'エラーが発生しました',
  );
}

export async function enroll(
  baseUrl: string,
  input: { enrollmentToken: string; publicKey: string },
): Promise<EnrollDeviceResponse> {
  const response = await fetch(`${baseUrl}/api/device-agent/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    redirect: 'manual',
  });
  if (!response.ok) await readError(response);
  return (await response.json()) as EnrollDeviceResponse;
}

export async function sendEvent(
  credentials: DeviceCredentials,
  input: DeviceEventRequest,
): Promise<{ status: number; body: DeviceEventResponse }> {
  const signature = signPayload(credentials.privateKeyPem, {
    deviceId: credentials.deviceId,
    sequence: input.sequence,
    requestId: input.requestId,
    employeeNumber: input.employeeNumber,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    deviceTime: input.deviceTime,
  });

  const response = await fetch(`${credentials.baseUrl}/api/device-agent/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': credentials.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(input),
    redirect: 'manual',
  });

  if (!response.ok) await readError(response);
  return { status: response.status, body: (await response.json()) as DeviceEventResponse };
}

export async function registerCard(
  credentials: DeviceCredentials,
  input: RegisterCardRequest,
): Promise<CardCredentialRecord> {
  const signature = signMessage(
    credentials.privateKeyPem,
    canonicalCardRegistration({ deviceId: credentials.deviceId, ...input }),
  );

  const response = await fetch(`${credentials.baseUrl}/api/device-agent/card-credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': credentials.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(input),
    redirect: 'manual',
  });

  if (!response.ok) await readError(response);
  return (await response.json()) as CardCredentialRecord;
}

export async function sendCardEvent(
  credentials: DeviceCredentials,
  input: CardEventRequest,
): Promise<{ status: number; body: CardEventResponse }> {
  const signature = signMessage(
    credentials.privateKeyPem,
    canonicalCardEvent({
      deviceId: credentials.deviceId,
      sequence: input.sequence,
      requestId: input.requestId,
      cardFingerprint: input.cardFingerprint,
      eventType: input.eventType ?? '',
      occurredAt: input.occurredAt,
      deviceTime: input.deviceTime,
    }),
  );

  const response = await fetch(`${credentials.baseUrl}/api/device-agent/card-events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': credentials.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(input),
    redirect: 'manual',
  });

  if (!response.ok) await readError(response);
  return { status: response.status, body: (await response.json()) as CardEventResponse };
}

export async function sendSessionObservations(
  credentials: DeviceCredentials,
  input: RecordSessionObservationsRequest,
): Promise<{ status: number; body: RecordSessionObservationsResponse }> {
  const signature = signMessage(
    credentials.privateKeyPem,
    canonicalSessionObservations({ deviceId: credentials.deviceId, ...input }),
  );

  const response = await fetch(`${credentials.baseUrl}/api/device-agent/session-observations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': credentials.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(input),
    redirect: 'manual',
  });

  if (!response.ok) await readError(response);
  return {
    status: response.status,
    body: (await response.json()) as RecordSessionObservationsResponse,
  };
}
