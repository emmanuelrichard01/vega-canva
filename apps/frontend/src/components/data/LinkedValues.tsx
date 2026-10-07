import React from 'react';
import { parseNumber } from '../../engine/chart/chartCsv';
import { formatValue } from '../../engine/chart/chartLayout';
import { planWriteBack, resolveTableLink, type WriteBackPlan } from '../../engine/chart/chartFromTable';
import type { ChartSpec, ChartTableLink } from '../../engine/chart/chartTypes';
import type { TableSpec } from '../../engine/table/tableTypes';
import { tableNode, tableTitle } from '../../engine/table/tableRegistry';
import { commitWriteBack } from './dataActions';

/**
 * The linked numbers, read through, and the way back to the table.
 *
 * An editor can retype a value here; nothing is written until they confirm
 * the exact cell and the change, because the cell belongs to the table and
 * may feed formulas and other charts. A value combined from several rows, or
 * computed by a formula, says so instead of offering to write.
 */

const MAX_ROWS = 60;

interface Props {
  chartId: string;
  spec: ChartSpec;
  link: ChartTableLink;
  table: TableSpec;
  canEdit: boolean;
}

type Pending = { si: number; ci: number; plan: WriteBackPlan };

export const LinkedValues: React.FC<Props> = ({ chartId, spec, link, table, canEdit }) => {
  const data = React.useMemo(() => resolveTableLink(table, link), [table, link]);
  const [editing, setEditing] = React.useState<{ si: number; ci: number; draft: string } | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const tableName = tableTitle(tableNode(link.tableId) ?? {}) || 'the table';

  React.useEffect(() => {
    if (pending?.plan.ok) confirmRef.current?.focus();
  }, [pending]);

  const values = data.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0);
  const rows = data.categories.slice(0, MAX_ROWS);

  const submit = () => {
    if (!editing) return;
    const n = parseNumber(editing.draft);
    const was = data.series[editing.si]?.values[editing.ci] ?? null;
    setEditing(null);
    if (n === null || n === was) return;
    setNotice(null);
    setPending({ si: editing.si, ci: editing.ci, plan: planWriteBack(table, link, editing.si, editing.ci, n) });
  };

  const confirm = () => {
    if (!pending?.plan.ok) return;
    const ok = commitWriteBack(link.tableId, pending.plan);
    setNotice(ok ? `Wrote ${pending.plan.after} to ${pending.plan.cell}` : `${pending.plan.cell} changed meanwhile; nothing was written`);
    setPending(null);
  };

  if (data.series.length === 0 || rows.length === 0) {
    return <p className="pg-note">The range has no readings to draw. Widen it, or check the filters.</p>;
  }

  return (
    <div className="data-values">
      <div className="data-values__scroll" role="region" aria-label="Linked values" tabIndex={0}>
        <table className="data-values__table">
          <thead>
            <tr>
              <th scope="col" className="data-values__cat">
                <span className="sr-only">Category</span>
              </th>
              {data.series.map((s, si) => (
                <th key={si} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cat, ci) => (
              <tr key={ci}>
                <th scope="row" className="data-values__cat">
                  {cat}
                </th>
                {data.series.map((s, si) => {
                  const v = s.values[ci];
                  const shown = v === null ? '' : formatValue(v, spec);
                  const here = editing?.si === si && editing.ci === ci;
                  const marked = pending?.si === si && pending.ci === ci;
                  return (
                    <td key={si} data-marked={marked || undefined}>
                      {here ? (
                        <input
                          className="data-values__input"
                          autoFocus
                          inputMode="decimal"
                          aria-label={`${s.name}, ${cat}`}
                          value={editing.draft}
                          onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                          onBlur={submit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submit();
                            else if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : canEdit ? (
                        <button
                          type="button"
                          className="data-values__cell"
                          aria-label={`${s.name}, ${cat}: ${shown || 'empty'}. Change`}
                          onClick={() => {
                            setPending(null);
                            setEditing({ si, ci, draft: v === null ? '' : String(v) });
                          }}
                        >
                          {shown}
                        </button>
                      ) : (
                        <span className="data-values__cell">{shown}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending && !pending.plan.ok && (
        <p className="data-values__notice" role="status">
          {pending.plan.reason}.
        </p>
      )}
      {pending?.plan.ok && (
        <div
          className="data-confirm"
          role="alertdialog"
          aria-label="Write to the table"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setPending(null);
            }
          }}
        >
          <p>
            {'Write '}
            <strong>{pending.plan.after}</strong>
            {` to ${tableName}!${pending.plan.cell}`}
            {pending.plan.before.trim() ? `, replacing ${pending.plan.before.trim()}?` : '?'}
          </p>
          <div className="data-confirm__actions">
            <button type="button" className="data-textbtn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button ref={confirmRef} type="button" className="data-primary" onClick={confirm}>
              Write to table
            </button>
          </div>
        </div>
      )}

      <div className="data-foot" id={`data-foot-${chartId}`}>
        <span>{`${data.categories.length} ${data.categories.length === 1 ? 'category' : 'categories'} · ${data.series.length} series · ${values} values`}</span>
        <span className="data-foot__notice" role="status" aria-live="polite">
          {notice ?? (data.categories.length > MAX_ROWS ? `First ${MAX_ROWS} shown` : canEdit ? 'Select a value to change it' : '')}
        </span>
      </div>
    </div>
  );
};
