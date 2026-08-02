import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { requireSecureBaseUrl } from '@staffweave/contracts';
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
  /** IC カードの指紋を計算するための鍵。サーバーが設定していれば登録時に受け取る。 */
  cardFingerprintKey?: string;
}

export interface KeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/** 所有者だけが読み書きできる権限。 */
const OWNER_ONLY = 0o600;

/** 所有者以外に許してよいビット。1 つでも立っていれば危険とみなす。 */
const SHARED_BITS = 0o077;

/** 資格情報を置くディレクトリの権限。所有者だけが出入りできる。 */
const OWNER_ONLY_DIRECTORY = 0o700;

/** POSIX の権限が意味を持つ環境か。Windows では mode を安全性の根拠にしない。 */
const HAS_POSIX_MODE = process.platform !== 'win32';

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** 任意の署名対象文字列に署名する。 */
export function signMessage(privateKeyPem: string, message: string): string {
  return sign(null, Buffer.from(message, 'utf8'), privateKeyPem).toString('base64');
}

export function signPayload(privateKeyPem: string, payload: SignedEventPayload): string {
  return signMessage(privateKeyPem, canonicalPayload(payload));
}

/**
 * 資格情報として扱ってよいファイルかを確かめる。
 *
 * `readFile()` と `writeFile()` はシンボリックリンクの参照先を読み書きする。
 * 保存先へリンクを先置きされると、別のファイルへ秘密鍵を書かせたり、
 * 別のファイルを資格情報として読ませたりできる。
 * 参照をたどらない `lstat()` で、リンクと通常ファイル以外をここで断つ。
 *
 * 存在しない場合は `null` を返す。新規作成はこの後の書き込みで行う。
 */
async function requireRegularFile(path: string): Promise<{ mode: number } | null> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`資格情報の保存先がシンボリックリンクです: ${path}`);
  }
  if (!stats.isFile()) {
    throw new Error(`資格情報の保存先が通常のファイルではありません: ${path}`);
  }
  return { mode: stats.mode };
}

/**
 * 資格情報を置くディレクトリを確かめる。
 *
 * ファイルが `0600` でも、置き場を他の利用者が書けるなら意味がない。
 * ファイルを消して、自分の所有する `0600` の通常ファイルへ置き直せる。
 * 権限もリンクの検査も通るため、差し替えられたことに気付けない。
 * 置き直された内容には接続先も入るため、以後の打刻は別の宛先へ送られる。
 *
 * すでにあるディレクトリの権限は勝手に変えない。
 * 他の用途と共有しているかもしれない場所を、こちらの都合で狭めないため。
 * `create` を渡した場合だけ、無ければ所有者専用で作る。
 *
 * Windows では POSIX の権限が同じ意味を持たない。判定は行わず、
 * 保存先の選び方を文書で示すに留める。
 */
async function requireSafeDirectory(
  directory: string,
  options: { create?: boolean } = {},
): Promise<void> {
  if (options.create) {
    await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  }

  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(directory);
  } catch {
    throw new Error(`資格情報の保存先ディレクトリがありません: ${directory}`);
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`資格情報の保存先ディレクトリがシンボリックリンクです: ${directory}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`資格情報の保存先がディレクトリではありません: ${directory}`);
  }
  if (!HAS_POSIX_MODE) return;

  if ((stats.mode & SHARED_BITS) !== 0) {
    throw new Error(
      '資格情報の保存先ディレクトリを所有者以外が読み書きできます。' +
        `他の利用者に資格情報を置き換えられます。chmod 700 で直してください: ${directory}`,
    );
  }
  // 所有者が出入りできなければ、この後の読み書きは失敗する。理由を先に伝える。
  if ((stats.mode & 0o700) !== 0o700) {
    throw new Error(`資格情報の保存先ディレクトリを所有者が読み書きできません: ${directory}`);
  }
}

export async function loadCredentials(path: string): Promise<DeviceCredentials> {
  // 保存した後にディレクトリの権限が緩められている場合がある。読むたびに確かめる。
  await requireSafeDirectory(dirname(path));
  const existing = await requireRegularFile(path);
  if (existing === null) {
    throw new Error(`資格情報がありません: ${path}`);
  }
  // 他の利用者から読める状態で置かれていたら、その時点で秘密鍵は守れていない。
  // 黙って読み進めず、気付けるようにする。
  if ((existing.mode & SHARED_BITS) !== 0) {
    throw new Error(
      `資格情報を所有者以外が読める権限で保存しています。chmod 600 で直してください: ${path}`,
    );
  }

  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`資格情報を読み取れません: ${path}`);
  }

  const credentials = parsed as DeviceCredentials;
  // 保存した後に書き換えられている場合がある。読み込むたびに確かめ直す。
  return { ...credentials, baseUrl: requireSecureBaseUrl(credentials.baseUrl, '保存された接続先') };
}

export async function saveCredentials<T extends DeviceCredentials>(
  path: string,
  credentials: T,
): Promise<void> {
  await requireSafeDirectory(dirname(path), { create: true });
  await requireRegularFile(path);

  // 同じディレクトリの一時ファイルへ書いてから置き換える。
  // 保存先へ直接書くと、途中で止まったときに元の資格情報を失う。
  // 別のディレクトリへ書くと、装置をまたいで置き換えられない。
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}`);
  const handle = await open(temporary, 'wx', OWNER_ONLY);
  try {
    await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
    // 作成時の mode は umask で狭められるだけだが、既存ファイルを置き換える経路では
    // 元の権限を引き継がない。置き換える前に、この場で確定させる。
    await handle.chmod(OWNER_ONLY);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();

  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }

  // 置き換え先が既存ファイルだった場合も、権限は一時ファイルのものが残る。
  // 念のため確定させ、緩い権限のまま上書きした状態を残さない。
  await chmod(path, OWNER_ONLY);
}
