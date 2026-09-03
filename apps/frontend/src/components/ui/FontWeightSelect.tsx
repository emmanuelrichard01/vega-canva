import React from 'react';
import ReactDOM from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { weightName, weightsFor } from '../../engine/text/fontCatalogue';
import { PORTAL_SURFACE_ATTR, isInsidePortalSurface } from './portalSurface';

/**
 * The weight, chosen by name, from the weights the face actually has.
 *
 * ## Why this replaced a Bold toggle
 *
 * `Typography.fontWeight` has always been a number and the renderer has always
 * forwarded it, but the only control was a Bold button writing `700` or `400`.
 * Seven of the nine weights every variable face carries were unreachable —
 * present in the model, drawn correctly if a document happened to contain them,
 * and impossible to ask for.
 *
 * ## Why the list is per-family
 *
 * A weight a face does not have is **synthesised**: the browser thickens or
 * thins the outlines and draws something that is no longer the typeface. It
 * renders, it looks like type, and nothing reports it. Bebas Neue has one
 * weight; a picker offering it nine is lying eight times. The options come from
 * `fontCatalogue`, where they were read off each family's own stylesheet.
 *
 * ## Why this is a popover and not a `<select>`
 *
 * It was a native `<select>` first, and the reasoning was that nine short words
 * need keyboard behaviour and the platform's overlay more than they need
 * custom drawing. That was wrong about what the list is for.
 *
 * "Semi Bold" is a name for something you are trying to **see**, and the
 * difference between 500 and 600 is genuinely hard to describe and instant to
 * look at. Rendering each row at the weight it names — in the family in hand —
 * turns the list into a specimen sheet, which is the whole reason to open it.
 * Only Firefox styles `<option>` text, so a native control can show that to
 * roughly no one.
 *
 * It borrows the font picker's own popover classes rather than inventing a
 * second look, because these two controls sit on adjacent lines and are the
 * same gesture asked twice.
 */
export const FontWeightSelect: React.FC<{
  family: string;
  value: number;
  mixed?: boolean;
  onChange: (weight: number) => void;
}> = ({ family, value, mixed, onChange }) => {
  const weights = weightsFor(family);
  const only = weights.length === 1;

  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);

  const place = React.useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    if (!t) return;
    const width = Math.max(150, t.width);
    const height = popRef.current?.offsetHeight ?? weights.length * 30 + 8;
    const margin = 8;
    let top = t.bottom + 4;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, t.top - height - 4);
    let left = t.left;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - width - margin);
    setPos({ top, left, width });
  }, [weights.length]);

  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return;
    const i = weights.indexOf(value);
    setCursor(i >= 0 ? i : 0);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t) || isInsidePortalSurface(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, weights, value]);

  const pick = (w: number) => {
    onChange(w);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((c) => (c + step + weights.length) % weights.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(weights[cursor]);
    }
  };

  const label = mixed ? 'Mixed' : weightName(value);

  return (
    <div className="field weight-field">
      <button
        ref={triggerRef}
        type="button"
        className="weight-trigger"
        disabled={only}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Font weight: ${label}`}
        // The one case a disabled control has to explain itself: it is not off
        // because something is wrong, it is off because this face has one
        // weight and there is nothing to choose between.
        title={only ? `${family} has one weight` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {/* The trigger is itself a specimen: it names the weight *in* it. */}
        <span
          className="weight-trigger__name"
          style={{ fontFamily: canvasFontFamily(family), fontWeight: mixed ? 400 : value }}
        >
          {label}
        </span>
        {!only && <ChevronDown size={13} aria-hidden="true" className="weight-trigger__chev" />}
      </button>

      {open &&
        pos &&
        ReactDOM.createPortal(
          <div
            ref={popRef}
            {...{ [PORTAL_SURFACE_ATTR]: 'true' }}
            className="font-menu weight-menu panel-surface"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onKeyDown={onKey}
          >
            <div className="font-menu__list custom-scrollbar" role="listbox" aria-label="Font weight">
              {weights.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  role="option"
                  aria-selected={w === value}
                  className="font-row"
                  data-on={w === value || undefined}
                  data-active={i === cursor || undefined}
                  onClick={() => pick(w)}
                  onMouseEnter={() => setCursor(i)}
                >
                  <span
                    className="font-row__name"
                    style={{ fontFamily: canvasFontFamily(family), fontWeight: w }}
                  >
                    {weightName(w)}
                  </span>
                  {/* The number, quietly. It is what is stored and what CSS
                      takes, so somebody reading a document or writing a style
                      elsewhere needs it — but the name is what the control is
                      for, so it sits where the font list keeps its specimen. */}
                  <span className="font-row__spec weight-row__num">{w}</span>
                  {w === value && <Check size={13} className="font-row__tick" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
