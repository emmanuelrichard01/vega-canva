import React from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { normalizeHex } from '../engine/model/color';
import { PORTAL_SURFACE_ATTR } from './ui/portalSurface';

/**
 * A series' colour, chosen from the chart's own palette.
 *
 * ## Why not the app's colour picker
 *
 * Two reasons, and the second is the one that matters.
 *
 * The first was a bug: the shared picker portals to `body` and sat at the
 * context-menu layer, while a dialog's scrim is higher — so opening it from
 * inside the data sheet put it *behind* the sheet, on the canvas, visible
 * through the scrim and unreachable. That is fixed at the layer, not here,
 * because it made the picker unusable above every dialog in the app and not
 * just this one.
 *
 * The second is that a full picker is the wrong control for this job anyway.
 * Choosing a series colour from sixteen million is how a chart ends up with
 * two series a shade apart and a third that fights both. A series belongs to
 * a *set*, and the set is the palette the chart is already using — so that is
 * what this offers, in palette order, with the position each series would
 * take by default marked.
 *
 * An arbitrary colour is still reachable through the hex field, because
 * "match our brand red exactly" is a real requirement and refusing it would
 * be tidiness at somebody else's expense.
 *
 * ## Self-contained on purpose
 *
 * No nested popover. A picker opened from a popover opened from a dialog is
 * three stacking contexts deep, and that is the shape of problem this control
 * exists because of.
 */

interface Props {
  /** The colour now, resolved — never undefined, so the swatch always shows. */
  value: string;
  /** The chart's palette, in order. */
  palette: readonly string[];
  /** Where this series sits in the palette when it has no colour of its own. */
  defaultIndex: number;
  /** `undefined` puts the series back on the palette. */
  onChange: (color: string | undefined) => void;
  label: string;
}

export const SeriesSwatch: React.FC<Props> = ({
  value,
  palette,
  defaultIndex,
  onChange,
  label,
}) => {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState<{ top: number; left: number } | null>(null);
  const [hex, setHex] = React.useState('');
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  const WIDTH = 188;

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      const height = surfaceRef.current?.offsetHeight ?? 160;
      const margin = 8;
      let top = t.bottom + 6;
      if (top + height > window.innerHeight - margin) top = t.top - height - 6;
      top = Math.max(margin, top);
      let left = t.left;
      left = Math.min(left, window.innerWidth - WIDTH - margin);
      left = Math.max(margin, left);
      setAt({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setHex(value);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stopped, so the dialog behind does not also close.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, value]);

  const commitHex = () => {
    const normalized = normalizeHex(hex);
    if (normalized) onChange(normalized);
    else setHex(value);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="swatch"
        aria-label={`Colour of ${label}`}
        aria-expanded={open}
        style={{ background: value }}
        onClick={() => setOpen((v) => !v)}
      />

      {open &&
        at &&
        createPortal(
          <div
            ref={surfaceRef}
            className="swatch__pop"
            role="dialog"
            aria-label={`Colour of ${label}`}
            style={{ top: at.top, left: at.left, width: WIDTH }}
            {...{ [PORTAL_SURFACE_ATTR]: 'series-swatch' }}
          >
            <div className="swatch__grid">
              {palette.map((colour, i) => {
                const chosen = colour.toLowerCase() === value.toLowerCase();
                return (
                  <button
                    key={`${colour}-${i}`}
                    type="button"
                    className="swatch__cell"
                    data-chosen={chosen || undefined}
                    // Marks the slot this series would take on its own, so
                    // "put it back" is a place rather than an abstraction.
                    data-default={i === defaultIndex || undefined}
                    style={{ background: colour }}
                    aria-label={colour}
                    onClick={() => {
                      // Choosing the palette's own colour for this slot clears
                      // the override rather than freezing today's palette onto
                      // the series -- so changing palette still moves it.
                      onChange(i === defaultIndex ? undefined : colour);
                      setOpen(false);
                    }}
                  >
                    {chosen && <Check size={11} />}
                  </button>
                );
              })}
            </div>

            <label className="swatch__hex">
              <span>Hex</span>
              <input
                value={hex}
                spellCheck={false}
                onChange={(e) => setHex(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitHex();
                    setOpen(false);
                  }
                }}
              />
            </label>

            <button
              type="button"
              className="swatch__reset"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Use the palette
            </button>
          </div>,
          document.body
        )}
    </>
  );
};
