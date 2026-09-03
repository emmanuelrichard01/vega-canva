import React, { useEffect, useId, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  /**
   * Hide the label, keeping it for screen readers.
   *
   * For the rows that already carry a caption of their own. Two visible labels
   * for one control is not a redundancy you stop noticing -- the caption reads
   * "Uneven modules" and the slider's own label reads "Uneven m..." beside it,
   * so the panel appears to have truncated something for no reason.
   */
  labelHidden?: boolean;
  /**
   * The value the fill is measured *from*, and the value a double-click
   * returns to. Defaults to `min`.
   *
   * For a bipolar control this is the neutral point, not the bottom of the
   * range: filling from the left on a brightness slider says "40% brightness"
   * when what the number means is "40 points darker than as-shot". Filling
   * from the middle shows the *departure*, which is the quantity.
   */
  origin?: number;
  /** Appended to the readout and the accessible value. */
  unit?: string;
  /**
   * Render the readout, when the raw number is not the useful one.
   *
   * The forces panel shows Area as a distance in world pixels — the size of
   * the ring actually drawn on the canvas — rather than as the multiplier it
   * stores, because a radius is a distance and not a ratio. Without this, a
   * panel needing that has to keep its own bare `input[type=range]`, which is
   * exactly the divergence this component exists to end.
   */
  format?: (value: number) => string;
  /** Tints the fill and thumb, for a panel that carries an accent. */
  accent?: string;
  /** Long-form description, surfaced through the app's own tooltip layer. */
  hint?: string;
  /**
   * The step while Shift is held. Defaults to a tenth of `step`.
   *
   * A range is a coarse instrument by design — the whole track is the whole
   * range, so on a 200-point brightness scale one pixel is roughly one point
   * and there is no way to ask for less. Every adjustment panel worth using
   * has a modifier for this, and the native input already routes `step`
   * through both the drag and the arrow keys, so swapping it while Shift is
   * down gives fine control on both without a second code path.
   *
   * Set to `step` to switch it off, for a control whose values are genuinely
   * discrete.
   */
  fineStep?: number;
  /**
   * Values worth marking on the track.
   *
   * Reference marks, not magnets: they say *where* a notable value is without
   * making the values beside it harder to reach. A snap would be the obvious
   * next thought and is the wrong one here — these are continuous quantities,
   * and a slider you cannot set to 51 because 50 keeps grabbing it is worse
   * than one with no marks at all. Double-click already returns to the origin
   * exactly, which is the case a magnet is usually trying to serve.
   *
   * The origin is always marked and does not need listing.
   */
  ticks?: number[];
  /**
   * Let the readout be typed into. On by default.
   *
   * The one thing a track cannot do is *exactly 24*. Turning the number into a
   * field costs nothing at rest — it looks like the readout it replaced — and
   * closes the gap that otherwise sends people to a second control.
   */
  editable?: boolean;
}

/**
 * A slider with a real track.
 *
 * The ranges in this codebase were bare `input[type="range"]` elements with
 * inline styles, so they inherited each browser's default track and thumb —
 * which do not follow the theme, do not follow the focus ring, and do not look
 * like each other across platforms. This is the primitive they all become.
 *
 * The native input is kept underneath rather than rebuilt from pointer events,
 * because it brings arrow keys, Home/End, Page Up/Down, the correct ARIA role
 * and value announcements for free — the same reasoning as the audio
 * waveform's `role="slider"`, arrived at the other way round.
 *
 * ## Why the track is drawn by us and the input's own is transparent
 *
 * A native range paints its track as a shadow part, *under* the thumb and over
 * everything else in the element. Anything else that belongs on the track —
 * tick marks, in this case — cannot be layered between the two, because there
 * is nothing to layer into: the thumb and track are the browser's, not the
 * document's. Painting the track ourselves and leaving only the thumb native
 * keeps every behaviour the input provides and puts the ordering back in the
 * document's hands.
 */
export const Slider: React.FC<Props> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  labelHidden,
  origin,
  unit = '',
  format,
  accent,
  hint,
  fineStep,
  ticks,
  editable = true,
}) => {
  const id = useId();
  const from = origin ?? min;
  const pct = (n: number) => ((n - min) / (max - min)) * 100;

  /**
   * Whether Shift is down, which changes the step under the drag *and* the
   * arrow keys.
   *
   * Watched on the window rather than on the input, because Shift is very
   * often released somewhere else — the pointer leaves the control mid-drag,
   * or focus moves — and a fine mode that sticks on is worse than none: the
   * slider would silently stop reaching its own extremes.
   */
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent | MouseEvent) => setFine(e.shiftKey);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('pointerdown', sync);
    // Focus leaving the window takes the key state with it, unobservably.
    const clear = () => setFine(false);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('pointerdown', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const activeStep = fine ? (fineStep ?? step / 10) : step;

  // The formatter owns the whole readout when there is one, sign included —
  // "1.25×" has no business gaining a leading plus.
  const readout = format
    ? format(value)
    : `${value > from && origin !== undefined ? '+' : ''}${round(value)}${unit}`;

  // The filled segment runs between the origin and the value, in either
  // direction, so a negative adjustment fills leftward from the middle.
  const a = Math.min(pct(from), pct(value));
  const b = Math.max(pct(from), pct(value));
  const isDefault = value === from;

  /**
   * Everything worth a mark, deduplicated.
   *
   * The origin is always one: on a bipolar control it is the value the fill is
   * measured from and the value a double-click returns to, and until now it
   * was the one position on the track with no way to see where it was.
   */
  const marks = [...new Set([from, ...(ticks ?? [])])].filter((n) => n > min && n < max);

  return (
    <div className="slider" data-tooltip={hint}>
      <label className={labelHidden ? 'sr-only' : 'slider__label'} htmlFor={id}>
        {label}
      </label>

      <span className="slider__rail">
        <span
          className="slider__track"
          aria-hidden="true"
          style={
            {
              '--slider-fill-start': `${a}%`,
              '--slider-fill-end': `${b}%`,
              ...(accent ? { '--slider-accent': accent } : {}),
            } as React.CSSProperties
          }
        />
        {marks.map((n) => (
          <span key={n} className="slider__tick" aria-hidden="true" style={{ left: `${pct(n)}%` }} />
        ))}
        <input
          id={id}
          type="range"
          className="slider__input"
          data-fine={fine || undefined}
          min={min}
          max={max}
          step={activeStep}
          value={value}
          aria-valuetext={readout}
          onChange={(e) => onChange(Number(e.target.value))}
          /* Double-click to reset is the convention every adjustment panel
             uses, and it is the only way back to exactly the neutral value
             with a pointer — dragging lands on 1 or -1 as often as on 0. */
          onDoubleClick={() => onChange(from)}
          style={accent ? ({ '--slider-accent': accent, accentColor: accent } as React.CSSProperties) : undefined}
        />
      </span>

      {editable && !format ? (
        <SliderField
          value={round(value)}
          unit={unit}
          label={label}
          isDefault={isDefault}
          min={min}
          max={max}
          onCommit={onChange}
        />
      ) : (
        <output className="slider__value" data-default={isDefault} htmlFor={id}>
          {readout}
        </output>
      )}
    </div>
  );
};

/** Two decimals at most. A drag produces `0.30000000000000004` otherwise. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The readout, typed into.
 *
 * Held locally while it has focus and adopted from the prop otherwise, which
 * is the same arrangement `NumberStepper` uses and for the same reason: a
 * controlled field that rewrites itself on every keystroke cannot be typed
 * into, because "1" on its way to "12" is clamped to the minimum first.
 *
 * Commits on Enter and on blur, and abandons on Escape — the three exits, so
 * none of them is a surprise.
 */
const SliderField: React.FC<{
  value: number;
  unit: string;
  label: string;
  isDefault: boolean;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}> = ({ value, unit, label, isDefault, min, max, onCommit }) => {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)));
    else setText(String(value));
  };

  return (
    <input
      className="slider__value"
      data-default={isDefault}
      type="text"
      inputMode="decimal"
      aria-label={`${label} value`}
      value={focused.current ? text : `${text}${unit}`}
      onFocus={(e) => {
        focused.current = true;
        // The unit comes off while editing: it is a label on the number, not
        // part of it, and leaving it there means every edit starts by deleting
        // two characters.
        setText(String(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setText(String(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
};
