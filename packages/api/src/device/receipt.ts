import { ApiError } from '../shared/errors.js';
import type { DeviceEventReceipt } from './repository.js';

/**
 * 受領記録に残した拒否理由を、そのまま同じ失敗へ戻す。
 *
 * 受理していれば `null` を返す。断った要求の再送を、そのときの状態から
 * 判定し直さないための入り口であり、打刻イベントも端末イベントもここを通す。
 */
export function rejectionOf(receipt: DeviceEventReceipt): ApiError | null {
  if (receipt.rejection === null) return null;
  return new ApiError(receipt.rejection.code, receipt.rejection.message);
}
