import React from 'react';
import { ChevronLeft, ChevronRight, Layers, SlidersHorizontal } from 'lucide-react';

/**
 * A side panel, collapsed.
 *
 * The measured problem: two fixed 260px panels plus their gutters spent 552px
 * of a 1440px window, permanently, whether or not anyone was reading them. The
 * canvas was left with roughly half the screen and no way to claim more.
 *
 * Collapsing to 52px returns ~416px of canvas width, and both panels now start
 * this way. That makes the rail the first thing a newcomer meets rather than
 * the thing they discover after collapsing something, which raises the bar for
 * it: a blank strip would read as a feature that had been removed. So the rail
 * keeps what the panel is, how much is in it, and one obvious way back.
 *
 * ## Why the whole rail is the button
 *
 * It was two: a chevron and an icon, stacked, both firing `onExpand`, with the
 * second carrying `tabIndex={-1}` and a note explaining that making the icon
 * inert beside a control that works would be a small trap repeated every
 * session. That note was right about the problem and reached for the wrong
 * solution. Two controls that do one thing are still two controls; they read as
 * a toolbar, they are two hover targets with one meaning, and they cost the
 * rail its two best rows.
 *
 * One button, and it is the entire strip. A 52px by full-height target cannot
 * be missed or mis-aimed, there is nothing to explain about which part does
 * what, and the chevron becomes what it should always have been: a mark that
 * appears on hover to say which way this is about to move, rather than a
 * control competing with the icon beside it.
 *
 * ## Why the count is a dot when it is only "some"
 *
 * The number matters on the left, where it is how many layers there are. On the
 * right it is how many objects are selected, and one, two or three there is a
 * fact you can already see on the canvas. What is worth saying on that side is
 * only that the panel has something to show, which is a dot.
 */
interface Props {
  side: 'left' | 'right';
  /** What the panel is called, shown down the rail. */
  label: string;
  /** How many things it currently holds. Shown as a number. */
  count?: number;
  /**
   * The panel has something worth opening for, without a number worth printing.
   *
   * Drawn as a dot on the icon. It is deliberately not derived from `count`:
   * the two sides mean different things by "has something", and a rail that
   * guessed would be wrong on one of them.
   */
  live?: boolean;
  onExpand: () => void;
  /** Pinned to the rail's foot, below the flexible spacer. */
  footer?: React.ReactNode;
}

export const PanelRail: React.FC<Props> = ({ side, label, count, live, onExpand, footer }) => (
  <div className="panel-rail" data-side={side}>
    <button
      type="button"
      className="panel-rail__open"
      onClick={onExpand}
      data-tooltip={`Show ${label.toLowerCase()}`}
      data-tooltip-pos={side === 'left' ? 'right' : 'left'}
      aria-label={`Show ${label} panel`}
      aria-expanded={false}
    >
      {/* Which way this is about to move. Hidden until the pointer is on the
          rail, because at rest the rail should read as a label rather than as
          a control waiting to be pressed. */}
      <span className="panel-rail__chevron" aria-hidden="true">
        {side === 'left' ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </span>

      <span className="panel-rail__icon" aria-hidden="true" data-live={live || undefined}>
        {side === 'left' ? <Layers size={17} /> : <SlidersHorizontal size={17} />}
      </span>

      {count !== undefined && count > 0 && (
        <span className="panel-rail__count" aria-hidden="true">{count}</span>
      )}

      <span className="panel-rail__spacer" />

      {/* Vertical label down the rail. The one place in this app where rotated
          type earns its keep: a 52px rail has no horizontal room for a word,
          and an unlabelled rail is a mystery column. */}
      <span className="panel-rail__label">{label}</span>
    </button>

    {/* Outside the button, because a control inside a control is not a thing a
        pointer or a screen reader can resolve. */}
    {footer}
  </div>
);
