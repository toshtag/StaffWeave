import { createHmac } from 'node:crypto';

/**
 * IC カードの指紋鍵を Workspace ごとに導出する。
 *
 * 端末へ渡すのはここで導出した鍵だけにする。共通の鍵をそのまま配ると、
 * ある Workspace で端末を登録できる者が、他の Workspace のカード指紋を
 * 計算して照合できてしまう。指紋は Workspace ごとに保存しているため、
 * 鍵も同じ単位で分ける。
 *
 * 導出の内容を変えると、既存のカード登録の指紋は一致しなくなる。
 * 共通の鍵を差し替えた場合も同じで、カードは登録し直しになる。
 */
export function deriveCardFingerprintKey(masterKey: string, workspaceId: string): string {
  return createHmac('sha256', masterKey)
    .update(`staffweave-card-fingerprint/1:${workspaceId}`, 'utf8')
    .digest('hex');
}
