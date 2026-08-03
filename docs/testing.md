# 検証

`pnpm verify` は CI が実行する検証と同じ内容です。
手元で通れば CI でも通る状態にするため、片方だけに項目を足しません。
CI 側の一覧は [development-policy.md](development-policy.md) の「自動検証」にあります。

```sh
pnpm verify            # 下の 7 つをこの順で実行する（DB 必要）
pnpm lint              # 書式と静的検査
pnpm typecheck         # 型検査
pnpm test              # 単体 + 統合（DB 必要）
pnpm test:e2e          # ブラウザによる E2E（DB 必要）
pnpm db:verify         # マイグレーションの適用漏れと内容の変更を検査
pnpm check:policy      # リポジトリの決めごと（名称・秘密情報・ライセンス・認可契約・マイグレーション・依存方向）を検査
pnpm check:audit       # 依存の既知脆弱性（moderate 以上があれば失敗）

pnpm test:unit         # 単体テストのみ（DB 不要）
pnpm test:integration  # 統合テストのみ（DB 必要）

pnpm sbom:generate     # 配布物の構成一覧を書き出す（Docker 必要）
pnpm sbom:verify       # 書き出した構成一覧を検証する（Docker 必要）
```

コンテナのビルドだけは CI で行います（`docker build -f docker/api.Dockerfile`）。

## SBOM

SBOM は `pnpm verify` に含めていません。通常の開発で Docker と外部の道具を
必須にすると、オフラインで検証できなくなるためです。専用の CI ジョブで実行します。
対象と読み方は [security/sbom.md](security/sbom.md) を参照してください。

## 依存の脆弱性

`pnpm check:audit` はレジストリへ問い合わせるため、ネットワークが要ります。
すぐに直せない勧告は `scripts/audit-exceptions.txt` へ、勧告 ID・期限・理由を書いて見送れます。
期限を過ぎた見送りは、勧告が残っているかどうかに関わらず失敗します。

## テスト用のデータベース

統合テストは `TEST_DATABASE_URL` のデータベースを使い、実行のたびにデータを消去します。
開発用データベースを誤って指さないよう、名前が `_test` で終わることを実行時に検査します。

E2E はさらに別の `staffweave_e2e` を使い、専用のポート（API 8788 / Web 5174）でサーバーを起動します。
初回は `pnpm exec playwright install chromium` でブラウザを取得してください。
