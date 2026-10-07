import React from 'react';

export interface Segment {
  value: string;
  icon?: React.ReactNode;
  label?: string;
  /** What this option does, shown on hover. A specimen shows the shape, not when you would want it. */
  hint?: string;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (val: string) => void;
  /** Names what the group selects, so it is read as one choice. */
  ariaLabel?: string;
  /**
   * The selected objects disagree: no segment is chosen. Clicking any
   * segment resolves the whole selection to it.
   */
  mixed?: boolean;
  /** Why the choice is unavailable. Shown as a tooltip; dims the group. */
  disabledReason?: string;
  /**
   * Divide the column between the segments instead of letting them wrap.
   * For short groups whose share is wider than a segment's natural size.
   */
  fill?: boolean;
}

/**
 * A one-of-several choice, as a radio group.
 *
 * The chosen segment takes an ink wash, the panel's single language for
 * "this one". Arrow keys move the choice, as in any radio group.
 */
export const SegmentedControl: React.FC<Props> = ({ segments, value, onChange, ariaLabel, mixed = false, disabledReason, fill = false }) => {
  const disabled = Boolean(disabledReason);
  const activeIndex = mixed ? -1 : segments.findIndex((s) => s.value === value);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = activeIndex < 0 ? (dir > 0 ? -1 : 0) : activeIndex;
    const next = (from + dir + segments.length) % segments.length;
    onChange(segments[next].value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-tooltip={disabledReason}
      data-tooltip-pos="left"
      className={`seg${fill ? ' seg--fill' : ''}`}
      onKeyDown={onKeyDown}
    >
      {segments.map((seg, i) => {
        const isActive = i === activeIndex;
        const name = seg.label ?? seg.value;
        const tabbable = isActive || (activeIndex < 0 && i === 0);
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={seg.hint ? `${name}. ${seg.hint}` : name}
            data-tooltip={disabled ? undefined : seg.hint ?? (seg.icon ? name : undefined)}
            disabled={disabled}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(seg.value)}
            className="seg__item"
          >
            {seg.icon ? (
              <span className="seg__icon" aria-hidden="true">{seg.icon}</span>
            ) : (
              seg.label && <span className="seg__label">{seg.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
