import React from 'react';

export interface Segment {
  value: string;
  icon?: React.ReactNode;
  label?: string;
  /**
   * What this option *does*, shown on hover.
   *
   * These controls are mostly 20px specimen icons — a mitred corner, a butt
   * cap, an orthogonal route. The specimen shows you the shape, which is the
   * right way round for recognising one you already know, and says nothing at
   * all about when you would want it. The label alone does not close that gap
   * either: "Right angles" and "Curved" are both obvious as *shapes* and
   * neither tells you that one keeps a flowchart readable when arrows cross.
   */
  hint?: string;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (val: string) => void;
  /**
   * Names what the group as a whole selects.
   *
   * Without it a screen reader reads three unrelated buttons — "Solid",
   * "Dashed", "Dotted" — with nothing saying they are one choice, or a choice
   * of what.
   */
  ariaLabel?: string;
  /**
   * The selected objects disagree, so no segment is the answer.
   *
   * Rendered as nothing raised rather than as an extra "Mixed" segment: a
   * fourth segment would be a state you could *choose*, and "make these
   * disagree" is not an instruction anyone can carry out. Clicking any real
   * segment still resolves the whole selection to it.
   */
  mixed?: boolean;
  /**
   * Why this choice is unavailable right now.
   *
   * Shown as a tooltip and dims the group. Preferred over withholding the
   * control: a segmented choice that vanishes when it does not apply is
   * indistinguishable from one that is broken, and the reason it went is
   * exactly the thing worth saying.
   */
  disabledReason?: string;
}

/**
 * A one-of-several choice.
 *
 * Built as a radio group rather than a row of buttons. The previous version
 * used `title` for the accessible name, which is not one: `title` is a
 * tooltip, it is unreliable for assistive technology, and it never appears on
 * a touch device at all — so an icon-only segment had no name anywhere. Each
 * segment now carries `role="radio"` with `aria-checked`, and the label is on
 * the element whether or not it is also drawn.
 *
 * The active segment is raised rather than tinted: one border-or-shadow
 * elevation step, no second colour, which is the same language the rest of the
 * app's chrome uses for "this one".
 */
export const SegmentedControl: React.FC<Props> = ({ segments, value, onChange, ariaLabel, mixed = false, disabledReason }) => {
  const disabled = Boolean(disabledReason);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-tooltip={disabledReason}
      data-tooltip-pos="left"
      style={{
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : undefined,
        display: 'flex',
        alignItems: 'center',
        // Wraps rather than overflowing. A six- or seven-segment group in the
        // properties panel's control column is wider than the column, and a
        // non-wrapping flex row does not shrink below its content — so the
        // group ran out under its own label and the two drew on top of each
        // other. `minWidth: 0` is the other half: without it the flex item
        // refuses to be narrower than its contents and the wrap never fires.
        flexWrap: 'wrap',
        minWidth: 0,
        rowGap: '2px',
        background: 'var(--surface-hover)',
        padding: '2px',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {segments.map((seg) => {
        const isActive = !mixed && value === seg.value;
        const name = seg.label ?? seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={seg.hint ? `${name} — ${seg.hint}` : name}
            // Not on the group's own wrapper: that carries `disabledReason`,
            // and one element cannot show two different tooltips.
            data-tooltip={disabled ? undefined : seg.hint}
            disabled={disabled}
            onClick={() => onChange(seg.value)}
            className="btn-icon"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Never squeezed narrower than its own icon: a segment that
              // shrinks to fit is a specimen you can no longer recognise,
              // which is the whole reason these are specimens.
              flex: '0 0 auto',
              gap: 'var(--space-1)',
              padding: '4px 6px',
              borderRadius: 'var(--radius-sm)',
              background: isActive ? 'var(--surface-primary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {seg.icon && (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {seg.icon}
              </span>
            )}
            {seg.label && !seg.icon && (
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
                {seg.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
