import { toCsv } from '@staffweave/domain';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from '../api/client.ts';
import { ScrollableTable } from '../components/ScrollableTable.tsx';

/**
 * 設定画面の共通部品。
 *
 * 設定画面はどれも「一覧を出す・1 件作る・直す・写して作る・CSV で取り出す」の
 * 繰り返しになる。画面ごとに書くと、空のときの見せ方や失敗の出し方が少しずつずれ、
 * 直すときに全部を触ることになる。形をここに 1 つ置く。
 *
 * 列の定義は画面と CSV で共有する。別々に持つと、列を足したときに
 * 片方だけが古くなる。CSV は「画面に出ている表をそのまま持ち出したもの」に保つ。
 */

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'forbidden' }
  | { status: 'failed'; message: string };

/**
 * 一覧を読み、失敗と権限不足を見分けて持つ。
 *
 * 権限が無いことは失敗として見せない。見せられない設定は、節ごと出さないほうが分かりやすい。
 */
export function useLoadable<T>(
  load: () => Promise<T>,
  options: { enabled: boolean; failedMessage: string },
): [Loadable<T>, () => Promise<void>] {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });
  const { enabled, failedMessage } = options;

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setState({ status: 'forbidden' });
      return;
    }
    try {
      setState({ status: 'ready', value: await load() });
    } catch (error) {
      setState(
        error instanceof ApiRequestError && error.status === 403
          ? { status: 'forbidden' }
          : {
              status: 'failed',
              message: error instanceof ApiRequestError ? error.message : failedMessage,
            },
      );
    }
  }, [enabled, failedMessage, load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return [state, reload];
}

export interface Column<T> {
  key: string;
  header: string;
  /** CSV と画面の両方が使う値。画面だけの見せ方は cell で足す。 */
  value: (row: T) => string | number | null;
  cell?: (row: T) => React.ReactNode;
}

/** 表の中身を、画面に出ているとおりの CSV にする。 */
export function csvOf<T>(columns: readonly Column<T>[], rows: readonly T[]): string {
  return toCsv(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => column.value(row))),
  );
}

/** ブラウザに保存させる。取り出した中身はサーバーへ送らない。 */
export function downloadCsv(fileName: string, csv: string): void {
  // 表計算ソフトが UTF-8 として開けるよう、印を先頭に付ける。
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** 行ごとの操作。見出しは読み上げ用にだけ置く。 */
  actions?: (row: T) => React.ReactNode;
  actionsLabel?: string;
  /** 横に送る領域の名前。読み上げで「どの表か」を伝えるために要る。 */
  label: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  actionsLabel,
  label,
}: DataTableProps<T>): React.JSX.Element {
  return (
    <ScrollableTable label={label}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.header}
            </th>
          ))}
          {actions !== undefined && (
            <th scope="col">
              <span className="visually-hidden">{actionsLabel}</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key}>{column.cell?.(row) ?? column.value(row)}</td>
            ))}
            {actions !== undefined && <td className="row-actions">{actions(row)}</td>}
          </tr>
        ))}
      </tbody>
    </ScrollableTable>
  );
}

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number' | 'password' | 'email';
  required?: boolean;
  hint?: string;
  min?: number;
  max?: number;
  pattern?: string;
}

export function TextField(props: TextFieldProps): React.JSX.Element {
  const hintId = props.hint === undefined ? undefined : `${props.id}-hint`;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required={props.required ?? false}
        aria-describedby={hintId}
        {...(props.min === undefined ? {} : { min: props.min })}
        {...(props.max === undefined ? {} : { max: props.max })}
        {...(props.pattern === undefined ? {} : { pattern: props.pattern })}
      />
      {props.hint !== undefined && (
        <p className="notice" id={hintId}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

export interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}

export function SelectField<T extends string>(props: SelectFieldProps<T>): React.JSX.Element {
  const hintId = props.hint === undefined ? undefined : `${props.id}-hint`;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select
        id={props.id}
        value={props.value}
        aria-describedby={hintId}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint !== undefined && (
        <p className="notice" id={hintId}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

export function CheckboxField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}
