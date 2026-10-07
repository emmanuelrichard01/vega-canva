import React from 'react';

export interface Specimen<V extends string = string> {
  value: V;
  label: string;
  /** Draws the option at the picker's tile size. */
  render: (size: number) => React.ReactNode;
}

export interface SpecimenPickerProps<V extends string = string> {
  label: string;
  value: V | 'mixed';
  options: Specimen<V>[];
  size?: 32 | 48;
  onChange: (value: V) => void;
}

/**
 * A choice made by looking: stroke styles, end caps, themes.
 *
 * Fixed tile sizes, so the proportion inside a tile is the information. The
 * chosen tile takes an ink ring; a mixed selection rings none, because "make
 * these disagree" is not an option anyone can pick.
 */
export function SpecimenPicker<V extends string = string>({ label, value, options, size = 32, onChange }: SpecimenPickerProps<V>) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1 + options.length) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (Math.max(idx, 0) - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    const tiles = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    tiles[next]?.focus();
  };
  return (
    <div className="pg-specimens" role="radiogroup" aria-label={label} data-size={size} onKeyDown={onKey}>
      {options.map((o, i) => {
        const active = value !== 'mixed' && o.value === value;
        const tabbable = active || (value === 'mixed' && i === 0) || (!options.some((x) => x.value === value) && i === 0);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            data-tooltip={o.label}
            tabIndex={tabbable ? 0 : -1}
            className="pg-specimen"
            onClick={() => onChange(o.value)}
          >
            {o.render(size)}
          </button>
        );
      })}
    </div>
  );
}
