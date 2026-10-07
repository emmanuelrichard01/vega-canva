import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPanel } from '../../ui/ColorPanel';
import { PORTAL_SURFACE_ATTR } from '../../ui/portalSurface';
import { useFloatingPanel } from '../../ui/useFloatingPanel';
import { withAlpha } from '../../../engine/model/paint';

export interface ColorChipProps {
  /** What the colour is for, e.g. "Fill". Names the control and the picker. */
  label: string;
  value: string | 'mixed';
  /** 0–1. Shown as a percentage beside the hex when given. */
  opacity?: number;
  onChange: (color: string) => void;
  onOpacityChange?: (opacity: number) => void;
  allowNone?: boolean;
  contrastAgainst?: string;
  /**
   * Replaces the swatch, for a paint that opens a richer editor than the
   * colour picker (a fill that may become a gradient).
   */
  swatch?: React.ReactNode;
  /** The picker opened or closed. */
  onOpenChange?: (open: boolean) => void;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexOf(value: string): string {
  if (value === 'transparent') return 'None';
  const v = value.trim();
  return v.startsWith('#') ? v.slice(1).toUpperCase() : v.toUpperCase();
}

/**
 * A colour in one 28px field: the swatch, its hex, its opacity.
 *
 * The swatch opens the full picker; the hex is typed in place, so a known
 * colour is one click and six keystrokes away.
 */
export const ColorChip: React.FC<ColorChipProps> = ({
  label,
  value,
  opacity,
  onChange,
  onOpacityChange,
  allowNone = true,
  contrastAgainst,
  swatch,
  onOpenChange,
}) => {
  const mixed = value === 'mixed';
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => onOpenChange?.(open), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const spot = useFloatingPanel({ open, trigger, panel, onClose: close });

  const [hexDraft, setHexDraft] = useState(mixed ? '' : hexOf(value));
  const [pctDraft, setPctDraft] = useState(opacity == null ? '' : String(Math.round(opacity * 100)));
  useEffect(() => setHexDraft(mixed ? '' : hexOf(value)), [value, mixed]);
  useEffect(() => setPctDraft(opacity == null ? '' : String(Math.round(opacity * 100))), [opacity]);

  const isNone = !mixed && (value === 'transparent' || opacity === 0);
  const alpha = isNone ? 0 : opacity ?? 1;
  const swatchClass = mixed ? 'pg-color__swatch is-mixed' : isNone ? 'pg-color__swatch is-none' : 'pg-color__swatch';
  const swatchStyle =
    mixed || isNone ? undefined : ({ '--swatch': alpha < 1 ? withAlpha(value, alpha) : value } as React.CSSProperties);

  const commitHex = () => {
    const t = hexDraft.trim();
    if (HEX.test(t)) {
      const h = t.replace('#', '');
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const next = `#${full.toLowerCase()}`;
      if (next !== value) onChange(next);
      setHexDraft(full.toUpperCase());
    } else {
      setHexDraft(mixed ? '' : hexOf(value));
    }
  };

  const commitPct = () => {
    const n = parseFloat(pctDraft);
    if (!onOpacityChange || !Number.isFinite(n)) {
      setPctDraft(opacity == null ? '' : String(Math.round(opacity * 100)));
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(n)));
    if (clamped / 100 !== opacity) onOpacityChange(clamped / 100);
    setPctDraft(String(clamped));
  };

  const keys = (commit: () => void, reset: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      reset();
      e.currentTarget.blur();
    }
  };

  return (
    <div className="pg-color" data-open={open || undefined}>
      {swatch ?? <button
        ref={setTrigger}
        type="button"
        className={swatchClass}
        style={swatchStyle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={mixed ? `${label}: mixed. Open the colour picker` : `${label}: ${hexOf(value)}. Open the colour picker`}
        onClick={() => setOpen((v) => !v)}
      />}
      <input
        className="pg-color__hex"
        aria-label={`${label} hex`}
        value={hexDraft}
        placeholder={mixed ? 'Mixed' : undefined}
        spellCheck={false}
        maxLength={7}
        onChange={(e) => setHexDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commitHex}
        onKeyDown={keys(commitHex, () => setHexDraft(mixed ? '' : hexOf(value)))}
      />
      {onOpacityChange && (
        <span className="pg-color__pct">
          <input
            className="pg-color__pct-input"
            aria-label={`${label} opacity`}
            inputMode="numeric"
            value={pctDraft}
            onChange={(e) => setPctDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitPct}
            onKeyDown={keys(commitPct, () => setPctDraft(opacity == null ? '' : String(Math.round(opacity * 100))))}
          />
          <span aria-hidden="true">%</span>
        </span>
      )}
      {open &&
        createPortal(
          <div
            ref={setPanel}
            role="dialog"
            aria-label={`${label} colour`}
            {...{ [PORTAL_SURFACE_ATTR]: 'color-picker' }}
            className="cpx-popover"
            data-side={spot?.side}
            style={{
              left: spot?.x ?? 0,
              top: spot?.y ?? 0,
              maxHeight: spot?.maxHeight,
              visibility: spot ? 'visible' : 'hidden',
            }}
          >
            <ColorPanel
              color={mixed ? '#000000' : value}
              onChange={onChange}
              alpha={onOpacityChange ? opacity ?? 1 : undefined}
              onAlphaChange={onOpacityChange}
              allowNone={allowNone}
              contrastAgainst={contrastAgainst}
            />
          </div>,
          document.body
        )}
    </div>
  );
};
