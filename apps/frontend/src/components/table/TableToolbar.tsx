import React from 'react';
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ChartColumn,
  Check,
  ChevronDown,
  Columns3,
  Eraser,
  Eye,
  Funnel,
  Italic,
  PaintBucket,
  PanelBottom,
  Rows3,
  Save,
  Sigma,
  Snowflake,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  TextWrap,
  UnfoldHorizontal,
  Undo2,
} from 'lucide-react';
import { FORMULA_FUNCTIONS } from '../../engine/table/tableFormula';
import { CELL_TYPES, CELL_TYPE_LABELS, filterOn, type CellAlign, type CellStyle, type CellType, type CellVAlign, type TableSpec } from '../../engine/table/tableTypes';
import { ColorPickerPopover } from '../ui/ColorPickerPopover';
import { columnLetter } from '../sheet/useSheet';
import { TYPE_ICONS } from './columnMenu';
import { FilterPanel } from './FilterPanel';
import { MenuItem, Sep, Tool } from './tableControls';
import { colourName, FILLS, INKS } from './tableColours';
import { useKeepInView } from './tableEditorParts';

export type Pop = 'fill' | 'ink' | 'valign' | 'format' | 'fx' | 'sort' | 'filter' | 'struct' | null;

const QUICK_FUNCTIONS = ['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'];

/** What the toolbar reads and does — all of it the editor's. */
export interface ToolbarModel {
  spec: TableSpec;
  readOnly: boolean;
  pop: Pop;
  openPop: (p: Pop) => void;
  closePop: () => void;
  /** Run a command and put the keyboard back on the grid. */
  run: (fn: () => unknown) => void;
  styleAtFocus: CellStyle;
  typeAtFocus: CellType;
  focus: { r: number; c: number };
  cols: { c0: number; c1: number };
  multi: boolean;
  identity: boolean;
  canMerge: boolean;
  merged: boolean;
  frozenRows: number;
  hasSummary: boolean;
  ownView: boolean;
  status: string;
  toggleStyle: (key: 'bold' | 'italic' | 'wrap') => void;
  style: (patch: CellStyle) => void;
  align: (a: CellAlign) => void;
  valign: (v: CellVAlign) => void;
  setType: (t: CellType) => void;
  autoFunction: (name: string) => void;
  writeFormula: (text: string, caretFromEnd?: number) => void;
  sortCol: (c: number, dir: 'asc' | 'desc' | null) => void;
  keepOrder: () => void;
  applySpec: (next: TableSpec) => void;
  chart: () => void;
  merge: () => void;
  unmerge: () => void;
  insertRowAt: (stored: number) => void;
  insertColAt: (c: number) => void;
  freezeRows: (n: number) => void;
  toggleSummary: () => void;
  deleteRows: () => void;
  deleteCols: () => void;
  fitAll: () => void;
  saveDefaultView: () => void;
  resetView: () => void;
  done: () => void;
}

/** A popover from a toolbar button, kept on screen — flipped above, or clamped and scrolled. */
const PopMenu: React.FC<{ className: string; role?: string; label?: string; children: React.ReactNode }> = ({ className, role, label, children }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  useKeepInView(ref, true);
  return (
    <div ref={ref} className={`tbled-menu ${className}`} role={role} aria-label={label}>
      {children}
    </div>
  );
};

/** The view's own controls, at the foot of the sort and filter menus: keep it for everyone, or let it go. */
const ViewFoot: React.FC<{ m: ToolbarModel }> = ({ m }) =>
  m.ownView ? (
    <>
      <Sep />
      <div className="tbled-menu__label">Your view — only you see this order and filter</div>
      {!m.readOnly && <MenuItem icon={<Save size={15} />} label="Save as default view" hint="for everyone" onClick={() => m.run(m.saveDefaultView)} />}
      <MenuItem icon={<Undo2 size={15} />} label="Back to the default view" onClick={() => m.run(m.resetView)} />
    </>
  ) : null;

/**
 * The table editor's toolbar: text, alignment, data and structure, then the
 * view's status and Done. A person who may only read the table gets the view
 * controls — their own sort and filter, which write nothing — and a plain
 * "View only".
 */
export const TableToolbar: React.FC<{ m: ToolbarModel }> = ({ m }) => {
  const { spec, styleAtFocus, typeAtFocus, pop } = m;
  const filtered = Boolean(filterOn(spec, m.focus.c));

  const sortTool = (
    <div className="tbled-bar__pop">
      <Tool label={spec.sort ? `Sorted by ${columnLetter(spec.sort.col)}` : 'Sort'} pressed={pop === 'sort' || Boolean(spec.sort)} onClick={() => m.openPop('sort')}>
        {spec.sort?.dir === 'desc' ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
      </Tool>
      {pop === 'sort' && (
        <PopMenu className="tbled-menu--list" role="menu">
          <div className="tbled-menu__label">Column {columnLetter(m.focus.c)}</div>
          <MenuItem
            icon={<ArrowUpNarrowWide size={15} />}
            label="A → Z, smallest first"
            pressed={spec.sort?.col === m.focus.c && spec.sort.dir === 'asc'}
            onClick={() => m.run(() => m.sortCol(m.focus.c, 'asc'))}
          />
          <MenuItem
            icon={<ArrowDownWideNarrow size={15} />}
            label="Z → A, largest first"
            pressed={spec.sort?.col === m.focus.c && spec.sort.dir === 'desc'}
            onClick={() => m.run(() => m.sortCol(m.focus.c, 'desc'))}
          />
          {spec.sort && (
            <>
              <Sep />
              <MenuItem icon={<Eraser size={15} />} label="Back to the order as entered" onClick={() => m.run(() => m.sortCol(m.focus.c, null))} />
              {!m.readOnly && <MenuItem icon={<Check size={15} />} label="Keep this order" hint="writes it in" onClick={() => m.run(m.keepOrder)} />}
            </>
          )}
          <ViewFoot m={m} />
        </PopMenu>
      )}
    </div>
  );

  const filterTool = (
    <div className="tbled-bar__pop">
      <Tool label={filtered ? 'Filtered — filter this column' : 'Filter this column'} pressed={pop === 'filter' || filtered} onClick={() => m.openPop('filter')}>
        <Funnel size={15} />
      </Tool>
      {pop === 'filter' && (
        <PopMenu className="tbled-menu--panel">
          <FilterPanel spec={spec} col={m.focus.c} apply={m.applySpec} close={m.closePop} />
          {m.ownView && (
            <div className="tbled-menu__foot">
              {!m.readOnly && (
                <button type="button" className="tbled-menu__action" onClick={() => m.run(m.saveDefaultView)}>
                  <Save size={13} aria-hidden="true" /> Save as default view
                </button>
              )}
              <button type="button" className="tbled-menu__action" onClick={() => m.run(m.resetView)}>
                <Undo2 size={13} aria-hidden="true" /> Default view
              </button>
            </div>
          )}
        </PopMenu>
      )}
    </div>
  );

  const end = (
    <>
      <span className="tbled-bar__spacer" />
      <span className="tbled-bar__meta" role="status" aria-live="polite">
        {m.status}
      </span>
      <button type="button" className="tbled-bar__done" onClick={m.done}>
        <Check size={14} /> Done
      </button>
    </>
  );

  if (m.readOnly) {
    return (
      <div className="tbled-bar__row">
        <span className="tbled-bar__viewonly">
          <Eye size={14} aria-hidden="true" />
          View only
        </span>
        <span className="tbled-bar__sep" />
        <div className="tbled-bar__group" role="group" aria-label="Your view">
          {sortTool}
          {filterTool}
        </div>
        {end}
      </div>
    );
  }

  return (
    <div className="tbled-bar__row">
      {/* Type: how the text looks. */}
      <div className="tbled-bar__group" role="group" aria-label="Text">
        <Tool label="Bold" shortcut="Ctrl B" pressed={Boolean(styleAtFocus.bold)} onClick={() => m.toggleStyle('bold')}>
          <Bold size={15} />
        </Tool>
        <Tool label="Italic" shortcut="Ctrl I" pressed={Boolean(styleAtFocus.italic)} onClick={() => m.toggleStyle('italic')}>
          <Italic size={15} />
        </Tool>
        <div className="tbled-bar__pop">
          <Tool label={`Text colour · ${colourName(INKS, styleAtFocus.color) ?? 'Automatic'}`} pressed={pop === 'ink'} onClick={() => m.openPop('ink')}>
            <Baseline size={15} />
            <span className="tbled-bar__chip" style={{ background: styleAtFocus.color ?? 'var(--tbl-ink)' }} />
          </Tool>
          {pop === 'ink' && (
            <PopMenu className="tbled-menu--swatches" role="group" label="Text colour">
              <button
                type="button"
                className="tbled-swatch tbled-swatch--none"
                aria-label="Automatic text colour"
                data-tooltip="Automatic"
                onClick={() => m.run(() => m.style({ color: undefined }))}
              />
              {INKS.map((ink) => (
                <button
                  key={ink.hex}
                  type="button"
                  className="tbled-swatch tbled-swatch--ink"
                  style={{ color: ink.hex }}
                  aria-label={`Text ${ink.name}`}
                  data-tooltip={ink.name}
                  aria-pressed={styleAtFocus.color === ink.hex}
                  onClick={() => m.run(() => m.style({ color: ink.hex }))}
                >
                  A
                </button>
              ))}
              <div className="tbled-menu__custom">
                <ColorPickerPopover
                  label="Custom"
                  allowNone={false}
                  color={styleAtFocus.color ?? '#0F172A'}
                  onChange={(color) => m.style({ color })}
                  contrastAgainst={styleAtFocus.fill ?? '#FFFFFF'}
                />
              </div>
            </PopMenu>
          )}
        </div>
        <div className="tbled-bar__pop">
          <Tool label={`Cell fill · ${colourName(FILLS, styleAtFocus.fill) ?? 'None'}`} pressed={pop === 'fill'} onClick={() => m.openPop('fill')}>
            <PaintBucket size={15} />
            <span className="tbled-bar__chip" style={{ background: styleAtFocus.fill ?? 'transparent' }} />
          </Tool>
          {pop === 'fill' && (
            <PopMenu className="tbled-menu--swatches" role="group" label="Cell fill">
              <button type="button" className="tbled-swatch tbled-swatch--none" aria-label="No fill" data-tooltip="No fill" onClick={() => m.run(() => m.style({ fill: undefined }))} />
              {FILLS.map((f) => (
                <button
                  key={f.hex}
                  type="button"
                  className="tbled-swatch"
                  style={{ background: f.hex }}
                  aria-label={`Fill ${f.name}`}
                  data-tooltip={f.name}
                  aria-pressed={styleAtFocus.fill === f.hex}
                  onClick={() => m.run(() => m.style({ fill: f.hex }))}
                />
              ))}
              <div className="tbled-menu__custom">
                <ColorPickerPopover label="Custom" color={styleAtFocus.fill ?? '#FFFFFF'} onChange={(fill) => m.style({ fill: fill === 'transparent' ? undefined : fill })} />
              </div>
            </PopMenu>
          )}
        </div>
        <Tool label="Wrap text" pressed={Boolean(styleAtFocus.wrap)} onClick={() => m.toggleStyle('wrap')}>
          <TextWrap size={15} />
        </Tool>
      </div>
      <span className="tbled-bar__sep" />
      {/* Align: where the text sits. */}
      <div className="tbled-bar__group" role="group" aria-label="Alignment">
        <Tool label="Align left" pressed={styleAtFocus.align === 'left'} onClick={() => m.align('left')}>
          <TextAlignStart size={15} />
        </Tool>
        <Tool label="Align centre" pressed={styleAtFocus.align === 'center'} onClick={() => m.align('center')}>
          <TextAlignCenter size={15} />
        </Tool>
        <Tool label="Align right" pressed={styleAtFocus.align === 'right'} onClick={() => m.align('right')}>
          <TextAlignEnd size={15} />
        </Tool>
        <div className="tbled-bar__pop">
          <Tool label="Vertical alignment" pressed={pop === 'valign'} onClick={() => m.openPop('valign')}>
            {styleAtFocus.valign === 'top' ? (
              <AlignVerticalJustifyStart size={15} />
            ) : styleAtFocus.valign === 'bottom' ? (
              <AlignVerticalJustifyEnd size={15} />
            ) : (
              <AlignVerticalJustifyCenter size={15} />
            )}
          </Tool>
          {pop === 'valign' && (
            <PopMenu className="tbled-menu--list" role="menu">
              <MenuItem icon={<AlignVerticalJustifyStart size={15} />} label="Top" pressed={styleAtFocus.valign === 'top'} onClick={() => m.run(() => m.valign('top'))} />
              <MenuItem icon={<AlignVerticalJustifyCenter size={15} />} label="Middle" pressed={!styleAtFocus.valign} onClick={() => m.run(() => m.valign('middle'))} />
              <MenuItem icon={<AlignVerticalJustifyEnd size={15} />} label="Bottom" pressed={styleAtFocus.valign === 'bottom'} onClick={() => m.run(() => m.valign('bottom'))} />
            </PopMenu>
          )}
        </div>
      </div>
      <span className="tbled-bar__sep" />
      {/* Data: what the values are and which rows show. */}
      <div className="tbled-bar__group" role="group" aria-label="Data">
        <div className="tbled-bar__pop">
          <Tool label={`Column type · ${CELL_TYPE_LABELS[typeAtFocus]}`} pressed={pop === 'format'} onClick={() => m.openPop('format')}>
            {TYPE_ICONS[typeAtFocus]}
            <ChevronDown size={12} className="tbled-tool__caret" />
          </Tool>
          {pop === 'format' && (
            <PopMenu className="tbled-menu--list" role="menu">
              <div className="tbled-menu__label">
                {m.cols.c1 > m.cols.c0 ? `Columns ${columnLetter(m.cols.c0)}–${columnLetter(m.cols.c1)}` : `Column ${columnLetter(m.cols.c0)}`}
              </div>
              {CELL_TYPES.map((t) => (
                <MenuItem
                  key={t}
                  icon={TYPE_ICONS[t]}
                  label={CELL_TYPE_LABELS[t]}
                  pressed={typeAtFocus === t}
                  hint={typeAtFocus === t ? '✓' : undefined}
                  onClick={() => m.run(() => m.setType(t))}
                />
              ))}
            </PopMenu>
          )}
        </div>
        <div className="tbled-bar__pop">
          <Tool label="Functions" pressed={pop === 'fx'} onClick={() => m.openPop('fx')}>
            <Sigma size={15} />
          </Tool>
          {pop === 'fx' && (
            <PopMenu className="tbled-menu--list tbled-menu--fx" role="menu">
              <div className="tbled-menu__label">Quick — reads the numbers above</div>
              {QUICK_FUNCTIONS.map((name) => (
                <MenuItem
                  key={name}
                  icon={<Sigma size={14} />}
                  label={name[0] + name.slice(1).toLowerCase()}
                  hint={name}
                  onClick={() => {
                    m.closePop();
                    m.autoFunction(name);
                  }}
                />
              ))}
              <span className="tbled-ctx__sep" role="separator" />
              <div className="tbled-menu__label">All functions</div>
              {FORMULA_FUNCTIONS.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  role="menuitem"
                  className="tbled-fx__opt"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    m.closePop();
                    m.writeFormula(`=${f.name}()`, 1);
                  }}
                >
                  <span className="tbled-fx__name">{f.name}</span>
                  <span className="tbled-fx__optdoc">{f.doc}</span>
                </button>
              ))}
            </PopMenu>
          )}
        </div>
        {sortTool}
        {filterTool}
        <Tool label="Chart this selection" onClick={m.chart}>
          <ChartColumn size={15} />
        </Tool>
      </div>
      <span className="tbled-bar__sep" />
      {/* Structure: cells, rows and columns. */}
      <div className="tbled-bar__group" role="group" aria-label="Structure">
        {m.merged && !m.canMerge ? (
          <Tool label="Unmerge" onClick={m.unmerge}>
            <TableCellsSplit size={15} />
          </Tool>
        ) : (
          <Tool label={m.identity ? 'Merge cells' : 'Merging needs the unsorted, unfiltered table'} disabled={!m.canMerge} onClick={m.merge}>
            <TableCellsMerge size={15} />
          </Tool>
        )}
        <div className="tbled-bar__pop">
          <Tool label="Rows and columns" pressed={pop === 'struct'} onClick={() => m.openPop('struct')}>
            <Rows3 size={15} />
          </Tool>
          {pop === 'struct' && (
            <PopMenu className="tbled-menu--list" role="menu">
              <MenuItem icon={<BetweenHorizontalStart size={15} />} label="Row above" disabled={spec.header && m.focus.r === 0} onClick={() => m.run(() => m.insertRowAt(m.focus.r))} />
              <MenuItem icon={<BetweenHorizontalEnd size={15} />} label="Row below" onClick={() => m.run(() => m.insertRowAt(m.focus.r + 1))} />
              <MenuItem icon={<BetweenVerticalStart size={15} />} label="Column left" onClick={() => m.run(() => m.insertColAt(m.focus.c))} />
              <MenuItem icon={<BetweenVerticalEnd size={15} />} label="Column right" onClick={() => m.run(() => m.insertColAt(m.focus.c + 1))} />
              <Sep />
              <MenuItem
                icon={<Snowflake size={15} />}
                label={m.frozenRows > 0 ? 'Unfreeze rows' : spec.header ? 'Freeze the header row' : 'Freeze the first row'}
                onClick={() => m.run(() => m.freezeRows(m.frozenRows > 0 ? 0 : 1))}
              />
              <MenuItem icon={<PanelBottom size={15} />} label={m.hasSummary ? 'Hide the summary row' : 'Show a summary row'} onClick={() => m.run(m.toggleSummary)} />
              <Sep />
              <MenuItem icon={<Rows3 size={15} />} tone="danger" label={m.multi ? 'Delete selected rows' : 'Delete row'} onClick={() => m.run(m.deleteRows)} />
              <MenuItem icon={<Columns3 size={15} />} tone="danger" label={m.multi ? 'Delete selected columns' : 'Delete column'} onClick={() => m.run(m.deleteCols)} />
            </PopMenu>
          )}
        </div>
        <Tool label="Fit columns to content" onClick={m.fitAll}>
          <UnfoldHorizontal size={15} />
        </Tool>
      </div>
      {end}
    </div>
  );
};
