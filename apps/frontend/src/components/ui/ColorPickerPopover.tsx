import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPanel } from './ColorPanel';
import { PORTAL_SURFACE_ATTR } from './portalSurface';
import { useFloatingPanel } from './useFloatingPanel';
import { withAlpha } from '../../engine/model/paint';

interface Props {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  /**
   * The selected objects disagree on this colour. The trigger shows three
   * bands rather than one of the values, which would be a claim none of them
   * makes.
   */
  mixed?: boolean;
  /**
   * The colour's own alpha, 0..1, where the value being edited has somewhere
   * to store one. Only a solid fill's paint and a gradient stop carry
   * `opacity`; an alpha slider over a plain hex string would write nowhere.
   */
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  /** The surface this colour will be read on, which turns on the contrast readout. */
  contrastAgainst?: string;
  /** Offer "none". On by default, which is what every existing caller had. */
  allowNone?: boolean;
}

/** The chequerboard that says "see-through" rather than "grey". */
const CHECKER = 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';
const NONE =
  `linear-gradient(to top right, transparent calc(50% - 1.5px), #EF4444 calc(50% - 1.5px), #EF4444 calc(50% + 1.5px), transparent calc(50% + 1.5px)), ${CHECKER}`;
const MIXED = 'linear-gradient(135deg, #EF4444 0 33%, #3B82F6 33% 66%, #F59E0B 66% 100%)';

/**
 * A swatch that opens the colour picker beside it.
 *
 * The picker is `ColorPanel`; the placement, dismissal and re-placement are
 * `useFloatingPanel`, shared with the fill editor so the two floating colour
 * surfaces in the app cannot come to disagree about where they go.
 */
export const ColorPickerPopover: React.FC<Props> = ({
  color,
  onChange,
  label,
  mixed = false,
  opacity,
  onOpacityChange,
  contrastAgainst,
  allowNone = true,
}) => {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const spot = useFloatingPanel({ open, trigger, panel, onClose: close });

  const isNone = color === 'transparent' || opacity === 0;
  const alpha = isNone ? 0 : opacity ?? 1;
  const background = mixed
    ? MIXED
    : isNone
      ? NONE
      : alpha < 1
        ? `linear-gradient(${withAlpha(color, alpha)}, ${withAlpha(color, alpha)}), ${CHECKER}`
        : color;

  return (
    <div className="cpx-anchor">
      {label && <span className="cpx-anchor__label">{label}</span>}
      <button
        ref={setTrigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={mixed ? 'Mixed colours. Open the colour picker' : isNone ? 'No colour. Open the colour picker' : `Colour ${color}. Open the colour picker`}
        onClick={() => setOpen((v) => !v)}
        className={`cp-trigger${open ? ' is-open' : ''}`}
        style={{ background }}
      />
      {open &&
        createPortal(
          <div
            ref={setPanel}
            role="dialog"
            aria-label="Colour picker"
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
              color={color}
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
