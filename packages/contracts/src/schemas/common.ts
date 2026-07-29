import { ROLES, SUPPORTED_LOCALES } from '@staffweave/domain';
import { type JsonSchema, objectSchema } from '../json-schema.js';

export const uuidSchema: JsonSchema = { type: 'string', format: 'uuid' };

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
