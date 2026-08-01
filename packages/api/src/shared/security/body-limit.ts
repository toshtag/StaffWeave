/**
 * 要求本文の大きさの上限。
 *
 * 本文の読み取りは認証や権限の検査より先に起きる経路がある。
 * 上限が無いと、未認証の相手が大きな本文を送るだけでメモリを消費させられる。
 *
 * 上限は経路の種類で分ける。打刻や認証のような小さな要求と、
 * CSV の取り込みのようにまとまった量を受け取る要求を同じ値にしない。
 */

import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { payloadTooLarge } from '../errors.js';

/**
 * ふつうの要求の本文の上限。
 *
 * 打刻や認証は数百バイトで足りる。ここを大きく取っているのは、
 * 端末がまとめて送る PC セッションの観測が、件数に応じて伸びるため。
 */
export const DEFAULT_REQUEST_BODY_MAX_BYTES = 256 * 1024;

/** まとまった量を受け取る経路の上限。従業員の CSV 取り込みだけが対象。 */
export const DEFAULT_BULK_REQUEST_BODY_MAX_BYTES = 8 * 1024 * 1024;

export interface RequestBodyLimitOptions {
  /** ふつうの要求の上限。 */
  defaultMaxBytes: number;
  /** まとまった量を受け取る経路の上限。 */
  bulkMaxBytes: number;
  /** まとまった量を受け取る経路。要求の経路と完全に一致するものだけを対象にする。 */
  bulkPaths: readonly string[];
}

export function createRequestBodyLimit(options: RequestBodyLimitOptions): MiddlewareHandler {
  // 断り方は 1 つにする。上限の値も、超えた本文の内容も応答へ出さない。
  const onError = (): Response => {
    throw payloadTooLarge();
  };

  const standard = bodyLimit({ maxSize: options.defaultMaxBytes, onError });
  const bulk = bodyLimit({ maxSize: options.bulkMaxBytes, onError });
  const bulkPaths = new Set(options.bulkPaths);

  return (c, next) => (bulkPaths.has(c.req.path) ? bulk(c, next) : standard(c, next));
}
