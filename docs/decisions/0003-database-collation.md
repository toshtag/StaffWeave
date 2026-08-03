# 0003 データベースの並びを libc から切り離し、基盤に Debian を使う

## 状態

確定（2026-08-03）

## 背景

`docker-compose.yml` は `postgres:18-alpine` を使い、データベースは
`en_US.utf8` を照合順序として名乗っていました。実際の並びを測ると、そうではありませんでした。

| 環境 | 宣言 | `'a','B','b','A','_a','ab'` の実際の並び |
| --- | --- | --- |
| `18-alpine`（musl） | `en_US.utf8` | `A B _a a ab b`（= C、バイト順） |
| `18-bookworm`（glibc） | `en_US.utf8` | `_a a A ab b B`（言語順） |

alpine の musl はロケールを実装していません。`en_US.utf8` を受け付けても無視し、
C と同じ並びで動きます。宣言と挙動が食い違ったまま動いている状態でした。

この食い違い自体は、いまの並び方が間違っているという話ではありません。
問題は、並びを OS の libc に委ねていることです。

- alpine と Debian を行き来すると、既定の並びが変わります。
- glibc は版によって照合順序が変わることがあります。OS を上げただけで並びが変わります。

並びが変われば、`text` の btree 索引は狂います。エラーにはならず、
`REINDEX` するまで検索結果が静かに欠けます。このスキーマには `text` / `varchar` を
含む索引が 27 個あり、うち 20 個が UNIQUE 制約です
（`organizations_workspace_code_key`、`users_workspace_email_key` など）。

利用者はまだいません。作り直しに費用がかからないのは、この時点だけです。

## 決定

### 並びは builtin プロバイダで決める

クラスタの初期化に次を渡します。値は `docker-compose.yml` と
`.github/workflows/ci.yml` の両方へ同じものを書きます。

```
--locale-provider=builtin --builtin-locale=C.UTF-8
--lc-collate=C --lc-ctype=C --encoding=UTF8
```

builtin は PostgreSQL 自身が持つプロバイダで、libc にも ICU にも依存しません。
OS を上げても、基盤イメージを変えても、並びは変わりません。

`--lc-collate=C --lc-ctype=C` も明示します。付けないと `pg_database.datcollate` に
`en_US.utf8` が残り、実際には使われていないのに使われているように読めます。
alpine で起きていたのと同じ、宣言と挙動の食い違いを作りません。

言語順が必要な問い合わせは、その場で明示します。

```sql
SELECT ... ORDER BY name COLLATE "ja-x-icu";
```

### 基盤は Debian（bookworm）にする

`postgres:18-bookworm` を使います。tag は major と基盤だけを書き、
patch は固定しません（`18.4-bookworm` にはしません）。patch を固定すると、
上流の修正が入るたびに手で上げることになり、上げ忘れがそのまま残ります。

builtin プロバイダを入れた時点で、既定の並びは基盤に依存しなくなります。
それでも Debian を選ぶ理由は次のとおりです。

- 明示する `COLLATE "ja-x-icu"` は ICU を使う。ICU と拡張は Debian のほうが揃う。
- 素の `postgres:18` タグは Debian であり、マネージド PostgreSQL も glibc。
  セルフホストの利用者が dump を持ち込む先と、開発環境の前提を揃えられる。
- 将来 libc の照合順序を既定にしたくなったとき、alpine では選択肢がない。
  いま閉じる必要のない扉を閉じない。

代償はイメージが 426 MB から 647 MB に増えることです。一度取得して
数か月動かすものであり、判断を変えるほどの差ではありません。

### 既存の並びは変えない

builtin の `C.UTF-8` は符号位置順で、alpine が実際に行っていた並びと同じです。
実測して一致を確認しました。

| | 並び |
| --- | --- |
| 変更前（alpine） | `A B _a a ab b z Ä あべ カワイ 伊藤 渡辺` |
| 変更後（Debian + builtin） | `A B _a a ab b z Ä あべ カワイ 伊藤 渡辺` |

`upper()` / `lower()` の結果も一致します（`äöü` ↔ `ÄÖÜ`、半角カナは変化なし）。
アプリケーションの問い合わせは変えていません。

## 影響

- 新しく作るクラスタは `datlocprovider = b`、`datlocale = C.UTF-8`、`datcollate = C` になります。
- 既定の並びは符号位置順です。日本語の読み順にはなりません。
  読み順が要る画面では、読み仮名の列を持つか、`COLLATE` を明示します。
  漢字は ICU でも読み順には並びません。読み仮名なしで並べられると期待しないでください。
- 基盤の OS を上げても、`REINDEX` は要りません。
- `pnpm check:policy` が、compose と CI の版・初期化の指定・データの置き場を検査します。
  外部の PostgreSQL の設定までは見られません。

## 見直す条件

次のどれかが起きた場合に、別の判断として扱います。

- 既定の並びを言語順にしたい要求が出たとき。
  そのときは既存の `text` 索引をすべて作り直す手順を先に用意します。
- builtin プロバイダの `C.UTF-8` が、必要な文字の扱いで足りないと分かったとき。
  PostgreSQL 18 には `PG_UNICODE_FAST` もあります。
- Debian の基盤が使えなくなったとき。
  その場合も builtin を維持すれば、並びは変わりません。

いずれの場合も、すでに実データを持つ導入先があるかどうかを先に確かめます。
あるなら、`REINDEX` を含む移行手順と後戻りの方法を決めてから行います。
