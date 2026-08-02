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
