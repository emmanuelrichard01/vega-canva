import React from 'react';
import { ArrowDownAZ, ArrowUpAZ, ArrowDownUp, BetweenHorizontalEnd, BetweenVerticalEnd, PanelTop, SquarePen } from 'lucide-react';
import { updateTable } from '../../../engine/table/tableApply';
import { colCount, insertCols, insertRows, rowCount } from '../../../engine/table/tableModel';
import {
  DEFAULT_ACCENT,
  MAX_COLS,
  MAX_ROWS,
  TABLE_THEMES,
  TABLE_THEME_LABELS,
  type TableSpec,
  type TableTheme,
} from '../../../engine/table/tableTypes';
import type { TableNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy, type RailVerb } from './anatomy';
import type { SingleRail } from './types';
import { columnLetter, columnName } from './tableNames';


/** A theme drawn as a tiny table, so the choice is made by looking. */
const ThemeTile: React.FC<{ theme: TableTheme; accent: string }> = ({ theme, accent }) => (
  <span className="rail-tbl" data-theme={theme} style={{ ['--tbl-accent' as string]: accent }} aria-hidden="true">
    {Array.from({ length: 9 }, (_, i) => (
      <i key={i} />
    ))}
  </span>
);

/**
 * A table: its theme as paint, then the four things done to a table as a
 * whole — open the cells, toggle the header, grow it, order it. Cell
 * formatting belongs to the editor's own bar, which takes over while the
 * cells are open.
 */
export const TableRail: SingleRail<TableNode> = ({ node, conditional, tail, tailControls }) => {
  const spec = node.table;
  const apply = (next: TableSpec) => updateTable(node, next);
  const accent = spec.accent ?? DEFAULT_ACCENT;
  const rows = rowCount(spec);
  const cols = colCount(spec);

  const verbs: RailVerb[] = [
    {
      id: 'edit',
      controls: 1,
      node: (
        <RailButton label="Edit cells" hint="Edit cells (Enter)" onClick={() => useStore.getState().setTableEditNodeId(node.id)}>
          <SquarePen size={16} />
        </RailButton>
      ),
    },
    {
      id: 'header',
      controls: 1,
      node: (
        <RailButton
          label="Header row"
          hint={spec.header ? 'The first row names the columns' : 'Make the first row a header'}
          pressed={spec.header}
          onClick={() => apply({ ...spec, header: !spec.header })}
        >
          <PanelTop size={16} />
        </RailButton>
      ),
    },
    {
      id: 'row',
      controls: 1,
      node: (
        <RailButton
          label="Add row"
          hint={rows >= MAX_ROWS ? `Tables hold up to ${MAX_ROWS} rows` : 'Add a row at the bottom'}
          disabled={rows >= MAX_ROWS}
          onClick={() => apply(insertRows(spec, rows, 1))}
        >
          <BetweenHorizontalEnd size={16} />
        </RailButton>
      ),
    },
    {
      id: 'column',
      controls: 1,
      node: (
        <RailButton
          label="Add column"
          hint={cols >= MAX_COLS ? `Tables hold up to ${MAX_COLS} columns` : 'Add a column on the right'}
          disabled={cols >= MAX_COLS}
          onClick={() => apply(insertCols(spec, cols, 1))}
        >
          <BetweenVerticalEnd size={16} />
        </RailButton>
      ),
    },
    {
      id: 'sort',
      controls: 1,
      node: (
        <RailPopover
          label={spec.sort ? `Sorted by ${columnName(spec, spec.sort.col)}` : 'Sort'}
          trigger={spec.sort ? spec.sort.dir === 'asc' ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} /> : <ArrowDownUp size={16} />}
          align="start"
        >
          <span className="ctx-popover__label">Sort by</span>
          <div className="rail-list" role="radiogroup" aria-label="Sort by column">
            {Array.from({ length: cols }, (_, c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={spec.sort?.col === c}
                className="rail-list__item"
                onClick={() => apply({ ...spec, sort: { col: c, dir: spec.sort?.dir ?? 'asc' } })}
              >
                <span className="rail-list__key">{columnLetter(c)}</span>
                <span className="rail-list__label">{columnName(spec, c)}</span>
              </button>
            ))}
          </div>
          {spec.sort && (
            <>
              <SegmentedControl
                ariaLabel="Sort direction"
                value={spec.sort.dir}
                onChange={(dir) => apply({ ...spec, sort: { ...spec.sort!, dir: dir as 'asc' | 'desc' } })}
                segments={[
                  { value: 'asc', label: 'A to Z', icon: <ArrowDownAZ size={14} /> },
                  { value: 'desc', label: 'Z to A', icon: <ArrowUpAZ size={14} /> },
                ]}
              />
              <button type="button" className="ctx-popover__action" onClick={() => apply({ ...spec, sort: undefined })}>
                Clear sort
              </button>
            </>
          )}
        </RailPopover>
      ),
    },
  ];

  return (
    <RailAnatomy
      paint={
        <RailPopover label={`Theme: ${TABLE_THEME_LABELS[spec.theme]}`} trigger={<ThemeTile theme={spec.theme} accent={accent} />} align="start">
          {(close) => (
            <>
              <span className="ctx-popover__label">Theme</span>
              <div className="rail-themes" role="radiogroup" aria-label="Table theme">
                {TABLE_THEMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={spec.theme === t}
                    className="rail-theme"
                    onClick={() => {
                      apply({ ...spec, theme: t });
                      close();
                    }}
                  >
                    <ThemeTile theme={t} accent={accent} />
                    <span>{TABLE_THEME_LABELS[t]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </RailPopover>
      }
      paintControls={1}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
