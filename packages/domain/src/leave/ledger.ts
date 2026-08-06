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
  /** 付与の失効日。失効しないなら null。 */
  expiresOn: string | null;
  /** 取消が打ち消す相手。 */
  reversesEntryId: string | null;
}

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
  const buckets = effective
    .filter((entry) => entry.entryType === 'grant')
    .map((entry) => ({ entryId: entry.id, minutes: entry.minutes, expiresOn: entry.expiresOn }))
    .sort((left, right) => {
      if (left.expiresOn === right.expiresOn) return left.entryId.localeCompare(right.entryId);
      if (left.expiresOn === null) return 1;
      if (right.expiresOn === null) return -1;
      return left.expiresOn.localeCompare(right.expiresOn);
    });

  let expiredMinutes = 0;

  /** 古い（期限の近い）箱から減らす。 */
  const take = (amount: number): void => {
    let remaining = amount;
    for (const bucket of buckets) {
      if (remaining <= 0) break;
      const taken = Math.min(bucket.minutes, remaining);
      bucket.minutes -= taken;
      remaining -= taken;
    }
    // 箱に収まらなかった分は、付与を伴わない減算として残数から引く。
    // 台帳は追記のみなので、ここで捨てず負の残数として見せる。
    if (remaining > 0) buckets.push({ entryId: 'unallocated', minutes: -remaining, expiresOn: null });
  };

  for (const entry of effective) {
    switch (entry.entryType) {
      case 'grant':
        break;
      case 'consume':
        take(-entry.minutes);
        break;
      case 'expire':
        expiredMinutes += -entry.minutes;
        take(-entry.minutes);
        break;
      case 'adjust':
        if (entry.minutes > 0) {
          buckets.push({ entryId: entry.id, minutes: entry.minutes, expiresOn: null });
        } else {
          take(-entry.minutes);
        }
        break;
      case 'reverse':
        break;
    }
  }

  // その日を過ぎた付与は、失効として残数から外す。
  for (const bucket of buckets) {
    if (bucket.expiresOn !== null && bucket.expiresOn < asOf && bucket.minutes > 0) {
      expiredMinutes += bucket.minutes;
      bucket.minutes = 0;
    }
  }

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
 * 取得の単位は事業者が決める。単位が決まっていれば、その倍数だけを受け付ける。
 */
export function validateLeaveConsumption(input: {
  balance: LeaveBalance;
  minutes: number;
  unitMinutes: number | null;
}): LeaveConsumeProblem[] {
  const problems: LeaveConsumeProblem[] = [];
  if (input.minutes > input.balance.availableMinutes) problems.push('insufficient');
  if (input.unitMinutes !== null && input.minutes % input.unitMinutes !== 0) {
    problems.push('not_a_multiple');
  }
  return problems;
}
