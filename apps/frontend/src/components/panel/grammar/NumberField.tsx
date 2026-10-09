import React from 'react';
import { NumberStepper } from '../../ui/NumberStepper';
import { beginPreview, endPreview } from './previewSession';

export interface NumberFieldChange {
  /**
   * True for a value the person settled on (Enter, blur, an arrow, the end of
   * a scrub); false for an intermediate value during a scrub. Writes made
   * through the panel's `writePatches` during a scrub are previews that leave
   * no undo history, so a consumer may write on every call. A consumer that
   * writes some other way should write on commits only.
   */
  commit: boolean;
}

export interface NumberFieldProps {
  /** The field's name for assistive technology, and its tooltip. */
  label: string;
  value: number | 'mixed';
  onChange: (value: number, change: NumberFieldChange) => void;
  /** A letter or icon inside the field, and the handle you scrub. */
  glyph?: React.ReactNode;
  min?: number;
  max?: number;
  step?: number;
  /** What Shift+↑/↓ moves by; ten steps when absent. */
  coarseStep?: number;
  precision?: number;
  unit?: string;
  scrub?: boolean;
  /** On a mixed field, move each object by the delta instead of flattening them. */
  onNudge?: (delta: number) => void;
  disabledReason?: string;
}

/**
 * A number in a field one control tall: type it, step it with ↑ and ↓, or scrub it by
 * dragging the glyph. A scrub previews live on the board and lands as one
 * undo step; on a mixed field it moves every object by the same amount.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  onChange,
  glyph,
  min,
  max,
  step,
  coarseStep,
  precision,
  unit,
  scrub = true,
  onNudge,
  disabledReason,
}) => {
  const mixed = value === 'mixed';
  // A letter sits inside the field like an icon does, so every field in a
  // column starts its number on the same line and the letter is the scrub handle.
  const icon = typeof glyph === 'string' ? <span className="pg-glyph-text">{glyph}</span> : glyph;
  return (
    <NumberStepper
      aria-label={label}
      glyph={icon}
      value={mixed ? 0 : value}
      mixed={mixed}
      min={min}
      max={max}
      step={step}
      coarseStep={coarseStep}
      precision={precision}
      suffix={unit}
      scrub={scrub}
      disabledReason={disabledReason}
      onNudge={onNudge}
      onChange={(v) => onChange(v, { commit: true })}
      onPreview={(v) => onChange(v, { commit: false })}
      onNudgePreview={onNudge}
      onScrubStart={beginPreview}
      onScrubEnd={() => endPreview()}
    />
  );
};
