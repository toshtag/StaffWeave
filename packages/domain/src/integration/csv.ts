/**
 * CSV の組み立てと読み取り。
 *
 * 表計算で開けることを優先し、値は常に引用符で囲む。
 * 区切り文字や改行が値に含まれていても壊れないようにするため。
 */

/**
 * 表計算が数式の始まりとして読む文字。
 *
 * 引用符で囲んでも解釈は変わらない。Excel も LibreOffice も、
 * 引用符を外したあとの内容を数式として評価する。
 */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * 無害化に使う印。
 *
 * 表計算はこの印を「以降を文字列として扱う」指示として読み、セルには表示しない。
 * 読み取り側（{@link parseCsv}）は同じ規則で外すため、staffweave 同士の
 * 書き出しと取り込みでは値が変わらない。
 */
const TEXT_MARKER = "'";

function startsFormula(text: string): boolean {
  const [first] = text;
  return first !== undefined && FORMULA_LEADERS.includes(first);
}

/**
 * 表計算で数式として動く値を、文字列として扱わせる形へ直す。
 *
 * 負の数のように正しい値も対象になるが、数値の列は数値として渡すため印は付かない。
 * 文字列として渡された `-1` は印が付く。
 */
export function neutralizeFormula(text: string): string {
  return startsFormula(text) ? `${TEXT_MARKER}${text}` : text;
}

/** {@link neutralizeFormula} が付けた印を外す。付いていなければそのまま返す。 */
export function stripFormulaMarker(text: string): string {
  return text.startsWith(TEXT_MARKER) && startsFormula(text.slice(1)) ? text.slice(1) : text;
}

export function toCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  // 数値はそのまま出す。数式として読まれる形にはならない。
  const text = typeof value === 'number' ? String(value) : neutralizeFormula(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return [
    header.map(toCsvValue).join(','),
    ...rows.map((row) => row.map(toCsvValue).join(',')),
  ].join('\n');
}

export interface CsvParseProblem {
  line: number;
  message: string;
}

export interface CsvParseResult {
  header: string[];
  rows: Record<string, string>[];
  problems: CsvParseProblem[];
}

/**
 * 引用符つき CSV を読み取る。
 *
 * 完全な仕様への対応ではなく、この製品が受け取る形（引用符と改行を含む値）だけを扱う。
 * 列数が合わない行は読み飛ばし、何行目で何が起きたかを返す。
 */
export function parseCsv(text: string): CsvParseResult {
  const records: string[][] = [];
  let current: string[] = [];
  let value = '';
  let inQuotes = false;

  const pushValue = (): void => {
    current.push(value);
    value = '';
  };
  const pushRecord = (): void => {
    pushValue();
    records.push(current);
    current = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      pushValue();
    } else if (character === '\n') {
      pushRecord();
    } else if (character !== '\r') {
      value += character ?? '';
    }
  }

  if (value !== '' || current.length > 0) pushRecord();

  const nonEmpty = records.filter((record) => record.some((entry) => entry.trim() !== ''));
  const header = nonEmpty[0]?.map((entry) => stripFormulaMarker(entry.trim())) ?? [];
  const problems: CsvParseProblem[] = [];
  const rows: Record<string, string>[] = [];

  for (let index = 1; index < nonEmpty.length; index += 1) {
    const record = nonEmpty[index];
    if (!record) continue;
    if (record.length !== header.length) {
      problems.push({
        line: index + 1,
        message: `列数が見出しと一致しません（見出し ${header.length} 列、この行 ${record.length} 列）`,
      });
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((name, column) => {
      // 自分が書き出した印は外す。書き出しと取り込みで値が変わらないようにする。
      row[name] = stripFormulaMarker(record[column] ?? '');
    });
    rows.push(row);
  }

  return { header, rows, problems };
}
