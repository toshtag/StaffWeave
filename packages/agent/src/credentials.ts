import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { SignedEventPayload } from '@staffweave/domain';
import { canonicalPayload } from '@staffweave/domain';

/**
 * 端末の資格情報。
 *
 * 秘密鍵は端末の中だけに置き、サーバーへは公開鍵しか渡さない。
 * 保存先のファイルは秘密情報として扱い、リポジトリへ入れない。
 */
export interface DeviceCredentials {
  baseUrl: string;
  deviceId: string;
  workspaceSlug: string;
  privateKeyPem: string;
  publicKeyPem: string;
  /** 次に送る連番。送信のたびに 1 ずつ増やす。 */
  nextSequence: number;
}

export interface KeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function signPayload(privateKeyPem: string, payload: SignedEventPayload): string {
  return sign(null, Buffer.from(canonicalPayload(payload), 'utf8'), privateKeyPem).toString(
    'base64',
  );
}

export async function loadCredentials(path: string): Promise<DeviceCredentials> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`資格情報を読み取れません: ${path}`);
  }
  return parsed as DeviceCredentials;
}

export async function saveCredentials<T extends DeviceCredentials>(
  path: string,
  credentials: T,
): Promise<void> {
  // 所有者だけが読める権限で保存する。
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
