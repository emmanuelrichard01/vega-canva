import React from 'react';
import {
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  ArrowUpToLine,
  ChartColumn,
  Eraser,
  Snowflake,
  TableCellsMerge,
  TableCellsSplit,
  TextWrap,
  Trash2,
  UnfoldHorizontal,
  UnfoldVertical,
} from 'lucide-react';
import * as M from '../../engine/table/tableModel';
import type { TableSpec } from '../../engine/table/tableTypes';
import { columnLetter } from '../sheet/useSheet';
import { MenuItem, Sep } from './tableControls';

export interface MenuState {
  kind: 'col' | 'row' | 'cell';
  /** Drawn rows and columns the menu acts on. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  x: number;
  y: number;
}

export interface MenuActions {
  insertRowAbove: () => void;
  insertRowBelow: () => void;
  insertColLeft: () => void;
  insertColRight: () => void;
  fit: () => void;
  fitRows: () => void;
  sort: (dir: 'asc' | 'desc') => void;
  clear: () => void;
  merge: () => void;
  unmerge: () => void;
  deleteRows: () => void;
  deleteCols: () => void;
  fillDown: () => void;
  fillRight: () => void;
  wrap: () => void;
  chart: () => void;
  freezeHere: () => void;
}

/**
 * What a right-click offers, by where it landed.
 *
 * A number is about rows, and a cell about both — every spreadsheet's
 * arrangement; a letter opens the column menu. The heading names what the
 * menu acts on ("Rows 3–5"): a right-click inside a selection acts on the
 * selection and outside it on the one thing clicked, and that should never be
 * a surprise.
 */
export const MenuBody: React.FC<{
  menu: MenuState;
  spec: TableSpec;
  rows: number[];
  cols: number;
  identity: boolean;
  rowLabel: (vr: number) => string;
  wrapped: boolean;
  frozenRows: number;
  actions: MenuActions;
}> = ({ menu, spec, rows, cols, identity, rowLabel, wrapped, frozenRows, actions }) => {
  const nCols = menu.c1 - menu.c0 + 1;
  const nRows = menu.r1 - menu.r0 + 1;
  const headerOnly = spec.header && rows[menu.r0] === 0 && nRows === 1;
  const title =
    menu.kind === 'row'
      ? nRows > 1
        ? `Rows ${rowLabel(menu.r0)}–${rowLabel(menu.r1)}`
        : headerOnly
          ? 'Header row'
          : `Row ${rowLabel(menu.r0)}`
      : nRows * nCols > 1
        ? `${nRows} × ${nCols} cells`
        : `Cell ${columnLetter(menu.c0)}${rowLabel(menu.r0)}`;
  const aboveBlocked = spec.header && rows[menu.r0] === 0;
  const isMerged = Boolean(M.mergeAt(spec, rows[menu.r0] ?? 0, menu.c0));
  const canMerge = identity && nRows * nCols > 1;
  const sorted = spec.sort?.col === menu.c0 ? spec.sort.dir : null;

  const rowItems = (
    <>
      <MenuItem
        icon={<ArrowUpToLine size={15} />}
        label="Insert row above"
        disabled={aboveBlocked}
        hint={aboveBlocked ? 'header stays on top' : undefined}
        onClick={actions.insertRowAbove}
      />
      <MenuItem icon={<ArrowDownToLine size={15} />} label="Insert row below" onClick={actions.insertRowBelow} />
    </>
  );
  const deleteRowItem = (
    <MenuItem
      icon={<Trash2 size={15} />}
      tone="danger"
      label={nRows > 1 ? `Delete ${nRows} rows` : 'Delete row'}
      disabled={nRows >= spec.cells.length}
      onClick={actions.deleteRows}
    />
  );

  return (
    <>
      <div className="tbled-ctx__head">{title}</div>
      {menu.kind === 'row' && (
        <>
          {rowItems}
          <Sep />
          <MenuItem icon={<UnfoldVertical size={15} />} label="Fit height to text" hint="double-click edge" onClick={actions.fitRows} />
          <MenuItem
            icon={<Snowflake size={15} />}
            label={frozenRows === menu.r1 + 1 ? 'Unfreeze rows' : `Freeze up to row ${rowLabel(menu.r1)}`}
            onClick={actions.freezeHere}
          />
          <MenuItem icon={<Eraser size={15} />} label="Clear contents" onClick={actions.clear} />
          <Sep />
          {deleteRowItem}
        </>
      )}
      {menu.kind === 'cell' && (
        <>
          <MenuItem icon={<ChartColumn size={15} />} label="Chart this" onClick={actions.chart} />
          <MenuItem icon={<ArrowDownToLine size={15} />} label="Fill down" hint="Ctrl D" disabled={!identity} onClick={actions.fillDown} />
          <MenuItem icon={<ArrowRightToLine size={15} />} label="Fill right" hint="Ctrl R" disabled={!identity} onClick={actions.fillRight} />
          <MenuItem icon={<TextWrap size={15} />} label={wrapped ? 'Stop wrapping text' : 'Wrap text'} onClick={actions.wrap} />
          <Sep />
          {rowItems}
          <MenuItem icon={<ArrowLeftToLine size={15} />} label="Insert column left" onClick={actions.insertColLeft} />
          <MenuItem icon={<ArrowRightToLine size={15} />} label="Insert column right" onClick={actions.insertColRight} />
          <Sep />
          <MenuItem icon={<UnfoldHorizontal size={15} />} label={nCols > 1 ? 'Fit columns to content' : 'Fit column to content'} hint="double-click edge" onClick={actions.fit} />
          <MenuItem icon={<ArrowUpNarrowWide size={15} />} label={`Sort ${columnLetter(menu.c0)}, A → Z`} pressed={sorted === 'asc'} onClick={() => actions.sort('asc')} />
          <MenuItem icon={<ArrowDownWideNarrow size={15} />} label={`Sort ${columnLetter(menu.c0)}, Z → A`} pressed={sorted === 'desc'} onClick={() => actions.sort('desc')} />
          <Sep />
          {isMerged && !canMerge ? (
            <MenuItem icon={<TableCellsSplit size={15} />} label="Unmerge" onClick={actions.unmerge} />
          ) : (
            <MenuItem
              icon={<TableCellsMerge size={15} />}
              label="Merge cells"
              disabled={!canMerge}
              hint={!identity ? 'turn off sort and filter' : undefined}
              onClick={actions.merge}
            />
          )}
          <MenuItem icon={<Eraser size={15} />} label="Clear contents" hint="Delete" onClick={actions.clear} />
          <Sep />
          {deleteRowItem}
          <MenuItem
            icon={<Trash2 size={15} />}
            tone="danger"
            label={nCols > 1 ? `Delete ${nCols} columns` : 'Delete column'}
            disabled={nCols >= cols}
            onClick={actions.deleteCols}
          />
        </>
      )}
    </>
  );
};
