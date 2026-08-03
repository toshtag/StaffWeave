# HTTP 応答と要求の防御

応答ヘッダー、送信元（`Origin`）の検査、要求本文の上限をまとめます。
ログインとセッションの扱いは [authentication.md](authentication.md) にあります。

## 応答のヘッダー

API と画面のどちらの応答にも、次のヘッダーを製品の側で付けます。逆プロキシ側の設定は要りません。

| ヘッダー | 値 |
| --- | --- |
| `Content-Security-Policy` | 自分自身からの取得だけを許し、埋め込みを拒む |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` / `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control`（`/api` の応答） | `no-store` |
| `Strict-Transport-Security` | `NODE_ENV=production` のときだけ送る |

逆プロキシで同じヘッダーを付ける場合は、値を二重に送らないようにしてください。
`Strict-Transport-Security` は HTTPS で終端している構成でだけ送ります。
HTTP で動かす構成へ送ると、その後 HTTPS へ移すまで画面を開けなくなります。

画面へ外部の資材（CDN のフォント、外部の画像、別ホストの API）を足す場合は、
`packages/api/src/shared/security/headers.ts` の取得先を広げる必要があります。

## 送信元の検査

セッションは Cookie で運ぶため、ブラウザは別の頁からの要求にも自動で付けます。
`SameSite=Lax` は別サイトからの送信を止めますが、同じ登録ドメインの別サブドメイン
（`wiki.example.com` と `staffweave.example.com` など）は「同一サイト」として扱われ、止まりません。

そこで、Cookie を送っている状態変更（`GET` / `HEAD` / `OPTIONS` 以外）では `Origin` を検査します。

- 既定では、要求が届いた宛先（`Host`）と同じホストだけを許します
- 逆プロキシが `Host` を書き換える構成では、`ALLOWED_ORIGINS` へ実際のオリジンを並べます
- 端末の署名や API キーで来る要求は対象外です（ブラウザの資格情報を使わないため）
- `Origin` を持たない要求は通します。ブラウザは状態を変える要求へ必ず付けるため、
  この検査はブラウザ経由の攻撃に対して効きます。値を偽れる相手（ブラウザ以外）には効きません

## 要求本文の上限

本文の大きさには上限があります。超えた要求は、本文を読み切らずに 413 で断ります。

| 設定 | 既定 | 対象 |
| --- | --- | --- |
| `MAX_REQUEST_BODY_BYTES` | 256 KiB | 打刻・認証・端末からの送信など、ふつうの要求 |
| `MAX_BULK_REQUEST_BODY_BYTES` | 8 MiB | 従業員の CSV 取り込み（`POST /api/imports/employees`） |

逆プロキシ側にも上限がある場合は、小さいほうが先に効きます。
大きな CSV を取り込む場合は、両方の値を確認してください。
