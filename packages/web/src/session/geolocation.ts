import type { AttendanceLocationInput } from '@staffweave/contracts';

/**
 * 打刻した場所の取得。
 *
 * 取れなかったときは `null` を返す。例外にしない。
 * 位置情報を理由に打刻を失わせないためで、取れないことは断りの理由にならない。
 *
 * 待つ時間には上限を置く。測位が終わらないまま押しっぱなしにすると、
 * 端末の前の人は「打刻できていない」と判断してもう一度押す。
 */
export const LOCATION_TIMEOUT_MS = 8_000;

export interface GeolocationSource {
  getCurrentPosition(
    success: (position: GeolocationPosition) => void,
    failure: (error: GeolocationPositionError) => void,
    options?: PositionOptions,
  ): void;
}

export async function captureLocation(
  source: GeolocationSource | undefined = globalThis.navigator?.geolocation,
  timeoutMs: number = LOCATION_TIMEOUT_MS,
): Promise<AttendanceLocationInput | null> {
  if (source === undefined) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: AttendanceLocationInput | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    source.getCurrentPosition(
      (position) =>
        finish({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          // 精度は端末の申告どおりに整数へ丸める。粗い測位を正確な測位と混ぜない。
          accuracyMeters: Math.max(0, Math.round(position.coords.accuracy)),
        }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );

    // 端末が成否のどちらも返さないことがある。上限で切って打刻へ進む。
    setTimeout(() => finish(null), timeoutMs);
  });
}
