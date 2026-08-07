/**
 * 検査の当日を、ワークスペースの時間帯で求める。
 *
 * `new Date().toISOString()` は UTC の日付を返します。ワークスペースは
 * Asia/Tokyo なので、UTC で 15 時を過ぎると 1 日ずれます。ずれている間は、
 * 打刻した日と検査が探す日が食い違い、検査だけが落ちます。
 *
 * 実際に、CI が UTC の 15 時台に回ったときに 3 本が落ちました。
 * 時刻に依らず同じ結果になるよう、業務日は時間帯から求めます。
 */

/** 検査に使うワークスペースの時間帯。`prepare-database.ts` の設定と合わせる。 */
export const E2E_TIME_ZONE = 'Asia/Tokyo';

/** その時間帯での今日（YYYY-MM-DD）。 */
export function businessToday(timeZone: string = E2E_TIME_ZONE): string {
  // `en-CA` は YYYY-MM-DD で返す。並べ替えのために自分で組み直さない。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** その時間帯での今月の 1 日。締めや月次の対象月として使う。 */
export function businessPeriod(timeZone: string = E2E_TIME_ZONE): string {
  return `${businessToday(timeZone).slice(0, 7)}-01`;
}

/** その時間帯での、n 日前。 */
export function businessDaysAgo(days: number, timeZone: string = E2E_TIME_ZONE): string {
  const today = new Date(`${businessToday(timeZone)}T00:00:00.000Z`);
  today.setUTCDate(today.getUTCDate() - days);
  return today.toISOString().slice(0, 10);
}
