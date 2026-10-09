import React, { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Columns3, LayoutGrid, MoveHorizontal, MoveVertical } from 'lucide-react';
import { RailPopover } from '../toolbar/RailPopover';
import { NumberStepper } from '../ui/NumberStepper';
import { Row, PairRow } from '../panel/grammar';
import { useStore } from '../../hooks/useStore';
import { arrangeSession } from '../../engine/arrange/session';
import { MAX_COLUMNS, MAX_GAP, type CellAlign } from '../../engine/arrange/grid';
import type { AnyNode } from '../../engine/model/schema';
import { canEditObjects } from '../../engine/model/permissions';
import './arrange.css';

/**
 * Arrange in a live grid.
 *
 * Opening the panel lays the selection into the grid it is already closest
 * to (rows and columns read from where things are, gaps from the space
 * already left between them) and keeps it live: columns, both gaps and the
 * alignment inside each cell reflow at once, the gaps can be dragged on the
 * board, and any item can be dragged to another slot. Closing the panel
 * leaves the grid live with its board handles; it settles as one undo step
 * on Done, Enter, a press anywhere else or a new selection, and Escape puts
 * everything back.
 */

const useSession = () => useSyncExternalStore(arrangeSession.subscribe, arrangeSession.get, arrangeSession.get);

const ALIGNS: CellAlign[] = ['start', 'center', 'end'];
const AXIS_WORD: Record<CellAlign, [string, string]> = {
  start: ['Top', 'left'],
  center: ['Middle', 'centre'],
  end: ['Bottom', 'right'],
};

/** Nine positions, as Figma's alignment matrix: one press sets both axes. */
const CellMatrix: React.FC<{ x: CellAlign; y: CellAlign; onChange: (x: CellAlign, y: CellAlign) => void }> = ({ x, y, onChange }) => {
  const cells = ALIGNS.flatMap((ay) => ALIGNS.map((ax) => ({ ax, ay })));
  const at = cells.findIndex((c) => c.ax === x && c.ay === y);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const col = at % 3;
    const row = Math.floor(at / 3);
    const next =
      e.key === 'ArrowRight' ? row * 3 + Math.min(2, col + 1)
      : e.key === 'ArrowLeft' ? row * 3 + Math.max(0, col - 1)
      : e.key === 'ArrowDown' ? Math.min(2, row + 1) * 3 + col
      : e.key === 'ArrowUp' ? Math.max(0, row - 1) * 3 + col
      : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(cells[next].ax, cells[next].ay);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="arr-matrix" role="radiogroup" aria-label="Align in cells" onKeyDown={onKeyDown}>
      {cells.map(({ ax, ay }, i) => {
        const name = ax === 'center' && ay === 'center' ? 'Centre' : `${AXIS_WORD[ay][0]} ${AXIS_WORD[ax][1]}`;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === at}
            aria-label={name}
            data-tooltip={name}
            tabIndex={i === at ? 0 : -1}
            className="arr-matrix__cell"
            onClick={() => onChange(ax, ay)}
          >
            <i aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};

const GridPanel: React.FC<{ nodes: readonly AnyNode[]; close: () => void }> = ({ nodes, close }) => {
  const session = useSession();
  const ids = nodes.map((n) => n.id);

  // Before the first paint, so the panel opens on the live grid rather than on a placeholder.
  useLayoutEffect(() => {
    const { objects, groups } = useStore.getState();
    arrangeSession.start(nodes, objects, groups);
    // Started once per opening; the selection changing closes the rail anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Settled or put back from elsewhere (Enter, Escape, a press on the board): the panel goes too.
  const live = session !== null && arrangeSession.activeFor(ids);
  const wasLive = useRef(false);
  useEffect(() => {
    if (live) wasLive.current = true;
    else if (wasLive.current) close();
  }, [live, close]);

  if (!session || !live) {
    return (
      <div className="arr-panel">
        <p className="ctx-popover__note arr-note">
          {!canEditObjects() ? 'Only editors can arrange this board.' : 'Needs two or more objects that can move.'}
        </p>
      </div>
    );
  }

  const { spec, layout, units, locked } = session;
  return (
    <div className="arr-panel">
      <Row label="Columns">
        <NumberStepper
          aria-label="Columns"
          glyph={<Columns3 size={13} />}
          value={spec.columns}
          min={1}
          max={Math.min(MAX_COLUMNS, units.length)}
          step={1}
          precision={0}
          onPreview={(v) => arrangeSession.update({ columns: v })}
          onChange={(v) => arrangeSession.update({ columns: v })}
        />
        <span className="arr-readout" aria-live="polite">
          {layout.rows} {layout.rows === 1 ? 'row' : 'rows'}
        </span>
      </Row>
      <Row label="Gap">
        <PairRow>
          <NumberStepper
            aria-label="Gap between columns"
            glyph={<MoveHorizontal size={13} />}
            value={spec.colGap}
            min={0}
            max={MAX_GAP}
            step={1}
            precision={0}
            onPreview={(v) => arrangeSession.update({ colGap: v })}
            onChange={(v) => arrangeSession.update({ colGap: v })}
          />
          <NumberStepper
            aria-label="Gap between rows"
            glyph={<MoveVertical size={13} />}
            value={spec.rowGap}
            min={0}
            max={MAX_GAP}
            step={1}
            precision={0}
            onPreview={(v) => arrangeSession.update({ rowGap: v })}
            onChange={(v) => arrangeSession.update({ rowGap: v })}
          />
        </PairRow>
      </Row>
      <Row label="In each cell">
        <CellMatrix x={spec.alignX} y={spec.alignY} onChange={(alignX, alignY) => arrangeSession.update({ alignX, alignY })} />
      </Row>
      <p className="ctx-popover__note arr-note">
        Drag a gap on the board to space them, or an object to move it to another cell.
        {locked > 0 && (locked === 1 ? ' One locked object stays put.' : ` ${locked} locked objects stay put.`)}
      </p>
      <div className="arr-actions">
        <button
          type="button"
          className="ctx-popover__action"
          data-tooltip="Put everything back (Esc)"
          onClick={() => {
            arrangeSession.cancel();
            close();
          }}
        >
          Revert
        </button>
        <button
          type="button"
          className="ctx-popover__action arr-actions__done"
          data-tooltip="Keep this arrangement (Enter)"
          onClick={() => {
            arrangeSession.commit();
            close();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
};

export interface GridControlProps {
  nodes: readonly AnyNode[];
}

/** The rail's live grid trigger. Its glyph carries a mark while a grid is live. */
export const GridControl: React.FC<GridControlProps> = ({ nodes }) => {
  const session = useSession();
  const live = session !== null && arrangeSession.activeFor(nodes.map((n) => n.id));
  return (
    <RailPopover
      label="Arrange in grid"
      align="start"
      live
      trigger={
        <span className="arr-trigger" data-live={live || undefined}>
          <LayoutGrid size={16} />
        </span>
      }
    >
      {(close) => <GridPanel nodes={nodes} close={close} />}
    </RailPopover>
  );
};
