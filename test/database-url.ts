/**
 * 統合テストが使ってよいデータベースの接続文字列。
 *
 * 名前で誤りを止めるのはここだけにする。検査ごとに読み方を変えると、
 * 経路によって開発データを消せる状態が残る。
 *
 * このファイルはテストのフックを登録しない。準備（`integration-setup.ts`）へ
 * 置くと、接続文字列を読みたいだけの補助が、共通のフックまで引き込むことになる。
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL が設定されていません。docker compose up -d db を実行し、.env を設定してください。',
    );
  }
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(
      `TEST_DATABASE_URL は _test で終わるデータベースを指してください（誤って開発データを消さないため）: ${url}`,
    );
  }
  return url;
}

/**
 * そのワーカーだけが使うデータベースの接続文字列。
 *
 * 統合テストはファイルを並列に流す。同じデータベースを共有すると、
 * あるファイルのテストが消したデータを、別のファイルのテストが探すことになる。
 * ワーカーごとに名前を分け、消去の範囲をそのワーカーの中へ閉じる。
 *
 * 名前は `TEST_DATABASE_URL` から作る。上の検査を通った文字列だけを元にするため、
 * 開発用のデータベースを指すことはない。
 *
 * 番号は `VITEST_POOL_ID` を使う。ワーカーの枠に対応し、`maxWorkers` の数で頭打ちになる。
 * `VITEST_WORKER_ID` はファイルごとに増えるため、こちらを使うとファイルの数だけ
 * データベースを作ることになる。
 */
export function workerDatabaseUrl(): string {
  const base = requireTestDatabaseUrl();
  const pool = process.env.VITEST_POOL_ID;
  // 枠の番号が無い実行（vitest 以外から読む場合など）は、そのまま使う。
  if (!pool) return base;
  const url = new URL(base);
  url.pathname = `${url.pathname}_w${pool}`;
  return url.toString();
}

/** 同じサーバーの `postgres` データベースを指す接続文字列。作成と削除に使う。 */
export function adminDatabaseUrl(): string {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}
