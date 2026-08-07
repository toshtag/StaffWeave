/**
 * 休暇の残数。
 *
 * 残数を 1 つの数として持たない。付与・取得・失効・取消の記録から組み立てる。
 *
 * 数として持つと、付与の取消や申請の差し戻しのたびに足し引きすることになり、
 * どこかで足し忘れれば残数だけが正しくない状態になる。しかも気付けない。
 * 台帳から組み立てれば、合わないときに「どの記録が原因か」を辿れる。
 *
 * 消化は古い付与から先に減らす。失効の近いものを残すと、使えたはずの分が消える。
 */

export type LeaveEntryType = 'grant' | 'consume' | 'expire' | 'adjust' | 'reverse';

export interface LeaveLedgerEntry {
  id: string;
  entryType: LeaveEntryType;
  /** 増える記録は正、減る記録は負。 */
  minutes: number;
  effectiveOn: string;
  /** 付与を使える最後の日。この日までは使える。失効しないなら null。 */
  expiresOn: string | null;
  /** 取消が打ち消す相手。 */
  reversesEntryId: string | null;
}

/** どの付与からも引けなかった減算。残数を負として見せるための置き場。 */
export const UNALLOCATED = 'unallocated';

export interface LeaveBalance {
  /** その時点で使える残数。 */
  availableMinutes: number;
  /** 付与のうち、まだ消化していない分の内訳。期限の近い順。 */
  remaining: { entryId: string; minutes: number; expiresOn: string | null }[];
  /** すでに失効した分。 */
  expiredMinutes: number;
}

/** 取消された記録の id。取消そのものも、打ち消された側も数えない。 */
function reversedIds(entries: readonly LeaveLedgerEntry[]): Set<string> {
  const reversed = new Set<string>();
  for (const entry of entries) {
    if (entry.entryType === 'reverse' && entry.reversesEntryId !== null) {
      reversed.add(entry.reversesEntryId);
      reversed.add(entry.id);
    }
  }
  return reversed;
}

/**
 * 指定した日の時点の残数を、台帳から組み立てる。
 *
 * @param asOf この日までに効いている記録だけを見る。未来の付与は数えない。
 */
export function buildLeaveBalance(
  entries: readonly LeaveLedgerEntry[],
  asOf: string,
): LeaveBalance {
  const reversed = reversedIds(entries);
  const effective = entries
    .filter((entry) => !reversed.has(entry.id))
    .filter((entry) => entry.effectiveOn <= asOf)
    .sort((left, right) =>
      left.effectiveOn === right.effectiveOn
        ? left.id.localeCompare(right.id)
        : left.effectiveOn.localeCompare(right.effectiveOn),
    );

  // 付与を、期限の近い順に並べた箱として持つ。
  // 期限が無いものは最後にする。期限のあるものから先に使わないと、使える分が失効する。
  const buckets: { entryId: string; minutes: number; expiresOn: string | null }[] = [];
  const put = (entryId: string, minutes: number, expiresOn: string | null): void => {
    buckets.push({ entryId, minutes, expiresOn });
    buckets.sort((left, right) => {
      if (left.expiresOn === right.expiresOn) return left.entryId.localeCompare(right.entryId);
      if (left.expiresOn === null) return 1;
      if (right.expiresOn === null) return -1;
      return left.expiresOn.localeCompare(right.expiresOn);
    });
  };

  let expiredMinutes = 0;

  /** その日にはもう使えなくなっている付与を、失効として残数から外す。 */
  const lapseBefore = (date: string): void => {
    for (const bucket of buckets) {
      if (bucket.expiresOn !== null && bucket.expiresOn < date && bucket.minutes > 0) {
        expiredMinutes += bucket.minutes;
        bucket.minutes = 0;
      }
    }
  };

  /**
   * 古い（期限の近い）箱から減らす。
   *
   * @param from どの箱から引いてよいか。省略すると、残っているどの箱からでも引く。
   */
  const take = (amount: number, from?: (expiresOn: string | null) => boolean): void => {
    let remaining = amount;
    for (const bucket of buckets) {
      if (remaining <= 0) break;
      if (bucket.minutes <= 0) continue;
      if (from !== undefined && !from(bucket.expiresOn)) continue;
      const taken = Math.min(bucket.minutes, remaining);
      bucket.minutes -= taken;
      remaining -= taken;
    }
    // 箱に収まらなかった分は、付与を伴わない減算として残数から引く。
    // 台帳は追記のみなので、ここで捨てず負の残数として見せる。
    if (remaining > 0) put(UNALLOCATED, -remaining, null);
  };

  for (const entry of effective) {
    switch (entry.entryType) {
      case 'grant':
        // 付与は、その日が来てから箱へ入れる。先に入れると、
        // それより前の取得が、まだ効いていない付与から引けてしまう。
        put(entry.id, entry.minutes, entry.expiresOn);
        break;
      case 'consume':
        // 取得の前に、その日までに期限の切れた付与を外す。
        // 外さずに引くと、もう使えない付与から引いたことになる。
        lapseBefore(entry.effectiveOn);
        take(-entry.minutes);
        break;
      case 'expire':
        // 失効を明示した記録は、期限の切れた付与からだけ引く。
        // 期限の来ていない付与から引くと、まだ使える分を失効させたことになる。
        take(-entry.minutes, (expiresOn) => expiresOn !== null && expiresOn < entry.effectiveOn);
        expiredMinutes += -entry.minutes;
        break;
      case 'adjust':
        if (entry.minutes > 0) {
          put(entry.id, entry.minutes, null);
        } else {
          lapseBefore(entry.effectiveOn);
          take(-entry.minutes);
        }
        break;
      case 'reverse':
        break;
    }
  }

  lapseBefore(asOf);

  const remaining = buckets.filter((bucket) => bucket.minutes !== 0);
  return {
    availableMinutes: remaining.reduce((sum, bucket) => sum + bucket.minutes, 0),
    remaining,
    expiredMinutes,
  };
}

export type LeaveConsumeProblem = 'insufficient' | 'not_a_multiple';

/**
 * その消化を受け付けてよいかを判断する。
 *
 * 残数が足りない消化は断る。負の残数を作れると、あとから帳尻を合わせる作業が要る。
 *
 * 判断は消化日の残数だけでは足りない。日付をさかのぼって消化を積むと、
 * その日には足りていても、あとの日の消化と合わせて足りなくなることがある。
 * 台帳へ積んだ形にしてから、その日以降のどの時点でも負にならないことを確かめる。
 *
 * 取得の単位は事業者が決める。単位が決まっていれば、その倍数だけを受け付ける。
 */
export function validateLeaveConsumption(input: {
  entries: readonly LeaveLedgerEntry[];
  minutes: number;
  effectiveOn: string;
  unitMinutes: number | null;
}): LeaveConsumeProblem[] {
  const problems: LeaveConsumeProblem[] = [];

  const proposed: LeaveLedgerEntry = {
    // 実際に積む前の判断なので、まだ識別子が無い。並びの末尾へ来る値を置く。
    id: PROPOSED,
    entryType: 'consume',
    minutes: -input.minutes,
    effectiveOn: input.effectiveOn,
    expiresOn: null,
    reversesEntryId: null,
  };
  const withProposed = [...input.entries, proposed];

  // 確かめる時点は、台帳に現れる日付だけでよい。
  // 残数が動くのは記録のある日だけで、その間では変わらない。
  const dates = new Set([input.effectiveOn, ...withProposed.map((entry) => entry.effectiveOn)]);
  const negative = [...dates]
    .filter((date) => date >= input.effectiveOn)
    .some((date) => buildLeaveBalance(withProposed, date).availableMinutes < 0);
  if (negative) problems.push('insufficient');

  if (input.unitMinutes !== null && input.minutes % input.unitMinutes !== 0) {
    problems.push('not_a_multiple');
  }
  return problems;
}

/** まだ積んでいない消化を表す識別子。並びの末尾へ来るよう、他より大きい値にする。 */
const PROPOSED = '~proposed';

export interface LeaveRegisterRow {
  /** 期首（`from` の前日時点）の残数。 */
  openingMinutes: number;
  /** 期間に効いた付与。 */
  grantedMinutes: number;
  /** 期間に消化した分（正の数で示す）。 */
  consumedMinutes: number;
  /** 期間に失効した分（正の数で示す）。 */
  expiredMinutes: number;
  /** 期間の手当て。増減の合計。 */
  adjustedMinutes: number;
  /** 期末（`to` 時点）の残数。 */
  closingMinutes: number;
}

/**
 * 休暇管理簿の 1 行。
 *
 * 台帳から組み立てる。合計を別に保存しない。
 * 保存すると、台帳と合計が食い違ったときにどちらが正しいのかを決められない。
 *
 * 失効は「期末の失効累計 − 期首の失効累計」で出す。台帳の `expire` の行だけを
 * 数えると、期限切れで自然に落ちた分（記録の無い失効）を数え落とす。
 */
export function summarizeLeaveRegister(
  entries: readonly LeaveLedgerEntry[],
  from: string,
  to: string,
): LeaveRegisterRow {
  const reversed = reversedIds(entries);
  const effective = entries
    .filter((entry) => !reversed.has(entry.id))
    .filter((entry) => entry.effectiveOn >= from && entry.effectiveOn <= to);

  const sumOf = (type: LeaveEntryType, sign: 1 | -1): number =>
    effective
      .filter((entry) => entry.entryType === type)
      .reduce((total, entry) => total + entry.minutes * sign, 0);

  // 期首は `from` の前日時点。`from` 当日の付与を期首へ入れると、
  // 「期首にあった分」と「期間に増えた分」が二重になる。
  const opening = buildLeaveBalance(entries, previousDay(from));
  const closing = buildLeaveBalance(entries, to);

  return {
    openingMinutes: opening.availableMinutes,
    grantedMinutes: sumOf('grant', 1),
    consumedMinutes: sumOf('consume', -1),
    expiredMinutes: closing.expiredMinutes - opening.expiredMinutes,
    adjustedMinutes: sumOf('adjust', 1),
    closingMinutes: closing.availableMinutes,
  };
}

/** 前日。台帳の日付は暦日なので、実行環境の時計に依らず UTC で数える。 */
function previousDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`日付として解釈できません: ${date}`);
  }
  const shifted = new Date(Date.UTC(year, month - 1, day - 1));
  return shifted.toISOString().slice(0, 10);
}
