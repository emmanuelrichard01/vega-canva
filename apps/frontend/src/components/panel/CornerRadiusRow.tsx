import React from 'react';
import { Link2, Unlink2 } from 'lucide-react';
import { Row } from './panelPrimitives';
import { NumberStepper } from '../ui/NumberStepper';
import {
  cornerRadiiOf,
  isUniform,
  packRadii,
  type CornerRadii,
  type CornerRadiusValue,
} from '../../engine/model/cornerRadii';
import type { Shared } from '../../engine/model/selection';

/**
 * The corner radius, as one number or four.
 *
 * ## Why a link toggle and not a permanent four-up grid
 *
 * Four fields on show at all times would be four times the panel weight for a
 * control that is one number in almost every use. Figma, Illustrator and
 * Sketch all landed on the same shape — one field, and a way to break it
 * apart — because the common case deserves the small control and the rare case
 * deserves to be *reachable*, not equally prominent.
 *
 * ## What "linked" means when the corners already differ
 *
 * The toggle reflects the *value*, not a separate stored flag — `isUniform`
 * reads the four. So a shape whose corners differ shows as unlinked without
 * anything having to remember that it does. There is no second piece of state
 * to fall out of step with the geometry, which is the whole reason the model
 * stores one field in two forms rather than two fields.
 */

/**
 * Where each stored radius sits in the grid, and what it is called.
 *
 * ## The bug this table exists to prevent, which it did not prevent once
 *
 * Storage order is **clockwise** — `[topLeft, topRight, bottomRight,
 * bottomLeft]` — because that is the order Konva's `Rect` takes and the order
 * an SVG path walks. Reading order is **left-to-right, top-to-bottom**.
 *
 * Those two disagree on exactly the bottom row, and the first version of this
 * grid mapped the array straight into a two-column layout:
 *
 * ```text
 *   stored:  TL  TR  BR  BL
 *   drawn:   TL  TR          ← correct
 *            BR  BL          ← swapped
 * ```
 *
 * Every field was live and wired; two of them were simply under the wrong
 * corner, so typing into the bottom-left box rounded the bottom-right one. A
 * control that edits the wrong thing while looking correct is worse than one
 * that is obviously broken, and the only reason it is not still there is that
 * somebody sat and compared it to a shape.
 *
 * So the two orders are named and converted once, here, rather than assumed to
 * be the same thing anywhere.
 */
const GRID: readonly { index: number; label: string }[] = [
  { index: 0, label: 'Top left' },
  { index: 1, label: 'Top right' },
  { index: 3, label: 'Bottom left' },
  { index: 2, label: 'Bottom right' },
];

export const CornerRadiusRow: React.FC<{
  value: Shared<CornerRadiusValue | undefined>;
  onChange: (next: CornerRadiusValue | undefined) => void;
}> = ({ value, onChange }) => {
  const radii = cornerRadiiOf(value.value);
  const uniform = isUniform(value.value);

  /**
   * Whether the four fields are showing.
   *
   * Held locally *and* derived: a shape with differing corners is always
   * unlinked, and a shape with uniform corners can still be opened up to set
   * them. Without the local half, unlinking a square shape would immediately
   * re-link itself, because all four are still equal at the moment you ask.
   */
  const [expanded, setExpanded] = React.useState(false);
  const open = expanded || !uniform;

  const setOne = (index: number, n: number) => {
    const next = [...radii] as CornerRadii;
    next[index] = Math.max(0, n);
    onChange(packRadii(next));
  };

  return (
    <Row
      label="Radius"
      hint={
        open
          ? 'Each corner on its own. Link them to set all four at once.'
          : 'Rounds every corner by the same amount. Unlink to set each on its own.'
      }
      stack={open}
    >
      <div className={open ? 'radius-control radius-control--open' : 'radius-control'}>
        {open ? (
          <div className="radius-grid">
            {GRID.map(({ index, label }) => (
              <label key={index} className="radius-cell">
                {/*
                  A visible mark, not just an `aria-label`. Position alone
                  identifies a corner only if you already know the convention,
                  and the version that relied on it is the one that shipped two
                  fields under the wrong corners without anyone noticing. The
                  glyph is the corner itself — a right angle turned the way that
                  corner faces — so it names the field in the field's own terms
                  rather than in words.
                */}
                <CornerGlyph index={index} />
                <NumberStepper
                  value={radii[index]}
                  onChange={(n: number) => setOne(index, n)}
                  min={0}
                  max={200}
                  aria-label={label}
                />
              </label>
            ))}
          </div>
        ) : (
          <NumberStepper
            value={radii[0]}
            mixed={value.mixed}
            onChange={(n: number) => onChange(n === 0 ? undefined : n)}
            min={0}
            max={200}
          />
        )}

        <button
          type="button"
          className="radius-link"
          data-on={!open || undefined}
          aria-pressed={!open}
          aria-label={open ? 'Link corners' : 'Set corners separately'}
          data-tooltip={open ? 'Link corners' : 'Set corners separately'}
          onClick={() => {
            if (open) {
              // Collapsing takes the largest, not the first: going back to one
              // number should keep the roundest corner the shape had rather
              // than whichever happens to be listed first.
              setExpanded(false);
              const max = Math.max(...radii);
              onChange(packRadii([max, max, max, max]));
            } else {
              setExpanded(true);
            }
          }}
        >
          {open ? <Unlink2 size={13} /> : <Link2 size={13} />}
        </button>
      </div>
    </Row>
  );
};

/**
 * A right angle, turned to face the corner it labels.
 *
 * Two strokes, at the size of a caption, sitting inside the field's own box —
 * so the four cells read as a picture of the shape rather than as a list that
 * happens to be two wide.
 */
const CornerGlyph: React.FC<{ index: number }> = ({ index }) => {
  // Clockwise from the top-left, matching storage order.
  const d = ['M2 8V2h6', 'M2 2h6v6', 'M8 2v6H2', 'M8 8H2V2'][index];
  return (
    <svg className="radius-cell__glyph" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};
