import { BUSINESS_DATE_PATTERN, ROLES, SUPPORTED_LOCALES } from '@staffweave/domain';
import { type JsonSchema, objectSchema } from '../json-schema.js';

export const uuidSchema: JsonSchema = { type: 'string', format: 'uuid' };

export const businessDateSchema: JsonSchema = {
  type: 'string',
  pattern: BUSINESS_DATE_PATTERN.source,
  description: '業務日（YYYY-MM-DD）。暦日ではなく、勤務が属する日',
};

export const localeSchema: JsonSchema = {
  type: 'string',
  enum: [...SUPPORTED_LOCALES],
  description: 'UI の表示言語',
};

export const roleSchema: JsonSchema = {
  type: 'string',
  enum: [...ROLES],
  description: '利用者のロール',
};

export const codeSchema: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 32,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$',
  description: '人が読み書きする短縮コード',
};

export const nameSchema: JsonSchema = { type: 'string', minLength: 1, maxLength: 200 };

/**
 * 閲覧範囲の説明の正本。
 *
 * 閲覧範囲は勤怠だけでなく、従業員一覧・勤務予定・配属・IC カードの資格情報・
 * CSV 出力といった従業員データ全般へ適用される。
 * 同じ意味を複数の場所で言い直すと、片方だけが古くなる。契約に現れる説明は
 * すべてこの定数を使う。
 */
export const ORGANIZATION_SCOPE_DESCRIPTION =
  '利用者へ明示的に付与された、従業員データの閲覧対象組織。' +
  '登録がない場合は管理対象の組織がないことを表す。' +
  'ワークスペース全体を閲覧できるかどうかは、この値ではなく workspace_admin ロールが決める。';

export const timestampSchema: JsonSchema = {
  type: 'string',
  description: 'ISO 8601 形式の日時（UTC）',
};

export const errorResponseSchema = objectSchema({
  description: 'エラー応答の共通形式',
  properties: {
    error: objectSchema({
      properties: {
        code: { type: 'string', description: '機械可読なエラー種別' },
        message: { type: 'string', description: '利用者向けの説明' },
        details: {
          type: 'array',
          items: objectSchema({
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['message'],
          }),
        },
      },
      required: ['code', 'message'],
    }),
  },
  required: ['error'],
});
