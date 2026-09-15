import React from 'react';
import { ClipboardCopy, Columns3, FileDown, FileUp, Funnel, Palette, Rows3, TextCursorInput } from 'lucide-react';
import './chartPanel.css';
import { NumberStepper } from '../ui/NumberStepper';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { Row } from './panelPrimitives';
import { Group, IconAction, Note, TextField } from './chartPanelParts';
import { TableExampleButton } from './TableExamples';
import { useStore } from '../../hooks/useStore';
import { editor } from '../../engine/api/EditorAPI';
import type { SketchLevel } from '../../engine/model/rough';
import type { TableNode } from '../../engine/model/schema';
import * as M from '../../engine/table/tableModel';
import {
  copyTableCsv,
  exportTableCsv,
  importCsvIntoTable,
  updateTable,
} from '../../engine/table/tableApply';
import {
  CELL_TYPES,
  CELL_TYPE_LABELS,
  DEFAULT_ACCENT,
  TABLE_THEMES,
  TABLE_THEME_LABELS,
  type CellType,
  type TableSpec,
  type TableTheme,
} from '../../engine/table/tableTypes';
import { columnLetter } from '../sheet/useSheet';

/**
 * A table's properties: its look, its shape, its columns and its view.
 *
 * Laid out in the chart panel's vocabulary — the same groups, fields and
 * chips — because a table and a chart are the two data objects on the board
 * and are often edited one after the other. Cell content is edited on the
 * board itself (`TableEditor`); this is everything about the table *as a
 * whole*.
 */
export const TableSection: React.FC<{ node: TableNode }> = ({ node }) => {
  const spec = node.table;
  const apply = (next: TableSpec) => updateTable(node, next);
  const patch = (p: Partial<TableSpec>) => apply({ ...spec, ...p });
  const [notice, setNotice] = React.useState<string | null>(null);
  const say = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const rows = spec.cells.length;
  const cols = spec.columns.length;
  const sketch = node.appearance?.sketch;
  const setSketch = (level: SketchLevel | undefined) =>
    editor.updateNode(node.id, { appearance: { ...(node.appearance ?? {}), sketch: level } });

  const setRows = (n: number) => {
    const target = Math.max(1, Math.min(2000, Math.round(n)));
    if (target > rows) apply(M.insertRows(spec, rows, target - rows));
    else if (target < rows) apply(M.deleteRows(spec, target, rows - target));
  };
  const setCols = (n: number) => {
    const target = Math.max(1, Math.min(60, Math.round(n)));
    if (target > cols) apply(M.insertCols(spec, cols, target - cols));
    else if (target < cols) apply(M.deleteCols(spec, target, cols - target));
  };

  const heading = (c: number) => (spec.header ? spec.cells[0]?.[c]?.trim() : '') || `Column ${columnLetter(c)}`;

  return (
    <div className="chartp">
      <div className="chartp-databar" role="toolbar" aria-label="Table">
        <button type="button" className="chartp-databar__open" onClick={() => useStore.getState().setTableEditNodeId(node.id)}>
          <TextCursorInput size={14} aria-hidden="true" />
          <span>Edit cells</span>
        </button>
        <span className="chartp-databar__sep" aria-hidden="true" />
        <IconAction label="Import a CSV file" onClick={() => void importCsvIntoTable(node).then((m) => m && say(m))}>
          <FileUp size={14} />
        </IconAction>
        <IconAction label="Export a CSV file" onClick={() => exportTableCsv(spec)}>
          <FileDown size={14} />
        </IconAction>
        <IconAction label="Copy as CSV" onClick={() => void copyTableCsv(spec).then((ok) => say(ok ? 'Copied as CSV' : 'Clipboard unavailable'))}>
          <ClipboardCopy size={14} />
        </IconAction>
        <span className="chartp-databar__end">
          <TableExampleButton onPick={apply} />
        </span>
      </div>
      <div className="chartp-datafoot">
        <span>
          {rows} rows · {cols} columns
          {spec.filter ? ` · showing ${M.viewRows(spec).length - (spec.header ? 1 : 0)}` : ''}
        </span>
        <span className="chartp-datafoot__notice" role="status" aria-live="polite">
          {notice}
        </span>
      </div>

      <Group label="Style" icon={<Palette size={14} />}>
        <Row label="Theme" stack>
          <div className="tblthemes" role="radiogroup" aria-label="Table theme">
            {TABLE_THEMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={spec.theme === t}
                className="tbltheme"
                onClick={() => patch({ theme: t })}
              >
                <ThemeSpecimen theme={t} accent={spec.accent ?? DEFAULT_ACCENT} />
                <span className="tbltheme__name">{TABLE_THEME_LABELS[t]}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Accent">
          <ColorPickerPopover color={spec.accent ?? DEFAULT_ACCENT} onChange={(accent) => patch({ accent })} />
        </Row>
        <Row label="Text size">
          <NumberStepper value={spec.fontSize} min={9} max={32} suffix="px" aria-label="Text size" onChange={(fontSize) => patch({ fontSize })} />
        </Row>
        <Row label="Header row" hint="The first row names the columns and stays on top when sorted">
          <Switch checked={spec.header} onChange={(header) => patch({ header })} label="Header row" />
        </Row>
        <Row label="Row labels" hint="Emphasise the first column">
          <Switch checked={Boolean(spec.firstColumn)} onChange={(on) => patch({ firstColumn: on || undefined })} label="First column" />
        </Row>
        <Row label="Drawing">
          <SegmentedControl
            fill
            ariaLabel="Drawing style"
            value={sketch ? 'sketch' : 'clean'}
            onChange={(v) => setSketch(v === 'sketch' ? sketch ?? 'medium' : undefined)}
            segments={[
              { value: 'clean', label: 'Clean', hint: 'Precise and presentation-ready' },
              { value: 'sketch', label: 'Sketch', hint: 'Hand-drawn — every cell kept' },
            ]}
          />
        </Row>
      </Group>

      <Group label="Size" icon={<Rows3 size={14} />}>
        <Row label="Rows">
          <NumberStepper value={rows} min={1} max={2000} aria-label="Rows" onChange={setRows} />
        </Row>
        <Row label="Columns">
          <NumberStepper value={cols} min={1} max={60} aria-label="Columns" onChange={setCols} />
        </Row>
      </Group>

      <Group label="Columns" icon={<Columns3 size={14} />}>
        <div className="tblcols">
          {spec.columns.map((col, c) => (
            <div className="tblcol" key={c}>
              <span className="tblcol__letter">{columnLetter(c)}</span>
              <span className="tblcol__name" title={heading(c)}>
                {heading(c)}
              </span>
              <select
                className="chartp-select"
                aria-label={`${heading(c)} type`}
                value={col.type}
                onChange={(e) => apply(M.setColumn(spec, c, { type: e.target.value as CellType }))}
              >
                {CELL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CELL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <Note>Types decide how values are shown, aligned and sorted — the text you typed is kept as it is.</Note>
        {spec.columns.some((c, i) => c.type === 'text' && M.inferType(spec.cells.slice(spec.header ? 1 : 0).map((r) => r[i])) !== 'text') && (
          <button
            type="button"
            className="chartp-link"
            onClick={() =>
              apply({
                ...spec,
                columns: spec.columns.map((c, i) => ({
                  ...c,
                  type: M.inferType(spec.cells.slice(spec.header ? 1 : 0).map((r) => r[i])),
                })),
              })
            }
          >
            Detect types from the data
          </button>
        )}
        {spec.columns.some((c) => c.type === 'currency') && (
          <Row label="Currency">
            <TextField label="Currency symbol" placeholder="$" value={spec.currency} onChange={(currency) => patch({ currency })} />
          </Row>
        )}
      </Group>

      <Group label="View" icon={<Funnel size={14} />}>
        <Row label="Sort by">
          <select
            className="chartp-select"
            aria-label="Sort by column"
            value={spec.sort ? String(spec.sort.col) : ''}
            onChange={(e) =>
              patch({ sort: e.target.value === '' ? undefined : { col: Number(e.target.value), dir: spec.sort?.dir ?? 'asc' } })
            }
          >
            <option value="">As entered</option>
            {spec.columns.map((_, c) => (
              <option key={c} value={c}>
                {heading(c)}
              </option>
            ))}
          </select>
        </Row>
        {spec.sort && (
          <Row label="Direction">
            <SegmentedControl
              fill
              ariaLabel="Sort direction"
              value={spec.sort.dir}
              onChange={(v) => patch({ sort: { ...spec.sort!, dir: v as 'asc' | 'desc' } })}
              segments={[
                { value: 'asc', label: 'A → Z', hint: 'Smallest first' },
                { value: 'desc', label: 'Z → A', hint: 'Largest first' },
              ]}
            />
          </Row>
        )}
        <Row label="Filter">
          <select
            className="chartp-select"
            aria-label="Filter column"
            value={spec.filter ? String(spec.filter.col) : ''}
            onChange={(e) =>
              patch({
                filter: e.target.value === '' ? undefined : { col: Number(e.target.value), query: spec.filter?.query || ' ' },
              })
            }
          >
            <option value="">No filter</option>
            {spec.columns.map((_, c) => (
              <option key={c} value={c}>
                {heading(c)}
              </option>
            ))}
          </select>
        </Row>
        {spec.filter && (
          <Row label="Matching">
            <TextField
              label="Filter text"
              placeholder={spec.columns[spec.filter.col]?.type === 'text' ? 'Contains…' : '>10, <5, 5..20'}
              value={spec.filter.query.trim() ? spec.filter.query : undefined}
              onChange={(q) => patch({ filter: { ...spec.filter!, query: q ?? ' ' } })}
            />
          </Row>
        )}
        {(spec.sort || spec.filter) && (
          <div className="chartp-caption" style={{ paddingLeft: 0 }}>
            <span>A view: the stored rows are untouched.</span>
            <button type="button" className="chartp-link" onClick={() => apply(M.applyView(spec))}>
              Make it the order
            </button>
          </div>
        )}
      </Group>
    </div>
  );
};

/** A tiny table in each theme, so the choice is made by looking. */
const ThemeSpecimen: React.FC<{ theme: TableTheme; accent: string }> = ({ theme, accent }) => {
  const head =
    theme === 'bold' ? accent : theme === 'striped' ? `${accent}33` : theme === 'minimal' ? 'transparent' : '#EEF2F6';
  const zebra = theme === 'striped' || theme === 'bold' ? (theme === 'bold' ? `${accent}14` : '#F1F5F9') : 'transparent';
  const rule = theme === 'grid' ? '#94A3B8' : '#CBD5E1';
  return (
    <svg className="tbltheme__svg" viewBox="0 0 60 36" aria-hidden="true">
      <rect x="0.5" y="0.5" width="59" height="35" rx={theme === 'minimal' ? 0 : 4} fill="#FFFFFF" stroke={theme === 'minimal' ? 'none' : rule} />
      <rect x="1" y="1" width="58" height="9" rx="3" fill={head} />
      <rect x="1" y="19" width="58" height="8" fill={zebra} />
      {theme !== 'striped' && theme !== 'bold' && (
        <>
          <line x1="1" y1="18.5" x2="59" y2="18.5" stroke={rule} strokeWidth="0.6" />
          <line x1="1" y1="27.5" x2="59" y2="27.5" stroke={rule} strokeWidth="0.6" />
        </>
      )}
      <line x1="1" y1="10.5" x2="59" y2="10.5" stroke={theme === 'minimal' ? '#0F172A' : rule} strokeWidth={theme === 'minimal' ? 1.2 : 0.8} />
      {(theme === 'grid' || theme === 'clean') && (
        <>
          <line x1="22" y1="1" x2="22" y2="35" stroke={rule} strokeWidth="0.6" />
          <line x1="41" y1="1" x2="41" y2="35" stroke={rule} strokeWidth="0.6" />
        </>
      )}
      {[4.5, 14, 23, 31.5].map((y, i) => (
        <rect key={i} x="5" y={y - 1} width={i === 0 ? 12 : 10} height="2" rx="1" fill={i === 0 && theme === 'bold' ? '#FFFFFF' : '#64748B'} opacity={i === 0 ? 0.9 : 0.5} />
      ))}
    </svg>
  );
};
