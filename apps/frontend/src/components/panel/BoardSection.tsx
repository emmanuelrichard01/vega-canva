import React from 'react';
import { Grid3x3, Moon, MousePointerSquareDashed } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { Accordion } from './panelPrimitives';
import { Switch } from '../ui/Switch';
import { GRID_SIZE } from '../../engine/interaction/gridSnap';
import { TYPE_LABEL, TYPE_ORDER } from '../../engine/model/nodeLabel';
import { TYPE_ICON } from './panelIcons';
import type { AnyNode, NodeType } from '../../engine/model/schema';

/**
 * What the Properties panel shows when nothing is selected.
 *
 * ## Why an empty state is the wrong thing to build here
 *
 * It was a grey icon and the words "Nothing selected", at 70% opacity, filling
 * a 260px column. That is a truthful message and a useless one: the panel being
 * blank already says the selection is empty, so the words add nothing, and a
 * quarter of the window sits dead for as long as you are not holding something.
 * On a canvas, that is most of the time — you deselect to look at your work,
 * which is exactly when you are most likely to be reading the panel.
 *
 * The fix is not a prettier nothing. It is noticing that **the selection being
 * empty is itself a selection**: what you have selected is the board. So the
 * panel keeps doing its one job — showing the properties of the current
 * subject — and the subject is the document. Deselect in Figma and you get Page
 * properties for the same reason.
 *
 * ## What earns a place
 *
 * Two things, and nothing else.
 *
 * **Contents**, because a board is a thing you lose track of. A count per type
 * answers "what is even on here" without a trip to the Layers panel, and each
 * row selects its type — so the panel that used to be a dead end becomes the
 * fastest way back into the document. Recolouring every sticky starts here.
 *
 * **Canvas**, because grid snap and dark mode are board-level settings that
 * live in a menu nobody opens. They belong to the same subject the panel is now
 * showing, and this is the only surface where they are not competing with a
 * selection's own properties for attention.
 *
 * Deliberately absent: tips, shortcut cards, illustrations, a "get started"
 * checklist. Those are things to read once and skip forever, which makes them
 * furniture by the second session — and furniture in a panel this narrow is
 * worse than the blank it replaced.
 */

interface Props {
  /** Replay snapshot, when Time Travel is showing one. */
  overrideObjects?: Record<string, AnyNode> | null;
}

/** How many of each type are on the board, in the Layers panel's own order. */
function census(objects: Record<string, AnyNode>): Array<{ type: NodeType; count: number }> {
  const counts = new Map<NodeType, number>();
  for (const node of Object.values(objects)) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  return TYPE_ORDER
    .filter((type) => counts.has(type))
    .map((type) => ({ type, count: counts.get(type)! }));
}

export const BoardSection: React.FC<Props> = ({ overrideObjects }) => {
  const storeObjects = useStore((s) => s.objects);
  const snapToGrid = useStore((s) => s.snapToGrid);
  const setSnapToGrid = useStore((s) => s.setSnapToGrid);
  const darkTheme = useStore((s) => s.darkTheme);
  const setDarkTheme = useStore((s) => s.setDarkTheme);

  // The replay snapshot when one is showing, so scrubbing history changes the
  // census with the canvas rather than reporting the live document underneath.
  const objects = overrideObjects ?? storeObjects;

  const rows = React.useMemo(() => census(objects), [objects]);
  const total = React.useMemo(() => Object.keys(objects).length, [objects]);

  /**
   * Selecting through the same event the tools use.
   *
   * `requestSelectNodes` is the existing channel — the grid tool, break apart
   * and duplicate all announce their results on it. Threading a callback down
   * instead would be a second way to do one thing, and the panel would be the
   * only caller of it.
   */
  const selectType = (type: NodeType) => {
    const ids = Object.values(objects)
      .filter((n) => n.type === type)
      .map((n) => n.id);
    if (ids.length > 0) {
      window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids } }));
    }
  };

  return (
    <>
      {total === 0 ? (
        /**
         * A board with nothing on it is a different state from a board you have
         * merely deselected, and it is the one case where a message is the
         * right answer — there is genuinely nothing to describe, and the useful
         * thing to say is where to start.
         *
         * Named tools rather than a picture of the toolbar: the toolbar is on
         * screen, and an illustration of it would be a second, staler copy.
         */
        <div className="board-empty">
          <MousePointerSquareDashed size={22} aria-hidden />
          <p className="board-empty__title">This board is empty</p>
          <p className="board-empty__hint">
            Draw a shape with <kbd>R</kbd>, write with <kbd>T</kbd>, or drop in an image.
          </p>
        </div>
      ) : (
        <Accordion title="Contents" icon={<MousePointerSquareDashed size={13} />} badge={String(total)} defaultOpen>
          <div className="board-census">
            {rows.map(({ type, count }) => {
              // The same glyph the Layers panel gives this type, from the same
              // map -- so a row here and a row there are recognisably the same
              // kind of thing rather than two independent guesses at an icon.
              const Icon = TYPE_ICON[type];
              return (
              <button
                key={type}
                type="button"
                className="board-census__row"
                onClick={() => selectType(type)}
                data-tooltip={`Select every one of these (${count})`}
              >
                <span className="board-census__label">
                  <Icon size={13} aria-hidden />
                  {TYPE_LABEL[type]}
                </span>
                {/* Tabular figures, so a column of counts lines up on the unit
                    digit instead of wandering with the glyph widths. */}
                <span className="board-census__count">{count}</span>
              </button>
              );
            })}
          </div>
        </Accordion>
      )}

      <Accordion title="Canvas" icon={<Grid3x3 size={13} />} defaultOpen>
        <div className="board-setting">
          <span className="board-setting__label">
            Snap to grid
            {/* The pitch, stated. A snap setting that does not say what it
                snaps *to* is a toggle you have to test to understand. */}
            <span className="board-setting__hint">{GRID_SIZE}px</span>
          </span>
          <Switch
            checked={snapToGrid}
            onChange={setSnapToGrid}
            label="Snap to grid"
            tooltip="Hold Ctrl while dragging to invert this"
          />
        </div>

        <div className="board-setting">
          <span className="board-setting__label">
            <Moon size={12} aria-hidden />
            Dark canvas
          </span>
          <Switch checked={darkTheme} onChange={setDarkTheme} label="Dark canvas" />
        </div>
      </Accordion>
    </>
  );
};
