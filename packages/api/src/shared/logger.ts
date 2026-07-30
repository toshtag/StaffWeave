/**
 * 背景処理向けの構造化ログ。
 *
 * 1 行 1 件の JSON として出し、後から機械的に読めるようにする。
 * 何を書くかは呼び出し側が決める。秘密の値、署名鍵、送信内容の全文は渡さない。
 */

export interface StructuredLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function write(
  target: (line: string) => void,
  level: string,
  name: string,
  event: string,
  fields: Record<string, unknown> | undefined,
): void {
  target(JSON.stringify({ level, logger: name, event, ...fields }));
}

export function createConsoleLogger(name: string): StructuredLogger {
  return {
    info: (event, fields) => write((line) => console.log(line), 'info', name, event, fields),
    error: (event, fields) => write((line) => console.error(line), 'error', name, event, fields),
  };
}

/** 何も出さないログ。テストや、出力を必要としない組み立てで使う。 */
export const silentLogger: StructuredLogger = { info: () => {}, error: () => {} };
