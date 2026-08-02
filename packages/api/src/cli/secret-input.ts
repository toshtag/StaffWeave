import { lstat, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

/**
 * CLI が秘密情報を受け取る入口。
 *
 * コマンドライン引数は、シェル履歴、プロセス一覧、ジョブ実行ログ、操作記録へ残る。
 * 同じホストの利用者から読めるうえ、後から消すのも難しい。
 * 秘密値は、標準入力・権限を制限したファイル・非表示の対話入力から受け取る。
 *
 * 読み取った値は返すだけで、表示もログ出力もしない。
 * 失敗の理由にも値を含めない。
 */

/** 所有者以外へ与えている権限があるか。 */
function isShared(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

/** 末尾の改行だけを落とす。パスワードに含まれうる空白は残す。 */
function trimNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}

export interface SecretOption {
  /** 引数の名前。`--<name>-file` と `--<name>-stdin` を組み立てる。 */
  name: string;
  /** 対話で尋ねるときの文言。 */
  prompt: string;
  argv: readonly string[];
  /** 引数で直接渡された場合の注意を書き出す先。 */
  warn: (message: string) => void;
}

function optionValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

/** 権限を確かめてからファイルの中身を読む。 */
export async function readSecretFile(path: string): Promise<string> {
  const stats = await lstat(path).catch(() => {
    throw new Error(`秘密情報のファイルを読めません: ${path}`);
  });
  if (stats.isSymbolicLink()) {
    throw new Error(`秘密情報のファイルがシンボリックリンクです: ${path}`);
  }
  if (!stats.isFile()) {
    throw new Error(`秘密情報のファイルが通常のファイルではありません: ${path}`);
  }
  if (isShared(stats.mode)) {
    throw new Error(
      `秘密情報のファイルを所有者以外が読めます。chmod 600 で直してください: ${path}`,
    );
  }
  return trimNewline(await readFile(path, 'utf8'));
}

/** 標準入力を最後まで読む。自動化からは、これを使って渡す。 */
export async function readSecretStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return trimNewline(Buffer.concat(chunks).toString('utf8'));
}

/**
 * 端末から非表示で受け取る。
 *
 * 入力中の文字を書き戻さないため、肩越しにも端末の記録にも残らない。
 */
export async function promptSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  const rl = createInterface({ input, output, terminal: true });
  // 入力中の文字は書き戻さない。行末の改行だけ通す。
  const muted = rl as unknown as { _writeToOutput?: (value: string) => void };
  muted._writeToOutput = (value: string) => {
    if (value.includes('\n')) output.write('\n');
  };

  try {
    output.write(prompt);
    return trimNewline(await new Promise<string>((resolve) => rl.question('', resolve)));
  } finally {
    rl.close();
  }
}

/**
 * 秘密値を受け取る。指定が無ければ `undefined` を返す。
 *
 * 引数で直接渡された場合も受け付けるが、注意を書き出す。
 * この受け取り方は将来やめる。
 */
export async function readSecret(option: SecretOption): Promise<string | undefined> {
  const { argv, name } = option;
  const file = optionValue(argv, `${name}-file`);
  const fromStdin = argv.includes(`--${name}-stdin`);
  const direct = optionValue(argv, name);

  const sources = [file !== undefined, fromStdin, direct !== undefined].filter(Boolean).length;
  if (sources > 1) {
    throw new Error(`--${name}、--${name}-file、--${name}-stdin は同時に指定できません`);
  }

  if (file !== undefined) return readSecretFile(file);
  if (fromStdin) return readSecretStdin(process.stdin);
  if (direct !== undefined) {
    option.warn(
      `--${name} で渡した値は、シェル履歴やプロセス一覧へ残ります。` +
        `--${name}-file または --${name}-stdin を使ってください。この受け取り方は将来やめます。`,
    );
    return direct;
  }
  // 端末があるときだけ尋ねる。自動化では標準入力かファイルで渡す。
  if (process.stdin.isTTY === true) return promptSecret(option.prompt);
  return undefined;
}
