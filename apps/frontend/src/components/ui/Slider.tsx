import React, { useId } from 'react';

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
}

/**
 * A slider with a real track.
 *
 * The three ranges already in this codebase are bare `input[type="range"]`
 * elements with inline styles, so they inherit each browser's default track
 * and thumb — which do not follow the theme, do not follow the focus ring, and
 * do not look like each other across platforms. This is the primitive they
 * should all become; it is used by the image adjustments first.
 *
 * The native input is kept underneath rather than rebuilt from pointer events,
 * because it brings arrow keys, Home/End, Page Up/Down, the correct ARIA role
 * and value announcements for free — the same reasoning as the audio
 * waveform's `role="slider"`, arrived at the other way round.
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
}) => {
  const id = useId();
  const from = origin ?? min;
  const pct = (n: number) => ((n - min) / (max - min)) * 100;
  // The formatter owns the whole readout when there is one, sign included —
  // "1.25×" has no business gaining a leading plus.
  const readout = format
    ? format(value)
    : `${value > from && origin !== undefined ? '+' : ''}${value}${unit}`;

  // The filled segment runs between the origin and the value, in either
  // direction, so a negative adjustment fills leftward from the middle.
  const a = Math.min(pct(from), pct(value));
  const b = Math.max(pct(from), pct(value));
  const isDefault = value === from;

  return (
    <div className="slider" data-tooltip={hint}>
      <label className={labelHidden ? 'sr-only' : 'slider__label'} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={readout}
        aria-describedby={undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        /* Double-click to reset is the convention every adjustment panel
           uses, and it is the only way back to exactly the neutral value
           with a pointer — dragging lands on 1 or -1 as often as on 0. */
        onDoubleClick={() => onChange(from)}
        style={
          {
            '--slider-fill-start': `${a}%`,
            '--slider-fill-end': `${b}%`,
            ...(accent ? { '--slider-accent': accent, accentColor: accent } : {}),
          } as React.CSSProperties
        }
      />
      <output className="slider__value" data-default={isDefault} htmlFor={id}>
        {readout}
      </output>
    </div>
  );
};
