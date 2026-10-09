import React, { useState, useEffect, useRef } from 'react';
import { roundTo, scrubValue, stepPrecision } from '../panel/grammar/scrub';

interface Props {
  value: number;
  /** Called once per edit: on Enter or blur, on each arrow press, and once at the end of a scrub. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /**
   * What Shift+↑/↓ moves by. Ten steps by default; a field whose step is a
   * fraction (a 0.25 stroke weight) sets a round unit instead.
   */
  coarseStep?: number;
  /** Decimal places kept. Defaults to what `step` and the value itself imply. */
  precision?: number;
  /** The axis letter inside the field: X, Y, W, H, R. */
  label?: string;
  className?: string;
  /**
   * The selected objects disagree on this value. The field shows *Mixed*
   * instead of a number; `value` still bounds the arrows.
   */
  mixed?: boolean;
  /**
   * Apply a relative change instead of an absolute one. On a mixed field the
   * arrows and a scrub move each object by the delta, which preserves what
   * makes them different; without this they do nothing there.
   */
  onNudge?: (delta: number) => void;
  /** Why this control is unavailable. Shown as a tooltip; also disables it. */
  disabledReason?: string;
  /** The unit, drawn inside the field's padding: `px`, `%`, `deg`. */
  suffix?: string;
  /** A mark inside the field standing in for a row label. */
  glyph?: React.ReactNode;
  /**
   * Drag the letter or glyph sideways to change the value: 1 step per 2px,
   * Shift for ten, Alt for a tenth. On by default wherever there is a letter
   * or glyph to hold.
   */
  scrub?: boolean;
  /** A scrub began. Pair with `onScrubEnd`; previews arrive in between. */
  onScrubStart?: () => void;
  /** Every intermediate value of a scrub on an agreed field. Not a commit. */
  onPreview?: (value: number) => void;
  /**
   * Every intermediate step of a scrub on a mixed field, as the change since
   * the previous one, so applying each in turn moves every object by the
   * whole travel so far.
   */
  onNudgePreview?: (delta: number) => void;
  /** A scrub ended; `cancelled` when it should leave no trace. Called before the commit. */
  onScrubEnd?: (cancelled: boolean) => void;
  'aria-label'?: string;
}

function format(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

/** Decimal places in a number as written: 2.3 → 1. */
function decimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  const dot = text.indexOf('.');
  return dot < 0 || text.includes('e') ? 0 : text.length - dot - 1;
}

export const NumberStepper: React.FC<Props> = ({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  coarseStep,
  precision,
  label,
  className = '',
  mixed = false,
  onNudge,
  disabledReason,
  suffix,
  glyph,
  scrub = true,
  onScrubStart,
  onPreview,
  onNudgePreview,
  onScrubEnd: onScrubFinished,
  'aria-label': ariaLabel,
}) => {
  const [localValue, setLocalValue] = useState(mixed ? '' : format(value));
  const [scrubbing, setScrubbing] = useState(false);
  const disabled = Boolean(disabledReason);

  /**
   * While the person is typing, a new `value` (a collaborator changing the same
   * property) must not replace their text; and a field they only tabbed
   * through must not write back a value that went stale while it had focus.
   */
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);
  const scrubRef = useRef<{ x: number; start: number; last: number; pointer: number } | null>(null);

  useEffect(() => {
    if (focusedRef.current && dirtyRef.current) return;
    if (scrubRef.current) return;
    setLocalValue(mixed ? '' : format(value));
  }, [value, mixed]);

  /** Rounded to the field's precision, so 2.3 − 1 is 1.3 and not 1.2999999999999998. */
  const tidy = (n: number) => roundTo(n, precision ?? Math.max(stepPrecision(step), decimals(value)));

  const handleCommit = (val: number) => {
    const clamped = tidy(Math.max(min, Math.min(max, val)));
    onChange(clamped);
    setLocalValue(format(clamped));
  };

  /** An arrow press: relative on a mixed field, absolute otherwise. Shift takes ten. */
  const handleStep = (direction: 1 | -1, coarse = false) => {
    if (disabled) return;
    const amount = direction * (coarse ? coarseStep ?? step * 10 : step);
    if (mixed) {
      onNudge?.(amount);
      return;
    }
    handleCommit(value + amount);
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const typed = dirtyRef.current;
    dirtyRef.current = false;
    if (!typed) {
      setLocalValue(mixed ? '' : format(value));
      return;
    }
    // A mixed field left empty stays mixed rather than flattening the selection.
    if (mixed && localValue.trim() === '') return;

    const parsed = parseFloat(localValue);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      // A mixed field always commits: the write is what makes the selection agree.
      if (mixed || clamped !== value) {
        handleCommit(parsed);
      } else if (format(clamped) !== localValue) {
        setLocalValue(format(clamped));
      }
    } else {
      setLocalValue(mixed ? '' : format(value));
    }
  };

  /**
   * Enter commits and Escape reverts. ↑ and ↓ step (Shift for ten); ← and →
   * stay with the caret, because this is a text field you may be typing in.
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      dirtyRef.current = false;
      setLocalValue(mixed ? '' : format(value));
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleStep(1, e.shiftKey);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleStep(-1, e.shiftKey);
    }
  };

  const canScrub = scrub && !disabled && (Boolean(label) || Boolean(glyph)) && (!mixed || Boolean(onNudge));

  const onScrubDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!canScrub || e.button !== 0) return;
    e.preventDefault();
    const start = mixed ? 0 : value;
    scrubRef.current = { x: e.clientX, start, last: start, pointer: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety: without it the drag still ends on pointerup here.
    }
    setScrubbing(true);
    onScrubStart?.();
  };

  const onScrubMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = scrubRef.current;
    if (!s || e.pointerId !== s.pointer) return;
    const next = scrubValue(s.start, e.clientX - s.x, { shift: e.shiftKey, alt: e.altKey }, {
      step,
      precision,
      min: mixed ? -Infinity : min,
      max: mixed ? Infinity : max,
    });
    if (next === s.last) return;
    const delta = roundTo(next - s.last, 10);
    s.last = next;
    if (mixed) {
      onNudgePreview?.(delta);
    } else {
      setLocalValue(format(next));
      onPreview?.(next);
    }
  };

  const endScrub = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = scrubRef.current;
    if (!s || e.pointerId !== s.pointer) return;
    scrubRef.current = null;
    setScrubbing(false);
    const moved = s.last !== s.start;
    onScrubFinished?.(cancelled || !moved);
    if (cancelled || !moved) {
      setLocalValue(mixed ? '' : format(value));
      return;
    }
    // One write for the whole drag, so a scrub is one undo step.
    if (mixed) onNudge?.(s.last);
    else handleCommit(s.last);
  };

  const scrubHandlers = canScrub
    ? {
        onPointerDown: onScrubDown,
        onPointerMove: onScrubMove,
        onPointerUp: (e: React.PointerEvent<HTMLElement>) => endScrub(e, false),
        onPointerCancel: (e: React.PointerEvent<HTMLElement>) => endScrub(e, true),
      }
    : {};

  const scrubTitle = canScrub ? 'Drag to change · Shift ×10 · Alt ×0.1' : undefined;

  return (
    <div
      className={`field${className ? ` ${className}` : ''}`}
      data-disabled={disabled || undefined}
      data-scrubbing={scrubbing || undefined}
      data-tooltip={disabledReason}
    >
      {label && (
        <span className="stepper-label" data-scrub={canScrub || undefined} title={scrubTitle} {...scrubHandlers}>
          {label}
        </span>
      )}
      {/* `.stepper` carries the focus ring for the input inside it. */}
      <div className="stepper">
        {glyph && (
          <span className="stepper-glyph" aria-hidden="true" data-scrub={canScrub || undefined} title={scrubTitle} {...scrubHandlers}>
            {glyph}
          </span>
        )}
        <input
          type="text"
          inputMode="decimal"
          className="stepper__input"
          data-has-glyph={glyph ? true : undefined}
          data-has-suffix={suffix && !mixed ? true : undefined}
          data-mixed={mixed && localValue === '' ? true : undefined}
          aria-label={ariaLabel ?? label}
          value={localValue}
          size={1}
          disabled={disabled}
          placeholder={mixed ? 'Mixed' : undefined}
          onChange={(e) => {
            dirtyRef.current = true;
            setLocalValue(e.target.value);
          }}
          onFocus={(e) => {
            focusedRef.current = true;
            dirtyRef.current = false;
            e.currentTarget.select();
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          title={disabledReason || (coarseStep !== undefined ? `↑ ↓ to step · Shift for ${coarseStep}` : '↑ ↓ to step · Shift for ten')}
        />
        {suffix && !mixed && (
          <span className="stepper__suffix" aria-hidden="true">
            {suffix === 'deg' ? '°' : suffix}
          </span>
        )}
      </div>
    </div>
  );
};
