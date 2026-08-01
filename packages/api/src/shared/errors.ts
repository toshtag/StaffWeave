import type { ErrorResponse, ValidationProblem } from '@staffweave/contracts';

export type ApiErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal_error: 500,
};

/** 保存した応答コードなど、外から来た文字列を失敗の種類として扱えるかを判定する。 */
export function isApiErrorCode(value: string): value is ApiErrorCode {
  return Object.hasOwn(STATUS_BY_CODE, value);
}

/**
 * API が利用者へ返す失敗。
 * 予期しない例外と区別し、内部情報を漏らさない形で応答へ変換する。
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly problems: ValidationProblem[];

  constructor(code: ApiErrorCode, message: string, problems: ValidationProblem[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.problems = problems;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  toResponseBody(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.problems.length === 0 ? {} : { details: this.problems }),
      },
    };
  }
}

export function invalidRequest(problems: ValidationProblem[]): ApiError {
  return new ApiError('invalid_request', '要求の内容が正しくありません', problems);
}

export function unauthenticated(): ApiError {
  return new ApiError('unauthenticated', 'ログインが必要です');
}

export function forbidden(): ApiError {
  return new ApiError('forbidden', 'この操作を行う権限がありません');
}

export function notFound(what: string): ApiError {
  return new ApiError('not_found', `${what}が見つかりません`);
}

export function conflict(message: string): ApiError {
  return new ApiError('conflict', message);
}
