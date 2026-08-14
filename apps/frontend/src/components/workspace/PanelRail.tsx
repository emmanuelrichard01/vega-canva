import React from 'react';
import { Layers, PanelLeftOpen, PanelRightOpen, SlidersHorizontal } from 'lucide-react';

/**
 * A side panel, collapsed.
 *
 * The measured problem: two fixed 260px panels plus their gutters spent 552px
 * of a 1440px window, permanently, whether or not anyone was reading them. The
 * canvas was left with roughly half the screen and no way to claim more.
 *
 * Collapsing to 52px returns ~416px of canvas width — but a collapse that
 * leaves a blank strip is worse than no collapse at all, because a panel you
 * cannot see and cannot name reads as a feature that was removed. So the rail
 * keeps three things: what the panel is, how much is in it, and one obvious way
 * back. That is the whole difference between "collapsed" and "gone".
 */
interface Props {
  side: 'left' | 'right';
  /** What the panel is called, shown down the rail. */
  label: string;
  /** How many things it currently holds — layers, or selected objects. */
  count?: number;
  onExpand: () => void;
  /** Pinned to the rail's foot, below the flexible spacer. */
  footer?: React.ReactNode;
}

export const PanelRail: React.FC<Props> = ({ side, label, count, onExpand, footer }) => (
  <div className="panel-rail">
    <button
      type="button"
      className="panel-rail__btn"
      onClick={onExpand}
      data-tooltip={`Show ${label.toLowerCase()}`}
      data-tooltip-pos={side === 'left' ? 'right' : 'left'}
      aria-label={`Show ${label} panel`}
      aria-expanded={false}
    >
      {side === 'left' ? <PanelLeftOpen size={18} /> : <PanelRightOpen size={18} />}
    </button>

    <button
      type="button"
      className="panel-rail__btn"
      onClick={onExpand}
      // The same action as the chevron above it, deliberately: the icon is
      // what people aim at when they want the panel back, and making it inert
      // next to a control that works is a small trap repeated every session.
      data-tooltip={label}
      data-tooltip-pos={side === 'left' ? 'right' : 'left'}
      aria-label={`Show ${label} panel`}
      tabIndex={-1}
    >
      {side === 'left' ? <Layers size={17} /> : <SlidersHorizontal size={17} />}
    </button>

    {count !== undefined && count > 0 && (
      <span className="panel-rail__count" aria-hidden="true">{count}</span>
    )}

    <span className="panel-rail__spacer" />
    <span className="panel-rail__label">{label}</span>
    {footer}
  </div>
);
