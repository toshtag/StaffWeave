/**
 * Webhook 送信先の URL に関する取り決め。
 *
 * 長さの上限は、API 契約と実際の検査の両方が同じ値を使う。
 * 二箇所へ数値を書くと、契約だけが厳しく実装は素通り、という状態を作れてしまう。
 */

/** `http://a.example` を下回る長さの文字列は URL として扱わない。 */
export const MINIMUM_WEBHOOK_URL_LENGTH = 8;

/**
 * 保存と送信で扱う URL の上限。
 * 正規化で percent encoding が増えるため、入力と正規化後の両方をこの値で見る。
 */
export const MAXIMUM_WEBHOOK_URL_LENGTH = 2048;
