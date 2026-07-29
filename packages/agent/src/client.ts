import type {
  DeviceEventRequest,
  DeviceEventResponse,
  EnrollDeviceResponse,
  ErrorResponse,
} from '@staffweave/contracts';
import type { DeviceCredentials } from './credentials.js';
import { signPayload } from './credentials.js';

/**
 * Agent からサーバーへの送信。
 * 送信待ちの再送は呼び出し側が行う。ここでは 1 回の送信だけを担う。
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

async function readError(response: Response): Promise<never> {
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
  });

  if (!response.ok) await readError(response);
  return { status: response.status, body: (await response.json()) as DeviceEventResponse };
}
