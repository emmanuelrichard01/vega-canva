import React, { useState, useEffect } from 'react';

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
  const handleStep = (direction: 1 | -1, coarse = false) => {
    if (disabled) return;
    // Shift takes ten steps at once, which is the convention every design tool
    // shares and the reason the arrows can carry the whole job: without it a
    // hundred-unit change is a hundred presses.
    const amount = direction * step * (coarse ? 10 : 1);
    if (mixed) {
      onNudge?.(amount);
      return;
    }
    handleCommit(value + amount);
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
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      handleStep(1, e.shiftKey);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      handleStep(-1, e.shiftKey);
    }
  };


  return (
    /**
     * The field, as one named thing.
     *
     * ## Why this element has a class now
     *
     * It used to be an unclassed `div` carrying its layout inline, which meant
     * it had no sizing of its own — so how wide a number field came out was
     * decided entirely by what happened to contain it. In a `.prop-row__control`
     * (flex, right-aligned) it shrank to its content floor; in a grid cell it
     * stretched to `1fr`. Measured across one 260px panel, the same control
     * came out at:
     *
     * ```text
     *   Weight            31px
     *   Opacity         40.5px   ← wider only because it carries a "%"
     *   Radius (linked)   31px
     *   Radius corners  95.5px
     *   Transform X/Y     78px
     * ```
     *
     * A three-fold spread, and five different left edges, for one control. The
     * 31px ones have fifteen pixels of room between their paddings — enough for
     * `2` and not for `100`, so the panel's most common value was the one it
     * could not show.
     *
     * `.field` gives it a width rule of its own: take the column, down to a
     * floor. Every container in the panel already sizes its columns
     * deliberately, so this is the one line that makes the field agree with
     * them instead of guessing.
     */
    <div
      className={className ? `field ${className}` : 'field'}
      style={{ opacity: disabled ? 0.45 : 1 }}
      data-tooltip={disabledReason}
    >
      {/* The axis letter: X, Y, W, H, R.

          It carries a fixed width in the stylesheet, which is what actually
          keeps the field beside it on a shared left edge. This used to rely on
          `tabular-nums` and a comment saying that stopped a wider label from
          shifting the field — but these labels are letters, and
          `font-variant-numeric` only ever selects between digit glyphs. The
          declaration was inert and the columns were measurably ragged. */}
      {label && <span className="stepper-label">{label}</span>}
      {/* `stepper` carries the focus ring for the input inside it, which sets
          `outline: none` so the browser's own ring does not cut across this
          border. See `.stepper:focus-within`. */}
      <div
        className="stepper"
        style={{
          display: 'flex', alignItems: 'center', background: 'var(--surface-hover)',
          /* Tighter than the panel's cards. A field is a small, dense,
             repeated element and a 6px curve on a 26px box reads as a pill;
             at 4px it reads as a field. The arrows used to fill the ends and
             hid this — with a bare number the corner is the shape. */
          borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid transparent',
          transition: 'border-color 0.2s'
        }}
      >
        {/*
          There are no arrows any more.
          ---------------------------------------------------------------------
          A `−` and a `+` beside every number is two controls per field, and
          this panel holds a dozen fields — so the arrows were the single
          largest source of visual noise in it, and each pair says only what
          the field already implies. Every design tool this product is measured
          against shows a bare number here.

          They are removed rather than hidden because their whole job is
          already done better by the keyboard: `ArrowUp`/`ArrowDown` step by
          one, `Shift` takes ten, and `ArrowLeft`/`ArrowRight` do the same for
          anyone who reaches for a horizontal pair on a horizontal field. That
          was true before this change — the arrows were a *second* way to do
          it, and the less discoverable one now carries a hint instead.
        */}
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
          // The affordance the arrows used to be. A number field that responds
          // to the arrow keys is a convention, not a certainty, so it is worth
          // one line of a tooltip rather than left to be discovered.
          title={disabledReason || '↑ ↓ to step · Shift for ten'}
          style={{
            // Takes the room the field has left over, down to a floor.
            //
            // This was a fixed 32px that never shrank, on the reasoning that a
            // compressed number field silently renders 200 as "20" — which is
            // true, and was solving the problem one level too low. A rigid
            // input inside a field that is *itself* narrower than its contents
            // does not prevent the clipping, it relocates it: the field's
            // `overflow: hidden` took the difference out of the increase
            // button instead, so the digits stayed perfect and the control
            // beside them lost a third of its width.
            //
            // The floor is what protects the value. It fits four digits at
            // this size, so nothing legible is ever cut; above it the input
            // simply absorbs whatever width the column happens to give.
            flex: '1 1 auto',
            width: 'auto',
            minWidth: mixed ? '44px' : '28px',
            background: 'transparent', border: 'none', outline: 'none',
            /* Left, not centred. Centring was right while a button sat on each
               side and the number was the middle of three things; with the
               buttons gone the number *is* the field, and a column of
               left-aligned figures scans as a column. It is what Figma and
               Illustrator both show. */
            // The right inset is the field's, not the input's, whenever a
            // suffix follows: `100` and `%` are one reading, so they sit a
            // space apart and the 8px belongs on the outside of both. With
            // both carrying 8 the unit drifted off to the right on its own and
            // the field measured wider than its neighbours for no reason
            // anyone chose — `%` alone made Opacity 9.5px wider than Weight.
            padding: suffix ? '0 2px 0 8px' : '0 8px',
            textAlign: 'left', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
            fontStyle: mixed && localValue === '' ? 'italic' : 'normal',
          }}
        />
        {suffix && !mixed && (
          <span
            aria-hidden="true"
            style={{
              fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', paddingRight: 8,
              fontFamily: 'var(--font-mono, monospace)', pointerEvents: 'none', flexShrink: 0,
            }}
          >
            {suffix === 'deg' ? '°' : suffix}
          </span>
        )}
      </div>
    </div>
  );
};
