import React, { useState, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
  /**
   * The selected objects disagree on this value.
   *
   * The field shows *Mixed* instead of a number, because showing the first
   * object's value would be a claim about all of them — and one that becomes
   * true the moment anything is committed, since the control writes what it
   * displays. `value` is still passed and still bounds the arrows; it is
   * simply not shown.
   */
  mixed?: boolean;
  /**
   * Apply a relative change instead of an absolute one.
   *
   * The arrows on a mixed field cannot mean "set every object to n ± step" —
   * that would flatten four different widths into one the moment you nudged
   * them. Given this, they mean "move each object's own value by ±step",
   * which is the only reading that preserves what makes them different.
   * Without it the arrows are disabled while the field is mixed, since there
   * is no defensible thing for them to do.
   */
  onNudge?: (delta: number) => void;
  /** Why this control is unavailable. Shown as a tooltip; also disables it. */
  disabledReason?: string;
  /**
   * The unit this number is in — `px`, `%`, `deg`.
   *
   * Rendered beside the value rather than inside it, so it never has to be
   * parsed back out on edit. Without it a panel of bare numbers gives no way
   * to tell a radius in pixels from an opacity in percent from a rotation in
   * degrees, which is a question people were answering by experiment.
   */
  suffix?: string;
}

export const NumberStepper: React.FC<Props> = ({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  label,
  className = '',
  mixed = false,
  onNudge,
  disabledReason,
  suffix,
}) => {
  const [localValue, setLocalValue] = useState(mixed ? '' : value.toString());
  const disabled = Boolean(disabledReason);

  useEffect(() => {
    setLocalValue(mixed ? '' : value.toString());
  }, [value, mixed]);

  const handleCommit = (val: number) => {
    const clamped = Math.max(min, Math.min(max, val));
    onChange(clamped);
    setLocalValue(clamped.toString());
  };

  /**
   * What an arrow does, which depends on whether the field is mixed.
   *
   * A mixed field nudges each object relative to itself; an agreed one steps
   * the shared value as it always has.
   */
  const handleStep = (direction: 1 | -1) => {
    if (disabled) return;
    if (mixed) {
      onNudge?.(direction * step);
      return;
    }
    handleCommit(value + direction * step);
  };

  const handleBlur = () => {
    // A mixed field left untouched stays mixed. Committing the empty string
    // here would parse as NaN and fall through to rewriting it with the
    // primary node's value, silently flattening the selection just for
    // tabbing past it.
    if (mixed && localValue.trim() === '') return;

    const parsed = parseFloat(localValue);
    if (!isNaN(parsed)) {
      // Committing unconditionally here meant merely focusing and blurring
      // this field — no edit at all — fired onChange (and so a CRDT write)
      // every time. Worse: the same field often has a lower `max` in this
      // toolbar than in the Properties panel (e.g. font size 200 vs 500) —
      // a value set higher elsewhere would silently get clamped back down
      // just by tabbing through this control with no intent to change it.
      const clamped = Math.max(min, Math.min(max, parsed));
      // A mixed field always commits, even to the primary node's own value:
      // there, the write is what makes the selection agree, so "no change"
      // is not the right test.
      if (mixed || clamped !== value) {
        handleCommit(parsed);
      } else if (clamped.toString() !== localValue) {
        setLocalValue(clamped.toString());
      }
    } else {
      setLocalValue(mixed ? '' : value.toString());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleStep(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleStep(-1);
    }
  };

  // A mixed field's arrows are bounded by nothing, because they move each
  // object from wherever it already is rather than from the shown value.
  const atMin = disabled || (!mixed && value <= min) || (mixed && !onNudge);
  const atMax = disabled || (!mixed && value >= max) || (mixed && !onNudge);

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: disabled ? 0.45 : 1 }}
      data-tooltip={disabledReason}
    >
      {label && <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '4px' }}>{label}</span>}
      <div style={{
        display: 'flex', alignItems: 'center', background: 'var(--surface-hover)',
        borderRadius: '6px', overflow: 'hidden', border: '1px solid transparent',
        transition: 'border-color 0.2s'
      }}>
        <button
          onClick={() => handleStep(-1)}
          disabled={atMin}
          className="btn-icon"
          aria-label={label ? `Decrease ${label}` : 'Decrease'}
          style={{ padding: '4px', opacity: atMin ? 0.3 : 1 }}
        >
          <Minus size={14} />
        </button>
        <input
          type="text"
          value={localValue}
          size={1}
          disabled={disabled}
          // Italic, not a real value: the field is reporting a state rather
          // than holding a number, and the placeholder is what a screen
          // reader announces as well.
          placeholder={mixed ? 'Mixed' : undefined}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: mixed ? '44px' : '32px',
            // Never shrink. Flex will happily compress an input below its
            // width to make a row fit, and a *number field* that does that
            // does not wrap or ellipsize — it silently renders 200 as "20".
            // A control that shows the wrong value is worse than one that
            // overflows, because nothing about it looks wrong.
            flexShrink: 0,
            background: 'transparent', border: 'none', outline: 'none',
            textAlign: 'center', fontSize: '12px', fontFamily: 'var(--font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
            fontStyle: mixed && localValue === '' ? 'italic' : 'normal',
          }}
        />
        {suffix && !mixed && (
          <span
            aria-hidden="true"
            style={{
              fontSize: '10px', color: 'var(--text-tertiary)', paddingRight: 4,
              fontFamily: 'var(--font-mono, monospace)', pointerEvents: 'none', flexShrink: 0,
            }}
          >
            {suffix === 'deg' ? '°' : suffix}
          </span>
        )}
        <button
          onClick={() => handleStep(1)}
          disabled={atMax}
          className="btn-icon"
          aria-label={label ? `Increase ${label}` : 'Increase'}
          style={{ padding: '4px', opacity: atMax ? 0.3 : 1 }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
};
