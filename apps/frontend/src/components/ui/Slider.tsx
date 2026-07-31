import React, { useId } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
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
  origin,
  unit = '',
}) => {
  const id = useId();
  const from = origin ?? min;
  const pct = (n: number) => ((n - min) / (max - min)) * 100;

  // The filled segment runs between the origin and the value, in either
  // direction, so a negative adjustment fills leftward from the middle.
  const a = Math.min(pct(from), pct(value));
  const b = Math.max(pct(from), pct(value));
  const isDefault = value === from;

  return (
    <div className="slider">
      <label className="slider__label" htmlFor={id}>
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
        aria-valuetext={`${value}${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
        /* Double-click to reset is the convention every adjustment panel
           uses, and it is the only way back to exactly the neutral value
           with a pointer — dragging lands on 1 or -1 as often as on 0. */
        onDoubleClick={() => onChange(from)}
        style={
          {
            '--slider-fill-start': `${a}%`,
            '--slider-fill-end': `${b}%`,
          } as React.CSSProperties
        }
      />
      <output className="slider__value" data-default={isDefault} htmlFor={id}>
        {value > from && origin !== undefined ? '+' : ''}
        {value}
        {unit}
      </output>
    </div>
  );
};
