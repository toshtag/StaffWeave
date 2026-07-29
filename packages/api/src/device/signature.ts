import { createPublicKey, randomBytes, verify } from 'node:crypto';
import type { SignedEventPayload } from '@staffweave/domain';
import { canonicalPayload } from '@staffweave/domain';

/**
 * 端末の署名検証。
 *
 * 端末は Ed25519 の鍵を自分で作り、公開鍵だけをサーバーへ預ける。
 * 秘密鍵はサーバーへ渡らないため、サーバー側の情報だけでは端末になりすませない。
 */

export function generateEnrollmentToken(): string {
  return randomBytes(24).toString('base64url');
}

/** 任意の署名対象文字列に対する検証。 */
export function verifySignature(
  publicKeyPem: string,
  message: string,
  signatureBase64: string,
): boolean {
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch {
    return false;
  }
  if (signature.length === 0) return false;

  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}

export function verifySignedEvent(
  publicKeyPem: string,
  payload: SignedEventPayload,
  signatureBase64: string,
): boolean {
  return verifySignature(publicKeyPem, canonicalPayload(payload), signatureBase64);
}

/** 受け取った公開鍵が Ed25519 の SPKI として読めるか。 */
export function isSupportedDeviceKey(publicKeyPem: string): boolean {
  try {
    return createPublicKey(publicKeyPem).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}
