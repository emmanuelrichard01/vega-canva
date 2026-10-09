import React, { useRef, useState } from 'react';
import { ChevronDown, Minus } from 'lucide-react';
import { NumberField, type NumberFieldChange } from '../grammar';
import { Menu } from '../../menu/Menu';
import type { MenuEntry } from '../../menu/menuModel';
import {
  MAX_STROKE_WEIGHT,
  MIN_STROKE_WEIGHT,
  STROKE_WEIGHTS,
  STROKE_WEIGHT_COARSE_STEP,
  STROKE_WEIGHT_STEP,
  STROKE_WEIGHT_UNIT,
  formatWeight,
} from '../../toolbar/rail/strokeDefaults';
import './strokeWeight.css';

/**
 * A line drawn at the weight it names, at one CSS pixel per unit.
 *
 * Deliberately not floored: a 0.25 specimen is drawn as a quarter of a pixel
 * and comes out faint on a 1× screen, which is the honest preview of what a
 * hairline is. The number beside it carries the exact value.
 */
export const WeightSpecimen: React.FC<{ width: number }> = ({ width }) => (
  <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
    <line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" strokeWidth={Math.min(width, 10)} />
  </svg>
);

/**
 * Stroke weight with Illustrator's fine control.
 *
 * - type any weight to two decimals (0.3 is a weight; the presets are only
 *   the common ones);
 * - ↑/↓ step a quarter, Shift+↑/↓ a whole unit;
 * - drag the glyph to scrub (one undo step), Shift for coarse, Alt for fine;
 * - the chevron opens the scale, each step drawn at its weight.
 *
 * The scale and the limits come from `strokeDefaults`, which the rail's
 * stroke control reads too, so the two offer the same numbers.
 */
export const StrokeWeightField: React.FC<{
  value: number | 'mixed';
  onChange: (width: number, change: NumberFieldChange) => void;
  /** Show the preset menu beside the field. */
  presets?: boolean;
  label?: string;
  disabledReason?: string;
}> = ({ value, onChange, presets = true, label = 'Stroke weight', disabledReason }) => {
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const entries: MenuEntry[] = STROKE_WEIGHTS.map((w) => ({
    kind: 'item',
    id: String(w),
    label: `${formatWeight(w)} ${STROKE_WEIGHT_UNIT}`,
    icon: <WeightSpecimen width={w} />,
    radio: true,
    checked: value !== 'mixed' && Math.abs(value - w) < 1e-6,
    onSelect: () => onChange(w, { commit: true }),
  }));

  return (
    <div className="pg-weight">
      <NumberField
        label={label}
        glyph={<Minus size={13} strokeWidth={3} />}
        unit={STROKE_WEIGHT_UNIT}
        min={MIN_STROKE_WEIGHT}
        max={MAX_STROKE_WEIGHT}
        step={STROKE_WEIGHT_STEP}
        coarseStep={STROKE_WEIGHT_COARSE_STEP}
        value={value}
        disabledReason={disabledReason}
        onChange={onChange}
      />
      {presets && (
        <>
          <button
            ref={button}
            type="button"
            className="pg-icon-btn pg-weight__more"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${label} presets`}
            data-tooltip="Weights"
            disabled={Boolean(disabledReason)}
            onClick={() => {
              setKeyboard(false);
              setOpen((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setKeyboard(true);
                setOpen(true);
              }
            }}
          >
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {open && button.current && (
            <Menu
              entries={entries}
              label={`${label} presets`}
              anchor={{ kind: 'rect', rect: button.current.getBoundingClientRect(), align: 'end' }}
              focusFirst={keyboard}
              onClose={() => {
                setOpen(false);
                button.current?.focus();
              }}
            />
          )}
        </>
      )}
    </div>
  );
};
