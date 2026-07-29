/**
 * CSV の組み立てと読み取り。
 *
 * 表計算で開けることを優先し、値は常に引用符で囲む。
 * 区切り文字や改行が値に含まれていても壊れないようにするため。
 */

export function toCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replaceAll('"', '""')}"`;
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
  const header = nonEmpty[0]?.map((entry) => entry.trim()) ?? [];
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
      row[name] = record[column] ?? '';
    });
    rows.push(row);
  }

  return { header, rows, problems };
}
