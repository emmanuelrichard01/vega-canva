import React from 'react';
import { ChevronDown, ClipboardCopy, EyeOff, FileDown, FileUp, Funnel, TextCursorInput, Undo2, X } from 'lucide-react';
import './chartPanel.css';
import '../table/tableTools.css';
import { Section, Row, PairRow, FullRow, Note, NumberField, Select, ColorChip, SpecimenPicker, IconToggle, SegmentedControl, Switch } from './grammar';
import { TableExampleButton } from './TableExamples';
import { useStore } from '../../hooks/useStore';
import { editor } from '../../engine/api/EditorAPI';
import { undoManager } from '../../engine/document';
import type { SketchLevel } from '../../engine/model/rough';
import type { TableNode } from '../../engine/model/schema';
import * as M from '../../engine/table/tableModel';
import { copyTableCsv, exportTableCsv, fitTableColumns, importCsvIntoTable, saveDefaultView, updateTable } from '../../engine/table/tableApply';
import { effectiveSpec, hasOwnView, resetView, subscribeViews, viewsVersion } from '../../engine/table/tableView';
import {
  CELL_TYPE_LABELS,
  DEFAULT_ACCENT,
  filterOn,
  TABLE_THEMES,
  TABLE_THEME_LABELS,
  type ColourRule,
  type TableSpec,
  type TableTheme,
} from '../../engine/table/tableTypes';
import { Menu, type MenuAnchor } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';
import { columnLetter } from '../sheet/useSheet';
import { columnMenuEntries, columnName, TYPE_ICONS } from '../table/columnMenu';
import { FilterPanel } from '../table/FilterPanel';

/** The paints a rule offers: six tints that each hold their text at AA, and two inks for a quieter mark. */
const RULE_PAINTS: Array<{ label: string; fill?: string; color: string }> = [
  { label: 'Green', fill: '#DCFCE7', color: '#166534' },
  { label: 'Amber', fill: '#FEF3C7', color: '#92400E' },
  { label: 'Red', fill: '#FEE2E2', color: '#991B1B' },
  { label: 'Blue', fill: '#DBEAFE', color: '#1E40AF' },
  { label: 'Violet', fill: '#EDE9FE', color: '#5B21B6' },
  { label: 'Grey', fill: '#F1F5F9', color: '#475569' },
  { label: 'Red text', color: '#B91C1C' },
  { label: 'Green text', color: '#15803D' },
];

/** Colour scales, low to high: light enough at both ends that cell text holds. */
const SCALES: Array<{ id: string; label: string; from: string; mid?: string; to: string }> = [
  { id: 'green', label: 'White to green', from: '#FFFFFF', to: '#86EFAC' },
  { id: 'red', label: 'White to red', from: '#FFFFFF', to: '#FCA5A5' },
  { id: 'rag', label: 'Red, amber, green', from: '#FCA5A5', mid: '#FDE68A', to: '#86EFAC' },
  { id: 'blue', label: 'White to blue', from: '#FFFFFF', to: '#93C5FD' },
];

const BAR_COLOURS = ['#2563EB', '#16A34A', '#D97706', '#9333EA'];

/**
 * A table's properties: its look, its shape, its columns, its view and its
 * colour rules.
 *
 * Cell content is edited on the board itself (`TableEditor`); this is
 * everything about the table *as a whole*. Each column is a row that opens the
 * same column menu the editor's letters open, so type, sort, filter and
 * summary have one place each.
 */
export const TableSection: React.FC<{ node: TableNode }> = ({ node }) => {
  // The table as this person sees it: their own sort and filter over the shared one.
  const viewVersion = React.useSyncExternalStore(subscribeViews, viewsVersion, () => 0);
  const spec = React.useMemo(
    () => effectiveSpec(node.id, node.table),
    // viewVersion: the view lives outside the node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, node.table, viewVersion]
  );
  const ownView = hasOwnView(node.id);
  /** The node as the store has it now — an edit made after another in the same frame builds on it, not on this render's copy. */
  const live = (): TableNode => {
    const n = useStore.getState().objects[node.id];
    return n && n.type === 'table' ? (n as TableNode) : node;
  };
  const liveSpec = () => effectiveSpec(node.id, live().table);
  const apply = (next: TableSpec) => updateTable(live(), next);
  const patch = (p: Partial<TableSpec>) => apply({ ...liveSpec(), ...p });
  const [notice, setNotice] = React.useState<{ text: string; undo?: boolean } | null>(null);
  const timers = React.useRef(new Set<number>());
  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);
  const say = (text: string, undo = false) => {
    setNotice({ text, undo });
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setNotice((n) => (n?.text === text ? null : n));
    }, 4000);
    timers.current.add(t);
  };
  const [menu, setMenu] = React.useState<{ col: number; anchor: MenuAnchor } | null>(null);
  const [filterFor, setFilterFor] = React.useState<{ col: number; anchor: MenuAnchor } | null>(null);

  const rows = spec.cells.length;
  const cols = spec.columns.length;
  const sketch = node.appearance?.sketch;
  const setSketch = (level: SketchLevel | undefined) =>
    editor.updateNode(node.id, { appearance: { ...(node.appearance ?? {}), sketch: level } });

  /** Lowering the count past cells with something in them says what went, with a way back. */
  const setRows = (n: number) => {
    const spec = liveSpec();
    const rows = spec.cells.length;
    const target = Math.max(1, Math.min(2000, Math.round(n)));
    if (target > rows) apply(M.insertRows(spec, rows, target - rows));
    else if (target < rows) {
      const lost = M.filledRowsFrom(spec, target);
      apply(M.deleteRows(spec, target, rows - target));
      if (lost) say(`Removed ${lost} row${lost === 1 ? '' : 's'} with data`, true);
    }
  };
  const setCols = (n: number) => {
    const spec = liveSpec();
    const cols = spec.columns.length;
    const target = Math.max(1, Math.min(60, Math.round(n)));
    if (target > cols) apply(M.insertCols(spec, cols, target - cols));
    else if (target < cols) {
      const lost = M.filledColsFrom(spec, target);
      apply(M.deleteCols(spec, target, cols - target));
      if (lost) say(`Removed ${lost} column${lost === 1 ? '' : 's'} with data`, true);
    }
  };

  const columnOptions = spec.columns.map((_, c) => ({ value: String(c), label: columnName(spec, c), icon: TYPE_ICONS[spec.columns[c].type] }));

  const setRule = (i: number, p: Partial<ColourRule>) => patch({ rules: (liveSpec().rules ?? []).map((r, j) => (j === i ? { ...r, ...p } : r)) });
  /**
   * A new rule starts on the column most like a status — the fewest distinct
   * values — and on its most common value, so it colours something the moment
   * it exists and the person edits a working rule rather than a blank one.
   */
  const addRule = () => {
    const body = spec.cells.slice(spec.header ? 1 : 0);
    let best = { col: 0, when: '>0', distinct: Infinity };
    spec.columns.forEach((_, c) => {
      const counts = new Map<string, number>();
      for (const row of body) {
        const v = row[c]?.trim();
        if (v && v[0] !== '=') counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      if (counts.size < 2 || counts.size >= best.distinct) return;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      best = { col: c, when: top, distinct: counts.size };
    });
    patch({ rules: [...(spec.rules ?? []), { col: best.col, when: best.when, ...RULE_PAINTS[0] }] });
  };
  /** The first numeric column without the thing already, for a new scale or bar. */
  const numericCol = (taken: number[]) => {
    const c = spec.columns.findIndex((col, i) => !taken.includes(i) && ['number', 'currency', 'percent', 'rating', 'date'].includes(col.type));
    return c >= 0 ? c : spec.columns.findIndex((_, i) => !taken.includes(i));
  };
  const addScale = () => {
    const col = numericCol((spec.scales ?? []).map((s) => s.col));
    if (col < 0) return;
    const s = SCALES[0];
    patch({ scales: [...(spec.scales ?? []), { col, from: s.from, to: s.to }] });
  };
  const addBar = () => {
    const col = numericCol((spec.bars ?? []).map((b) => b.col));
    if (col < 0) return;
    patch({ bars: [...(spec.bars ?? []), { col, color: BAR_COLOURS[0] }] });
  };
  const formattingCount = (spec.rules?.length ?? 0) + (spec.scales?.length ?? 0) + (spec.bars?.length ?? 0);

  const filters = spec.filters ?? [];
  const describeFilter = (c: number) => {
    const f = filterOn(spec, c);
    if (!f) return '';
    if (f.values) return f.values.length === 1 ? `is ${f.values[0] || 'empty'}` : `is one of ${f.values.length}`;
    return f.query.trim() ? f.query.trim() : 'not set yet';
  };
  const shown = M.viewRows(spec).length - (spec.header ? 1 : 0);
  const frozen = M.frozenOf(spec);

  return (
    <>
      <FullRow label="Table data">
        <div className="tblpanel-data">
          <button type="button" className="tblpanel-edit" onClick={() => useStore.getState().setTableEditNodeId(node.id)}>
            <TextCursorInput size={14} aria-hidden="true" />
            Edit cells
          </button>
          <div className="tblpanel-actions" role="toolbar" aria-label="Table data">
            <IconToggle label="Import a CSV file" pressed={false} onClick={() => void importCsvIntoTable(node).then((m) => m && say(m))}>
              <FileUp size={14} />
            </IconToggle>
            <IconToggle label="Download as CSV" pressed={false} onClick={() => exportTableCsv(spec)}>
              <FileDown size={14} />
            </IconToggle>
            <IconToggle label="Copy as CSV" pressed={false} onClick={() => void copyTableCsv(spec).then((ok) => say(ok ? 'Copied as CSV' : 'Clipboard unavailable'))}>
              <ClipboardCopy size={14} />
            </IconToggle>
            <span className="tblpanel-actions__end">
              <TableExampleButton onPick={(example) => updateTable(live(), example, undefined, 'shared')} />
            </span>
          </div>
        </div>
      </FullRow>
      <p className="tblpanel-status" role="status" aria-live="polite">
        <span>
          {rows} rows · {cols} columns{M.filtersActive(spec) ? ` · showing ${shown}` : ''}
        </span>
        {notice && (
          <span className="tblpanel-status__notice">
            {notice.text}
            {notice.undo && (
              <button
                type="button"
                onClick={() => {
                  undoManager.undo();
                  setNotice(null);
                }}
              >
                <Undo2 size={12} aria-hidden="true" />
                Undo
              </button>
            )}
          </span>
        )}
      </p>

      <Section id="table-style" title="Style" subject="table">
        <SpecimenPicker<TableTheme>
          label="Theme"
          value={spec.theme}
          size={48}
          onChange={(theme) => patch({ theme })}
          options={TABLE_THEMES.map((t) => ({
            value: t,
            label: TABLE_THEME_LABELS[t],
            render: (size: number) => <ThemeSpecimen theme={t} accent={spec.accent ?? DEFAULT_ACCENT} size={size} />,
          }))}
        />
        <Row label="Accent">
          <ColorChip label="Accent" value={spec.accent ?? DEFAULT_ACCENT} allowNone={false} onChange={(accent) => patch({ accent })} />
        </Row>
        <Row label="Text size">
          <NumberField label="Text size" value={spec.fontSize} min={9} max={32} unit="px" onChange={(fontSize, { commit }) => commit && patch({ fontSize })} />
        </Row>
        <Row label="Header row" hint="The first row names the columns and stays on top when sorted">
          <Switch checked={spec.header} onChange={(header) => patch({ header })} />
        </Row>
        <Row label="Row labels" hint="Emphasise the first column">
          <Switch checked={Boolean(spec.firstColumn)} onChange={(on) => patch({ firstColumn: on || undefined })} />
        </Row>
        <FullRow label="Drawing">
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
        </FullRow>
      </Section>

      <Section id="table-size" title="Size" subject="table">
        <PairRow>
          <NumberField label="Rows" glyph="R" value={rows} min={1} max={2000} scrub={false} onChange={(n, { commit }) => commit && setRows(n)} />
          <NumberField label="Columns" glyph="C" value={cols} min={1} max={60} scrub={false} onChange={(n, { commit }) => commit && setCols(n)} />
        </PairRow>
        <PairRow>
          <NumberField
            label="Frozen rows"
            glyph="↧"
            value={frozen.rows}
            min={0}
            max={Math.min(rows, 20)}
            scrub={false}
            onChange={(n, { commit }) => commit && patch({ frozen: n || frozen.cols ? { rows: n, cols: frozen.cols } : undefined })}
          />
          <NumberField
            label="Frozen columns"
            glyph="↦"
            value={frozen.cols}
            min={0}
            max={Math.min(cols, 10)}
            scrub={false}
            onChange={(n, { commit }) => commit && patch({ frozen: n || frozen.rows ? { rows: frozen.rows, cols: n } : undefined })}
          />
        </PairRow>
        <Row label="Grow to fit" hint="Columns widen and wrapped rows grow to show what you type">
          <Switch checked={spec.autoFit !== false} onChange={(on) => patch({ autoFit: on ? undefined : false })} />
        </Row>
        <Row label="Summary row" hint="Totals and counts under each column, over the rows on show">
          <Switch
            checked={M.hasSummary(spec)}
            onChange={(on) =>
              patch({
                summary: on
                  ? spec.columns.map((col) => (col.type === 'checkbox' ? 'checked' : M.summaryChoices(col.type).includes('sum') ? 'sum' : null))
                  : undefined,
              })
            }
          />
        </Row>
        <FullRow>
          <button
            type="button"
            className="tblpanel-link"
            onClick={() => {
              if (!fitTableColumns(node)) say('Every column already fits');
            }}
          >
            Fit every column to its content
          </button>
        </FullRow>
      </Section>

      <Section id="table-columns" title="Columns" subject="table" meta={cols}>
        <div className="tblpanel-cols" role="list">
          {spec.columns.map((col, c) => {
            const f = filterOn(spec, c);
            const on = Boolean(f && (f.values || f.query.trim()));
            return (
              <button
                key={c}
                type="button"
                role="listitem"
                className="tblpanel-col"
                data-hidden={col.hidden || undefined}
                aria-label={`${columnName(spec, c)}, ${CELL_TYPE_LABELS[col.type]}. Open the column menu`}
                onClick={(e) => setMenu({ col: c, anchor: { kind: 'rect', rect: e.currentTarget.getBoundingClientRect(), prefer: 'below', align: 'end' } })}
              >
                <span className="tblpanel-col__letter">{columnLetter(c)}</span>
                <span className="tblpanel-col__icon" aria-hidden="true">
                  {TYPE_ICONS[col.type]}
                </span>
                <span className="tblpanel-col__name">{columnName(spec, c)}</span>
                {col.hidden && <EyeOff size={13} className="tblpanel-col__flag" aria-label="Hidden" />}
                {on && <Funnel size={13} className="tblpanel-col__flag" aria-label="Filtered" />}
                <span className="tblpanel-col__type">{CELL_TYPE_LABELS[col.type]}</span>
                <ChevronDown size={13} className="tblpanel-col__caret" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {spec.columns.some((c, i) => c.type === 'text' && M.inferType(spec.cells.slice(spec.header ? 1 : 0).map((r) => r[i])) !== 'text') && (
          <button
            type="button"
            className="tblpanel-link"
            onClick={() => {
              let s = spec;
              spec.columns.forEach((c, i) => {
                if (c.type !== 'text') return;
                const t = M.inferType(spec.cells.slice(spec.header ? 1 : 0).map((r) => r[i]));
                if (t !== 'text') s = M.setColumnType(s, i, t);
              });
              apply(s);
            }}
          >
            Detect types from the data
          </button>
        )}
        {spec.columns.some((c) => c.type === 'currency') && (
          <Row label="Currency" htmlFor={`tbl-currency-${node.id}`}>
            <input
              id={`tbl-currency-${node.id}`}
              className="tblpanel-input"
              placeholder="$"
              maxLength={3}
              value={spec.currency ?? ''}
              onChange={(e) => patch({ currency: e.target.value || undefined })}
            />
          </Row>
        )}
      </Section>

      <Section
        id="table-view"
        title="Sort and filter"
        subject="table"
        meta={spec.sort || M.filtersActive(spec) ? 'on' : undefined}
      >
        <Row label="Sort by">
          <Select
            label="Sort by column"
            value={spec.sort ? String(spec.sort.col) : ''}
            options={[{ value: '', label: 'As entered' }, ...columnOptions]}
            onChange={(v) => patch({ sort: v === '' ? undefined : { col: Number(v), dir: spec.sort?.dir ?? 'asc' } })}
          />
        </Row>
        {spec.sort && (
          <FullRow label="Sort direction">
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
          </FullRow>
        )}
        {filters.map((f) => (
          <div key={f.col} className="tblpanel-filter">
            <button
              type="button"
              className="tblpanel-filter__body"
              onClick={(e) => setFilterFor({ col: f.col, anchor: { kind: 'rect', rect: e.currentTarget.getBoundingClientRect(), prefer: 'below', align: 'end' } })}
            >
              <Funnel size={13} aria-hidden="true" />
              <span className="tblpanel-filter__col">{columnName(spec, f.col)}</span>
              <span className="tblpanel-filter__what">{describeFilter(f.col)}</span>
            </button>
            <button type="button" className="pg-icon-btn" aria-label={`Remove the filter on ${columnName(spec, f.col)}`} onClick={() => apply(M.setFilter(spec, f.col, null))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <Row label="Filter">
          <Select
            label="Add a filter on a column"
            value=""
            options={[
              { value: '', label: filters.length ? 'Add another…' : 'Choose a column…' },
              ...columnOptions.filter((o) => !filterOn(spec, Number(o.value))),
            ]}
            onChange={(v) => {
              if (v === '') return;
              // Armed and empty: it shows every row until something is picked or typed.
              apply(M.setFilter(spec, Number(v), { query: '' }));
            }}
          />
        </Row>
        {ownView ? (
          <Note>
            Your view — only you see this order and filter.{' '}
            <button type="button" className="tblpanel-link tblpanel-link--inline" onClick={() => saveDefaultView(live())}>
              Save as default view
            </button>{' '}
            <button type="button" className="tblpanel-link tblpanel-link--inline" onClick={() => resetView(node.id)}>
              Back to the default
            </button>
          </Note>
        ) : (
          (spec.sort || M.filtersActive(spec)) && (
            <Note>
              The default view: the stored rows are untouched.{' '}
              <button type="button" className="tblpanel-link tblpanel-link--inline" onClick={() => apply(M.applyView(liveSpec()))}>
                Keep this order
              </button>
            </Note>
          )
        )}
      </Section>

      <Section
        id="table-format"
        title="Conditional colour"
        subject="table"
        empty={formattingCount === 0}
        meta={formattingCount || undefined}
        addLabel="Add conditional colour"
        addMenu={[
          { kind: 'item', id: 'rule', label: 'Highlight values that match', detail: 'Done, >100, <0 — cells or whole rows', onSelect: addRule },
          { kind: 'item', id: 'scale', label: 'Colour scale', detail: 'Low to high on a ramp', onSelect: addScale },
          { kind: 'item', id: 'bar', label: 'Data bars', detail: 'A bar inside each cell, to the largest', onSelect: addBar },
        ]}
      >
        {(spec.rules ?? []).map((rule, i) => (
          <div className="tblrule" key={`r${i}`}>
            <div className="tblrule__top">
              <Select label="Column the rule reads" value={String(rule.col)} options={columnOptions} onChange={(v) => setRule(i, { col: Number(v) })} />
              <IconToggle label="Remove this rule" pressed={false} onClick={() => patch({ rules: spec.rules?.filter((_, j) => j !== i) })}>
                <X size={13} />
              </IconToggle>
            </div>
            <input
              className="tblpanel-input tblpanel-input--mono"
              aria-label="When the value is"
              placeholder="Done, >100, <0"
              value={rule.when}
              onChange={(e) => setRule(i, { when: e.target.value })}
            />
            <div className="tblrule__foot">
              <div className="tblrule__paints" role="radiogroup" aria-label="Colour">
                {RULE_PAINTS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    role="radio"
                    aria-checked={rule.fill === p.fill && rule.color === p.color}
                    aria-label={p.label}
                    data-tooltip={p.label}
                    className="tblrule__paint"
                    style={{ background: p.fill ?? '#FFFFFF', color: p.color }}
                    onClick={() => setRule(i, { fill: p.fill, color: p.color })}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>
            <Row label="Whole row" hint="Paint the whole row the value is on, not only the cell">
              <Switch checked={Boolean(rule.wholeRow)} onChange={(on) => setRule(i, { wholeRow: on || undefined })} />
            </Row>
          </div>
        ))}
        {(spec.scales ?? []).map((s, i) => {
          const preset = SCALES.find((p) => p.from === s.from && p.to === s.to && p.mid === s.mid)?.id ?? 'green';
          return (
            <div className="tblrule" key={`s${i}`}>
              <div className="tblrule__top">
                <span className="tblrule__kind">Scale</span>
                <Select
                  label="Column the scale colours"
                  value={String(s.col)}
                  options={columnOptions}
                  onChange={(v) => patch({ scales: spec.scales!.map((x, j) => (j === i ? { ...x, col: Number(v) } : x)) })}
                />
                <IconToggle label="Remove this scale" pressed={false} onClick={() => patch({ scales: spec.scales?.filter((_, j) => j !== i) })}>
                  <X size={13} />
                </IconToggle>
              </div>
              <SpecimenPicker
                label="Ramp"
                value={preset}
                size={32}
                onChange={(id) => {
                  const p = SCALES.find((x) => x.id === id)!;
                  patch({ scales: spec.scales!.map((x, j) => (j === i ? { col: x.col, from: p.from, to: p.to, ...(p.mid ? { mid: p.mid } : null) } : x)) });
                }}
                options={SCALES.map((p) => ({
                  value: p.id,
                  label: p.label,
                  render: () => (
                    <span
                      className="tblrule__ramp"
                      style={{ background: `linear-gradient(90deg, ${p.from}, ${p.mid ? `${p.mid}, ` : ''}${p.to})` }}
                    />
                  ),
                }))}
              />
            </div>
          );
        })}
        {(spec.bars ?? []).map((b, i) => (
          <div className="tblrule" key={`b${i}`}>
            <div className="tblrule__top">
              <span className="tblrule__kind">Bars</span>
              <Select
                label="Column the bars measure"
                value={String(b.col)}
                options={columnOptions}
                onChange={(v) => patch({ bars: spec.bars!.map((x, j) => (j === i ? { ...x, col: Number(v) } : x)) })}
              />
              <IconToggle label="Remove these bars" pressed={false} onClick={() => patch({ bars: spec.bars?.filter((_, j) => j !== i) })}>
                <X size={13} />
              </IconToggle>
            </div>
            <Row label="Colour">
              <ColorChip label="Bar colour" value={b.color} allowNone={false} onChange={(color) => patch({ bars: spec.bars!.map((x, j) => (j === i ? { ...x, color } : x)) })} />
            </Row>
          </div>
        ))}
        {formattingCount > 0 && <Note>Colours follow every edit and formula result. The first matching rule wins.</Note>}
      </Section>

      {menu && (
        <Menu
          entries={columnMenuEntries({
            spec,
            col: menu.col,
            apply,
            fit: () => fitTableColumns(node, [menu.col]),
            filterPanel: (close) => <FilterPanel spec={spec} col={menu.col} apply={apply} close={close} />,
          })}
          label={`Column ${columnLetter(menu.col)}`}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
      {filterFor && (
        <Menu
          entries={
            [
              {
                kind: 'submenu',
                id: 'filter',
                label: `Filter ${columnName(spec, filterFor.col)}`,
                icon: <Funnel size={15} />,
                panel: (close: () => void) => <FilterPanel spec={spec} col={filterFor.col} apply={apply} close={close} />,
              },
            ] as MenuEntry[]
          }
          label="Filter"
          anchor={filterFor.anchor}
          focusFirst
          onClose={() => setFilterFor(null)}
        />
      )}
    </>
  );
};

/** A tiny table in each theme, so the choice is made by looking. */
const ThemeSpecimen: React.FC<{ theme: TableTheme; accent: string; size: number }> = ({ theme, accent, size }) => {
  const head =
    theme === 'bold' ? accent : theme === 'striped' ? `${accent}33` : theme === 'minimal' ? 'transparent' : '#EEF2F6';
  const zebra = theme === 'striped' || theme === 'bold' ? (theme === 'bold' ? `${accent}14` : '#F1F5F9') : 'transparent';
  const rule = theme === 'grid' ? '#94A3B8' : '#CBD5E1';
  return (
    <svg viewBox="0 0 60 36" width={size - 8} height={(size - 8) * 0.6} aria-hidden="true">
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
