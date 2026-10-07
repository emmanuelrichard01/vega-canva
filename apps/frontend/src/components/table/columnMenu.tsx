import React from 'react';
import {
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  Calendar,
  Check,
  CircleUser,
  Copy,
  DollarSign,
  EyeOff,
  Funnel,
  FunnelX,
  Hash,
  Link,
  PanelBottom,
  Percent,
  Snowflake,
  SquareCheck,
  SquareChevronDown,
  Star,
  Trash2,
  Type,
  UnfoldHorizontal,
} from 'lucide-react';
import type { MenuEntry } from '../menu/menuModel';
import * as M from '../../engine/table/tableModel';
import { columnLetter } from '../sheet/useSheet';
import {
  CELL_TYPES,
  CELL_TYPE_LABELS,
  filterOn,
  isNumericType,
  SUMMARY_LABELS,
  type CellType,
  type SummaryAgg,
  type TableSpec,
} from '../../engine/table/tableTypes';

/**
 * The column menu: one place for everything about a column.
 *
 * Its type, its sort, its filter, its summary and its structure — reached
 * from the caret on the column's letter in the editor, from the panel's
 * column rows, and from Alt+↓ on a focused cell. Airtable and Notion put these
 * on the column header, which is where people look, and every surface here
 * opens this same list rather than keeping a copy of its own.
 */

const I = 15;

/** The mark a pick-one row wears when it is the current choice; `checked` is for toggles. */
const current = (on: boolean) => (on ? { trailing: <Check size={14} aria-label="Current" /> } : null);

export const TYPE_ICONS: Record<CellType, React.ReactNode> = {
  text: <Type size={I} />,
  number: <Hash size={I} />,
  currency: <DollarSign size={I} />,
  percent: <Percent size={I} />,
  date: <Calendar size={I} />,
  checkbox: <SquareCheck size={I} />,
  select: <SquareChevronDown size={I} />,
  url: <Link size={I} />,
  rating: <Star size={I} />,
  person: <CircleUser size={I} />,
};

const TYPE_DETAIL: Record<CellType, string> = {
  text: 'Words, as typed',
  number: '1,234.5',
  currency: '$1,234.50',
  percent: '12.5%',
  date: 'Mar 6, 2026',
  checkbox: 'Ticked or not',
  select: 'Choices with colours',
  url: 'A web address',
  rating: 'One to five stars',
  person: 'Someone in the room, or a name',
};

export interface ColumnMenuContext {
  spec: TableSpec;
  col: number;
  /** Write a new spec — one undo step. */
  apply: (next: TableSpec) => void;
  /** Size the column to its content (needs the node, so the caller does it). */
  fit?: () => void;
  /** Where filtering happens: a panel of its own, given the column. */
  filterPanel: (close: () => void) => React.ReactNode;
  /**
   * Sort and filter only — the person's own view, which writes nothing — for
   * somebody who may read the table but not change it.
   */
  readOnly?: boolean;
}

/** A column's name for a menu: its heading, or its letter. */
export function columnName(spec: TableSpec, c: number): string {
  const head = spec.header ? spec.cells[0]?.[c]?.trim() : '';
  return head || `Column ${columnLetter(c)}`;
}

export function columnMenuEntries({ spec, col, apply, fit, filterPanel, readOnly }: ColumnMenuContext): MenuEntry[] {
  const column = spec.columns[col];
  const type = column?.type ?? 'text';
  const sorted = spec.sort?.col === col ? spec.sort.dir : null;
  const filter = filterOn(spec, col);
  const filtered = Boolean(filter && (filter.values || filter.query.trim()));
  const frozenCols = spec.frozen?.cols ?? 0;
  const agg = spec.summary?.[col] ?? null;
  const shownCols = spec.columns.filter((c) => !c.hidden).length;
  const numericSort = isNumericType(type) || type === 'date';

  const typeEntries: MenuEntry[] = [
    ...CELL_TYPES.map(
      (t): MenuEntry => ({
        kind: 'item',
        id: `type-${t}`,
        label: CELL_TYPE_LABELS[t],
        icon: TYPE_ICONS[t],
        detail: TYPE_DETAIL[t],
        ...current(type === t),
        onSelect: () => apply(M.setColumnType(spec, col, t)),
      })
    ),
    ...(type === 'select'
      ? [
          { kind: 'separator', id: 'type-sep' } as MenuEntry,
          {
            kind: 'item',
            id: 'type-multi',
            label: 'Several choices per cell',
            checked: Boolean(column.multi),
            keepOpen: true,
            onSelect: () => apply(M.setColumn(spec, col, { multi: column.multi ? undefined : true })),
          } as MenuEntry,
        ]
      : []),
  ];

  const summaryEntries: MenuEntry[] = [
    {
      kind: 'item',
      id: 'sum-none',
      label: 'None',
      ...current(agg === null),
      onSelect: () => apply(setSummary(spec, col, null)),
    },
    ...M.summaryChoices(type).map(
      (a): MenuEntry => ({
        kind: 'item',
        id: `sum-${a}`,
        label: SUMMARY_LABELS[a],
        ...current(agg === a),
        onSelect: () => apply(setSummary(spec, col, a)),
      })
    ),
  ];

  const viewEntries: MenuEntry[] = [
    {
      kind: 'item',
      id: 'sort-asc',
      label: numericSort ? 'Sort smallest first' : 'Sort A → Z',
      icon: <ArrowUpNarrowWide size={I} />,
      ...current(sorted === 'asc'),
      onSelect: () => apply({ ...spec, sort: sorted === 'asc' ? undefined : { col, dir: 'asc' } }),
    },
    {
      kind: 'item',
      id: 'sort-desc',
      label: numericSort ? 'Sort largest first' : 'Sort Z → A',
      icon: <ArrowDownWideNarrow size={I} />,
      ...current(sorted === 'desc'),
      onSelect: () => apply({ ...spec, sort: sorted === 'desc' ? undefined : { col, dir: 'desc' } }),
    },
    { kind: 'submenu', id: 'filter', label: filtered ? 'Filter · on' : 'Filter by this column…', icon: <Funnel size={I} />, panel: filterPanel },
    ...(filtered
      ? [
          {
            kind: 'item',
            id: 'filter-clear',
            label: 'Clear filter',
            icon: <FunnelX size={I} />,
            onSelect: () => apply(M.setFilter(spec, col, null)),
          } as MenuEntry,
        ]
      : []),
  ];
  if (readOnly) return [{ kind: 'heading', id: 'head', label: columnName(spec, col) }, ...viewEntries];

  return [
    { kind: 'heading', id: 'head', label: columnName(spec, col) },
    { kind: 'submenu', id: 'type', label: `Type · ${CELL_TYPE_LABELS[type]}`, icon: TYPE_ICONS[type], entries: typeEntries },
    {
      kind: 'item',
      id: 'sort-asc',
      label: numericSort ? 'Sort smallest first' : 'Sort A → Z',
      icon: <ArrowUpNarrowWide size={I} />,
      ...current(sorted === 'asc'),
      onSelect: () => apply({ ...spec, sort: sorted === 'asc' ? undefined : { col, dir: 'asc' } }),
    },
    {
      kind: 'item',
      id: 'sort-desc',
      label: numericSort ? 'Sort largest first' : 'Sort Z → A',
      icon: <ArrowDownWideNarrow size={I} />,
      ...current(sorted === 'desc'),
      onSelect: () => apply({ ...spec, sort: sorted === 'desc' ? undefined : { col, dir: 'desc' } }),
    },
    { kind: 'submenu', id: 'filter', label: filtered ? 'Filter · on' : 'Filter by this column…', icon: <Funnel size={I} />, panel: filterPanel },
    ...(filtered
      ? [
          {
            kind: 'item',
            id: 'filter-clear',
            label: 'Clear filter',
            icon: <FunnelX size={I} />,
            onSelect: () => apply(M.setFilter(spec, col, null)),
          } as MenuEntry,
        ]
      : []),
    { kind: 'submenu', id: 'summary', label: agg ? `Summary · ${SUMMARY_LABELS[agg]}` : 'Summary', icon: <PanelBottom size={I} />, entries: summaryEntries },
    { kind: 'separator', id: 's1' },
    {
      kind: 'item',
      id: 'insert-left',
      label: 'Insert column left',
      icon: <ArrowLeftToLine size={I} />,
      onSelect: () => apply(M.insertCols(spec, col, 1)),
    },
    {
      kind: 'item',
      id: 'insert-right',
      label: 'Insert column right',
      icon: <ArrowRightToLine size={I} />,
      onSelect: () => apply(M.insertCols(spec, col + 1, 1)),
    },
    {
      kind: 'item',
      id: 'duplicate',
      label: 'Duplicate column',
      icon: <Copy size={I} />,
      onSelect: () => apply(M.duplicateCol(spec, col)),
    },
    { kind: 'separator', id: 's2' },
    {
      kind: 'item',
      id: 'hide',
      label: 'Hide column',
      icon: <EyeOff size={I} />,
      disabled: shownCols <= 1,
      disabledReason: 'A table shows at least one column',
      detail: 'Kept in the data; show it again from the letters',
      onSelect: () => apply(M.setHidden(spec, col, true)),
    },
    {
      kind: 'item',
      id: 'freeze',
      label: frozenCols === col + 1 ? 'Unfreeze columns' : col === 0 ? 'Freeze first column' : `Freeze up to ${columnLetter(col)}`,
      icon: <Snowflake size={I} />,
      detail: 'Stays on screen as the board pans while editing',
      onSelect: () =>
        apply({
          ...spec,
          frozen: frozenCols === col + 1 ? (spec.frozen?.rows ? { rows: spec.frozen.rows, cols: 0 } : undefined) : { rows: spec.frozen?.rows ?? 0, cols: col + 1 },
        }),
    },
    ...(fit ? [{ kind: 'item', id: 'fit', label: 'Fit width to content', icon: <UnfoldHorizontal size={I} />, onSelect: fit } as MenuEntry] : []),
    { kind: 'separator', id: 's3' },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete column',
      icon: <Trash2 size={I} />,
      danger: true,
      disabled: spec.columns.length <= 1,
      disabledReason: 'A table keeps at least one column',
      onSelect: () => apply(M.deleteCols(spec, col, 1)),
    },
  ];
}

/** A column's summary set, the footer appearing with the first and leaving with the last. */
export function setSummary(spec: TableSpec, col: number, agg: SummaryAgg | null): TableSpec {
  const summary = Array.from({ length: spec.columns.length }, (_, c) => (c === col ? agg : spec.summary?.[c] ?? null));
  return { ...spec, summary: summary.some((s) => s !== null) ? summary : undefined };
}
