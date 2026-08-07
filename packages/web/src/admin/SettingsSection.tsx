import { useCallback, useState } from 'react';
import { ApiRequestError } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import {
  type Column,
  csvOf,
  DataTable,
  downloadCsv,
  FormValidationError,
  useLoadable,
} from './resource.tsx';

/**
 * 設定 1 件ぶんの画面。
 *
 * どの設定も、一覧を出し、CSV で持ち出し、1 件作り、既にあるものを写して作る。
 * 同じ形にしておくと、はじめて触る設定でも次に何をすればよいかが分かる。
 *
 * 空のとき・読めないとき・失敗したときの見せ方もここで決める。
 * 画面ごとに書くと、ある設定では空欄、別の設定では読み込み中のまま、といった差が出る。
 */

export interface SettingsSectionProps<T> {
  title: string;
  hint?: string;
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  load: () => Promise<T[]>;
  canRead: boolean;
  /** 作る操作を出してよいか。読めるだけの利用者には form を出さない。 */
  canWrite: boolean;
  /** CSV のファイル名（拡張子は付けない）。 */
  csvName: string;
  form?: React.ReactNode;
  submit?: () => Promise<void>;
  /** 既にある行を写して、下の入力を埋める。 */
  onCopy?: (row: T) => void;
  /** 写す操作の名前。直す画面では「写して作る」ではなくなる。 */
  copyLabel?: string;
  /** 行ごとの操作。押したあとの読み直しは reload で行う。 */
  rowActions?: (row: T, reload: () => Promise<void>) => React.ReactNode;
  /** 一覧の上へ置く、絞り込みなどの操作。 */
  toolbar?: React.ReactNode;
  /** 一覧が空のときの言葉。設定ごとに次にすることが違う。 */
  emptyMessage?: string;
  /** 入力欄の見出し。直す画面では「新しく作る」ではなくなる。 */
  formTitle?: string;
  /**
   * CSV をまとめて取り込む。渡すと、取込の入口を出す。
   *
   * 取り込めなかったときは、行ごとの理由をそのまま見せる。
   * 「失敗しました」だけでは、どこを直せばよいのかが伝わらない。
   */
  importCsv?: (text: string) => Promise<{ created: number }>;
}

/** 取り込めなかった理由を、行ごとに並べて見せる。 */
function describeImportFailure(error: ApiRequestError): string {
  if (error.details === undefined || error.details.length === 0) return error.message;
  return [
    error.message,
    ...error.details.map((detail) =>
      detail.field === undefined ? detail.message : `${detail.field}: ${detail.message}`,
    ),
  ].join('\n');
}

export function SettingsSection<T>(props: SettingsSectionProps<T>): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [state, reload] = useLoadable(props.load, {
    enabled: props.canRead,
    failedMessage: labels.loadFailed,
  });
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const { importCsv } = props;
  const onImport = useCallback(
    async (file: File): Promise<void> => {
      if (importCsv === undefined) return;
      setImportMessage(null);
      setImportError(null);
      try {
        const result = await importCsv(await file.text());
        setImportMessage(labels.imported(result.created));
        await reload();
      } catch (error) {
        setImportError(
          error instanceof ApiRequestError ? describeImportFailure(error) : labels.saveFailed,
        );
      }
    },
    [importCsv, labels, reload],
  );

  const { submit } = props;
  const onSubmit = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault();
      if (submit === undefined) return;
      setPending(true);
      setFormError(null);
      setSaved(false);
      try {
        await submit();
        setSaved(true);
        await reload();
      } catch (error) {
        setFormError(
          error instanceof ApiRequestError || error instanceof FormValidationError
            ? error.message
            : labels.saveFailed,
        );
      } finally {
        setPending(false);
      }
    },
    [labels.saveFailed, reload, submit],
  );

  if (state.status === 'forbidden') {
    return (
      <section className="card">
        <h2>{props.title}</h2>
        <p>{labels.notVisible}</p>
      </section>
    );
  }

  const rows = state.status === 'ready' ? state.value : [];

  return (
    <section className="card">
      <h2>{props.title}</h2>
      {props.hint !== undefined && <p className="subtitle">{props.hint}</p>}

      {props.toolbar !== undefined && <div className="admin-toolbar">{props.toolbar}</div>}

      {props.canWrite && props.importCsv !== undefined && (
        <div className="admin-toolbar">
          <div className="field">
            <label htmlFor={`${props.csvName}-import`}>{labels.importCsv}</label>
            <input
              id={`${props.csvName}-import`}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void onImport(file);
                event.target.value = '';
              }}
            />
            <p className="hint">{labels.importCsvHint}</p>
          </div>
          {importMessage !== null && (
            <p className="notice" role="status">
              {importMessage}
            </p>
          )}
          {importError !== null && (
            <p className="form-error" role="alert">
              {importError}
            </p>
          )}
        </div>
      )}

      {state.status === 'loading' && <p>{messages.loading}</p>}

      {state.status === 'failed' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && rows.length === 0 && (
        <p>{props.emptyMessage ?? labels.noRecords}</p>
      )}

      {state.status === 'ready' && rows.length > 0 && (
        <>
          <DataTable
            columns={props.columns}
            rows={rows}
            rowKey={props.rowKey}
            label={props.title}
            actionsLabel={labels.rowActions}
            {...(props.onCopy === undefined && props.rowActions === undefined
              ? {}
              : {
                  actions: (row: T) => (
                    <>
                      {props.rowActions?.(row, reload)}
                      {props.onCopy !== undefined && props.canWrite && (
                        <button type="button" onClick={() => props.onCopy?.(row)}>
                          {props.copyLabel ?? labels.copyToForm}
                        </button>
                      )}
                    </>
                  ),
                })}
          />
          <div className="form-actions">
            <button
              type="button"
              onClick={() => downloadCsv(`${props.csvName}.csv`, csvOf(props.columns, rows))}
            >
              {messages.downloadCsv}
            </button>
          </div>
        </>
      )}

      {props.canWrite && props.form !== undefined && submit !== undefined && (
        <form onSubmit={(event) => void onSubmit(event)}>
          <h3>{props.formTitle ?? labels.addNew}</h3>
          {props.form}
          <div className="form-actions">
            <button type="submit" disabled={pending}>
              {pending ? labels.saving : labels.save}
            </button>
          </div>
          {saved && (
            <p className="notice" role="status">
              {labels.saved}
            </p>
          )}
          {formError !== null && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
