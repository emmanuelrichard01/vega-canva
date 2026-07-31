import React from 'react';

export interface Segment {
  value: string;
  icon?: React.ReactNode;
  label?: string;
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
export const SegmentedControl: React.FC<Props> = ({ segments, value, onChange, ariaLabel }) => {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--surface-hover)',
        padding: '2px',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {segments.map((seg) => {
        const isActive = value === seg.value;
        const name = seg.label ?? seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={name}
            onClick={() => onChange(seg.value)}
            className="btn-icon"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
