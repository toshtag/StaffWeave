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
 * 番号は `VITEST_WORKER_ID` を使う。ワーカー 1 つに 1 つ割り当てられ、
 * 同時に生きているワーカーの間で重ならない。
 *
 * `VITEST_POOL_ID` は使わない。あちらは「枠」の番号で、前のプロセスが
 * 終わりきる前に次のプロセスへ渡される。実際に 1 つの枠を 2 つのプロセスが
 * 同時に使い、同じデータベースへ書き込んでいた。片方の消去がもう片方の
 * データを消し、`workspaces_slug_key` の重複と外部キー違反になっていた。
 *
 * 番号が無ければ、共有のデータベースへ落とさずに失敗させる。
 * 落とすと、全ワーカーが 1 つのデータベースを使う状態が黙って成立する。
 */
export function workerDatabaseUrl(): string {
  const base = requireTestDatabaseUrl();
  const worker = process.env.VITEST_WORKER_ID;
  if (!worker) {
    throw new Error(
      'VITEST_WORKER_ID がありません。ワーカーごとのデータベースを決められないため中止します。',
    );
  }
  const url = new URL(base);
  url.pathname = `${url.pathname}_w${worker}`;
  return url.toString();
}

/** 同じサーバーの `postgres` データベースを指す接続文字列。作成と削除に使う。 */
export function adminDatabaseUrl(): string {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}
