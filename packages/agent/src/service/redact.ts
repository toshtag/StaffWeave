/**
 * ログへ出してよい形へ直す。
 *
 * 端末のログは現場に残り、保守のときに人の目に触れる。
 * 秘密鍵、登録トークン、カードの識別子、その指紋が混ざると、
 * ログを読める者がそのまま端末を名乗れる。
 *
 * 「出さないよう気を付ける」では、項目が増えたときに漏れる。
 * 出す前に必ずここを通し、知っている名前は値ごと伏せる。
 */

/** 値を伏せる項目の名前。部分一致で見る。 */
const SECRET_NAME_PATTERNS = [
  'password',
  'secret',
  'token',
  'privatekey',
  'signature',
  'signingkey',
  'fingerprint',
  'card',
  'authorization',
  'cookie',
];

export const REDACTED = '[伏せた]';

function isSecretName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(/[-_]/g, '');
  return SECRET_NAME_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * 記録へ載せる値を作る。
 *
 * 知らない形（関数・シンボルなど）は、そのまま出さず型の名前だけにする。
 * 中身が分からないものを素通しすると、あとで何が出るか読めない。
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'undefined':
      return undefined;
    case 'object':
      break;
    default:
      return `[${typeof value}]`;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;

  const output: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    output[name] = isSecretName(name) ? REDACTED : redact(item, depth + 1);
  }
  return output;
}

export interface AgentLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/**
 * 1 行 1 件の記録を作る。
 *
 * 項目は必ず {@link redact} を通す。書く側が忘れても伏せられるようにする。
 */
export function createAgentLogger(write: (line: string) => void = console.log): AgentLogger {
  const emit = (level: 'info' | 'error', event: string, fields?: Record<string, unknown>): void => {
    write(JSON.stringify({ level, event, ...(redact(fields ?? {}) as Record<string, unknown>) }));
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
