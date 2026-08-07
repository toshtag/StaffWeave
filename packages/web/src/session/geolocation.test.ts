/**
 * 打刻した場所の取得。
 *
 * 取れなくても打刻は残す。位置情報を理由に打刻を失わせない。
 */
import { describe, expect, it } from 'vitest';
import { captureLocation } from './geolocation.ts';

function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return { coords: { latitude, longitude, accuracy } } as GeolocationPosition;
}

describe('位置情報の取得', () => {
  it('取れた位置を、精度つきで返す', async () => {
    const captured = await captureLocation({
      getCurrentPosition: (success) => success(position(35.681236, 139.767125, 12.4)),
    });

    expect(captured).toEqual({
      latitude: 35.681236,
      longitude: 139.767125,
      accuracyMeters: 12,
    });
  });

  it('断られたときは null を返し、例外にしない', async () => {
    const captured = await captureLocation({
      getCurrentPosition: (_success, failure) => failure({} as GeolocationPositionError),
    });

    expect(captured).toBeNull();
  });

  it('端末が応えないときは、上限で切って null を返す', async () => {
    const captured = await captureLocation({ getCurrentPosition: () => {} }, 1);

    expect(captured).toBeNull();
  });

  it('位置情報を扱えない端末では null を返す', async () => {
    expect(await captureLocation(undefined)).toBeNull();
  });
});
