import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { JsonSchema } from './json-schema.js';

// 検証器は CommonJS 形式で配布されているため、名前付きエクスポートと default を明示的に取り出す。
const addFormats = addFormatsModule.default;

export interface ValidationProblem {
  /** 問題のあるプロパティ。要求全体に対する問題なら空文字。 */
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; problems: ValidationProblem[] };

const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false });
addFormats(ajv);

const compiled = new Map<JsonSchema, ValidateFunction>();

function compile(schema: JsonSchema): ValidateFunction {
  const existing = compiled.get(schema);
  if (existing) return existing;
  const validate = ajv.compile(schema);
  compiled.set(schema, validate);
  return validate;
}

/** Ajv の英語メッセージを、利用者へ出せる日本語へ置き換える。 */
function describe(error: ErrorObject): string {
  switch (error.keyword) {
    case 'required':
      return '必須の項目が入力されていません';
    case 'type':
      return `型が不正です（${String(error.params.type)} を指定してください）`;
    case 'enum':
      return '許可されていない値です';
    case 'minLength':
      return `文字数が足りません（${String(error.params.limit)} 文字以上）`;
    case 'maxLength':
      return `文字数が多すぎます（${String(error.params.limit)} 文字以下）`;
    case 'pattern':
      return '形式が不正です';
    case 'format':
      return `形式が不正です（${String(error.params.format)}）`;
    case 'additionalProperties':
      return `契約にない項目です: ${String(error.params.additionalProperty)}`;
    case 'oneOf':
      return '許可されているいずれの形式にも一致しません';
    default:
      return '値が不正です';
  }
}

function fieldOf(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const property = String(error.params.missingProperty);
    return error.instancePath === ''
      ? property
      : `${error.instancePath.slice(1).replaceAll('/', '.')}.${property}`;
  }
  return error.instancePath.slice(1).replaceAll('/', '.');
}

export function validate<T>(schema: JsonSchema, input: unknown): ValidationResult<T> {
  const validator = compile(schema);
  if (validator(input)) {
    return { valid: true, value: input as T };
  }
  const problems = (validator.errors ?? []).map((error) => ({
    field: fieldOf(error),
    message: describe(error),
  }));
  return { valid: false, problems };
}
