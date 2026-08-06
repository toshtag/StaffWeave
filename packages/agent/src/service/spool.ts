import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 送れなかった打刻の置き場。
 *
 * 端末は現場に置かれ、回線が切れることも、電源が落ちることもある。
 * 送れなかった打刻をメモリだけに持つと、落ちた時点で消える。
 * 消えた打刻は誰にも見えないため、あとから足すこともできない。
 *
 * 1 件を 1 ファイルとして書く。1 つのファイルへ追記すると、
 * 書いている最中に落ちたときに、行の途中で切れたファイルが残る。
 * 別々のファイルなら、壊れた 1 件を切り離して残りを送れる。
 *
 * 書き込みは一時ファイルへ書いてから名前を変える。
 * 名前の変更は途中で終わらないため、読み手が半端な内容を拾わない。
 *
 * 順番は、ファイル名の先頭に置いた連番で決める。
 * 打刻は起きた順に送る。順番が入れ替わると、サーバー側の連番の検査に掛かる。
 */

export interface SpooledPunch {
  /** 冪等キー。再送しても同じ打刻として扱われる。 */
  requestId: string;
  employeeNumber: string;
  eventType: string;
  occurredAt: string;
  /** 端末が受け取った時刻。順番を決めるために持つ。 */
  queuedAt: string;
}

export interface Spool {
  /** 送信待ちへ積む。 */
  add(punch: SpooledPunch): Promise<void>;
  /** 送信待ちを古い順に返す。読めなかったものは含めない。 */
  list(): Promise<SpooledPunch[]>;
  /** 送れたものを外す。 */
  remove(requestId: string): Promise<void>;
  /** 読めなかったファイルの名前。人が中身を確かめるために残してある。 */
  listUnreadable(): Promise<string[]>;
}

const PENDING_SUFFIX = '.json';
/** 読めなかったファイルへ付ける印。次回から送信待ちとして拾わない。 */
const UNREADABLE_SUFFIX = '.unreadable';

/** 所有者だけが読み書きできる権限。打刻には従業員番号が入る。 */
const OWNER_ONLY = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

function isSpooledPunch(value: unknown): value is SpooledPunch {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === 'string' &&
    typeof record.employeeNumber === 'string' &&
    typeof record.eventType === 'string' &&
    typeof record.occurredAt === 'string' &&
    typeof record.queuedAt === 'string'
  );
}

/** 連番は桁を揃える。揃えないと、名前の並び順が数の順と食い違う。 */
function fileNameOf(sequence: number, requestId: string): string {
  return `${String(sequence).padStart(12, '0')}-${requestId}${PENDING_SUFFIX}`;
}

export function createFileSpool(directory: string): Spool {
  let ensured = false;

  const ensureDirectory = async (): Promise<void> => {
    if (ensured) return;
    await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    ensured = true;
  };

  const entriesOf = async (): Promise<string[]> => {
    await ensureDirectory();
    const names = await readdir(directory);
    return names.filter((name) => name.endsWith(PENDING_SUFFIX)).sort();
  };

  return {
    async add(punch) {
      await ensureDirectory();
      // 連番は、いま置かれているファイルの数ではなく最大値から決める。
      // 数で決めると、途中を消したときに同じ名前を二度使う。
      const existing = await entriesOf();
      const last = existing.at(-1)?.slice(0, 12) ?? '0';
      const name = fileNameOf(Number(last) + 1, punch.requestId);

      const temporary = join(directory, `.${name}.partial`);
      await writeFile(temporary, JSON.stringify(punch), { mode: OWNER_ONLY });
      // 名前の変更は途中で終わらない。読み手が半端な内容を拾わない。
      await rename(temporary, join(directory, name));
    },

    async list() {
      const punches: SpooledPunch[] = [];
      for (const name of await entriesOf()) {
        const path = join(directory, name);
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(path, 'utf8'));
        } catch {
          // 読めないものは印を付けて外す。捨てないのは、
          // 中身を人が確かめて手で入れ直せるようにするため。
          await rename(path, `${path}${UNREADABLE_SUFFIX}`);
          continue;
        }
        if (!isSpooledPunch(parsed)) {
          await rename(path, `${path}${UNREADABLE_SUFFIX}`);
          continue;
        }
        punches.push(parsed);
      }
      return punches;
    },

    async remove(requestId) {
      for (const name of await entriesOf()) {
        if (name.endsWith(`-${requestId}${PENDING_SUFFIX}`)) {
          await rm(join(directory, name), { force: true });
        }
      }
    },

    async listUnreadable() {
      await ensureDirectory();
      return (await readdir(directory)).filter((name) => name.endsWith(UNREADABLE_SUFFIX)).sort();
    },
  };
}
