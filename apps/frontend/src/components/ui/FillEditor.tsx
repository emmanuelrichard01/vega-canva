import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { EyedropperButton } from './EyedropperButton';
import { ColorPickerPopover } from './ColorPickerPopover';
import { isInsidePortalSurface } from './portalSurface';
import {
  convertPaint,
  isGradient,
  linearAngle,
  paintToCss,
  withAlpha,
  withLinearAngle,
  type GradientStop,
  type Paint,
  type PaintType,
} from '../../engine/model/paint';

interface Props {
  paint: Paint | undefined;
  onChange: (paint: Paint) => void;
  /**
   * The selected objects have different fills.
   *
   * Needed because `paint: undefined` cannot express it: undefined already
   * means "no fill set", and both fall through to the indigo default below —
   * so three objects filled red, blue and orange showed a single purple
   * swatch, which is a colour none of them has and which the next click would
   * have made true.
   */
  mixed?: boolean;
}

/**
 * The five kinds, in the order they escalate.
 *
 * Each icon is the gradient itself rather than a glyph standing for it: a
 * picker for a visual property whose options are described in words is a
 * picker you read instead of recognise, and these five are trivially
 * distinguishable at 20px when they are simply drawn.
 */
const TYPES: Array<{ id: PaintType; label: string; swatch: string }> = [
  { id: 'solid', label: 'Solid', swatch: '#6366F1' },
  { id: 'linear', label: 'Linear', swatch: 'linear-gradient(180deg, #6366F1, #EC4899)' },
  { id: 'radial', label: 'Radial', swatch: 'radial-gradient(circle at 50% 50%, #6366F1, #EC4899)' },
  { id: 'conic', label: 'Angular', swatch: 'conic-gradient(from 0deg at 50% 50%, #6366F1, #EC4899, #6366F1)' },
  { id: 'diamond', label: 'Diamond', swatch: 'radial-gradient(ellipse 50% 50% at 50% 50%, #6366F1, #EC4899)' },
];

/** The most stops worth having in a panel this size. */
const MAX_STOPS = 8;

/**
 * What a swatch shows when the selection disagrees.
 *
 * Three bands rather than a blend: a blend is itself a colour, and would read
 * as one of the fills rather than as the absence of a single answer.
 */
const MIXED_SWATCH = 'linear-gradient(135deg, #EF4444 0 33%, #3B82F6 33% 66%, #F59E0B 66% 100%)';

/** Behind every gradient preview, so transparency reads as transparency. */
const BAR_CHECKER = 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';

/**
 * Editing a fill.
 *
 * Replaces a bare colour swatch, which was the whole fill interface and the
 * reason every shape on every board is a flat colour.
 *
 * The gradient bar is the control, not a preview: the stops sit on the thing
 * they describe, at the position they describe, and dragging one moves it.
 * A list of offsets in a table would be the same data and none of the
 * information — you cannot see that two stops are too close together by
 * reading `0.42` and `0.48`.
 */
export const FillEditor: React.FC<Props> = ({ paint, onChange, mixed = false }) => {
  const [open, setOpen] = useState(false);
  const [activeStop, setActiveStop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // A portalled child — the colour picker — is not inside this container in
      // the DOM, but it is emphatically inside this control.
      if (isInsidePortalSurface(e.target)) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current: Paint = paint ?? { type: 'solid', color: '#4F46E5' };
  /**
   * The stops **in stored order**, not sorted.
   *
   * This used to be `sortedStops(current)`, and that one word is the whole
   * "gradients feel buggy" complaint. Selection and dragging are tracked by
   * index into this array; sorting it means an index stops referring to the
   * same stop the moment two stops cross. Drag the left stop past the middle
   * one and the sort reorders the array under the gesture, so from the next
   * frame you are dragging *the other* stop — the one that just inherited
   * index 0 — and the one you grabbed appears to snap away.
   *
   * Order only matters for the CSS gradient, which is sorted where it is
   * generated. The stored array is normalised once, on release, when no index
   * is live.
   */
  const stops = isGradient(current) ? current.stops : [];
  const selected = Math.min(activeStop, Math.max(0, stops.length - 1));

  const setStops = (next: GradientStop[]) => {
    if (!isGradient(current)) return;
    onChange({ ...current, stops: next });
  };

  const patchStop = (index: number, patch: Partial<GradientStop>) => {
    setStops(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  /**
   * Add a stop where there is most room for one.
   *
   * Appending at the end, or at the midpoint, drops a stop on top of an
   * existing one about as often as not — and two stops at the same offset are
   * indistinguishable in the bar, so the new one appears not to have been
   * added. The widest gap is where the user was going to drag it anyway.
   */
  const addStop = () => {
    if (stops.length >= MAX_STOPS) return;
    let bestAt = 0.5;
    let bestGap = -1;
    for (let i = 1; i < stops.length; i++) {
      const gap = stops[i].offset - stops[i - 1].offset;
      if (gap > bestGap) {
        bestGap = gap;
        bestAt = (stops[i].offset + stops[i - 1].offset) / 2;
      }
    }
    const before = stops.filter((s) => s.offset <= bestAt).pop() ?? stops[0];
    const added = { offset: bestAt, color: before?.color ?? '#6366F1', opacity: before?.opacity };
    const next = [...stops, added].sort((a, b) => a.offset - b.offset);
    setStops(next);
    // Located by identity, not by comparing offsets: two stops can legitimately
    // share one, and float equality against a midpoint that was just computed
    // is fragile even when they do not.
    setActiveStop(next.indexOf(added));
  };

  /** Two is the minimum a gradient can be; below that it is a solid colour. */
  const removeStop = (index: number) => {
    if (stops.length <= 2) return;
    setStops(stops.filter((_, i) => i !== index));
    setActiveStop(Math.max(0, index - 1));
  };

  const offsetFromEvent = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  /**
   * The live paint, readable from a listener that is only bound once.
   *
   * `current` is rebuilt on every render (`paint ?? {...}`), so depending on it
   * would re-register both window listeners every render — the same churn the
   * missing dependency array used to cause, arrived at from the opposite
   * direction. A ref updated during render gives the handlers today's values
   * without making them a reason to rebind.
   */
  const latest = useRef({ current, onChange });
  latest.current = { current, onChange };

  // Dragging is tracked on the window, not the handle: the pointer routinely
  // leaves a 12px dot during a drag, and a handler on the dot would drop the
  // gesture the moment it did.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const index = draggingRef.current;
      if (index === null) return;
      const { current: paintNow, onChange: commit } = latest.current;
      if (!isGradient(paintNow)) return;
      const offset = offsetFromEvent(e.clientX);
      commit({
        ...paintNow,
        stops: paintNow.stops.map((s, i) => (i === index ? { ...s, offset } : s)),
      });
    };
    const onUp = () => {
      const index = draggingRef.current;
      draggingRef.current = null;
      if (index === null) return;
      const { current: paintNow, onChange: commit } = latest.current;
      if (!isGradient(paintNow)) return;

      // Normalise once the gesture is over, when no index is live, and carry
      // the selection to wherever the stop it referred to has landed.
      const held = paintNow.stops[index];
      if (!held) return;
      const ordered = [...paintNow.stops].sort((a, b) => a.offset - b.offset);
      const movedTo = ordered.indexOf(held);
      commit({ ...paintNow, stops: ordered });
      if (movedTo >= 0) setActiveStop(movedTo);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const css = paintToCss(current);

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={mixed ? 'Edit fill — the selection has several' : 'Edit fill'}
        className="fill-swatch"
      >
        {/* The paint sits on a chequerboard the button itself draws. A
            semi-transparent fill shown over a flat panel is indistinguishable
            from an opaque paler one. */}
        <span style={{ background: mixed ? MIXED_SWATCH : css }} />
      </button>

      {open && (
        <div role="dialog" aria-label="Fill" className="fill-editor panel-surface">
          <div className="fill-editor__types" role="radiogroup" aria-label="Fill type">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={current.type === t.id}
                title={t.label}
                aria-label={t.label}
                className={`fill-editor__type ${current.type === t.id ? 'is-active' : ''}`}
                onClick={() => onChange(convertPaint(current, t.id))}
              >
                <span style={{ background: t.swatch }} />
              </button>
            ))}
          </div>

          {current.type === 'solid' ? (
            <div className="fill-editor__row">
              <span className="fill-editor__label">Colour</span>
              {/* The real picker, not the OS one. `input type=color` opens a
                  native dialog that ignores the app's theme, cannot show the
                  board's own colours, has no alpha that maps to `opacity`, and
                  on Windows is a modal that steals the pointer. */}
              <ColorPickerPopover
                color={current.color || '#4F46E5'}
                onChange={(color) => onChange({ ...current, color })}
                opacity={current.opacity ?? 1}
                onOpacityChange={(o) => onChange({ ...current, opacity: o >= 1 ? undefined : o })}
              />
              <EyedropperButton onPick={(color) => onChange({ ...current, color })} />
            </div>
          ) : (
            <>
              {/* The bar shows the gradient along its own axis, not as it will
                  appear on the shape — the stops are positioned on that axis,
                  and a bar that showed the rotated result would put them
                  somewhere other than where they are. */}
              <div className="fill-editor__bar-wrap">
                <div
                  ref={barRef}
                  className="fill-editor__bar"
                  /* Sorted here and only here: CSS clamps a stop that comes
                     after a later one, so the bar must be ordered even while
                     the array behind it is not.

                     `withAlpha` because the preview was blind to per-stop
                     opacity — a stop at 20% drew fully opaque in the editor and
                     translucent on the canvas, so the one control whose entire
                     job is showing you the gradient was the one thing not
                     showing it. The chequerboard is what separates a
                     transparent stop from a merely pale one. */
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${[...stops]
                      .sort((a, b) => a.offset - b.offset)
                      .map((s) => `${withAlpha(s.color, s.opacity)} ${s.offset * 100}%`)
                      .join(', ')}), ${BAR_CHECKER}`,
                  }}
                  onMouseDown={(e) => {
                    // A click on the bar itself moves the selected stop there,
                    // which is the same gesture as dragging it and saves the
                    // aim for a 12px target.
                    draggingRef.current = selected;
                    patchStop(selected, { offset: offsetFromEvent(e.clientX) });
                  }}
                />
                {stops.map((stop, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Stop ${i + 1} at ${Math.round(stop.offset * 100)}%`}
                    className={`fill-editor__stop ${i === selected ? 'is-active' : ''}`}
                    style={{
                      left: `${stop.offset * 100}%`,
                      background: `linear-gradient(${withAlpha(stop.color, stop.opacity)}, ${withAlpha(stop.color, stop.opacity)}), ${BAR_CHECKER}`,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setActiveStop(i);
                      draggingRef.current = i;
                    }}
                    // Arrow keys nudge, which is the only way to place a stop
                    // exactly: a 12px dot on a 180px bar cannot be aimed to the
                    // percent, and gradients are routinely built on round
                    // numbers.
                    onKeyDown={(e) => {
                      const step = e.shiftKey ? 0.1 : 0.01;
                      if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        patchStop(i, { offset: Math.max(0, stop.offset - step) });
                      } else if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        patchStop(i, { offset: Math.min(1, stop.offset + step) });
                      } else if ((e.key === 'Backspace' || e.key === 'Delete') && stops.length > 2) {
                        e.preventDefault();
                        removeStop(i);
                      }
                    }}
                  />
                ))}
              </div>

              <div className="fill-editor__row">
                {/* The same picker the solid fill uses, so a stop's colour is
                    chosen exactly like any other colour in the app — the
                    board's own swatches, recents, and an alpha slider that
                    writes the stop's `opacity`. This was a bare
                    `input type=color`: the OS dialog, no alpha at all, and a
                    separate unlabelled range slider beside it carrying the
                    opacity the picker could not express. */}
                <ColorPickerPopover
                  color={stops[selected]?.color ?? '#6366F1'}
                  onChange={(color) => patchStop(selected, { color })}
                  opacity={stops[selected]?.opacity ?? 1}
                  onOpacityChange={(o) => patchStop(selected, { opacity: o >= 1 ? undefined : o })}
                />
                <span className="fill-editor__value">
                  {Math.round((stops[selected]?.offset ?? 0) * 100)}%
                </span>
                <EyedropperButton
                  label="Pick this stop's colour from the screen"
                  onPick={(color) => patchStop(selected, { color })}
                />
                <button
                  type="button"
                  className="btn-icon"
                  onClick={addStop}
                  disabled={stops.length >= MAX_STOPS}
                  aria-label="Add stop"
                >
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeStop(selected)}
                  disabled={stops.length <= 2}
                  aria-label="Remove stop"
                >
                  <Minus size={13} />
                </button>
              </div>

              {current.type === 'linear' && (
                <label className="fill-editor__row">
                  <span className="fill-editor__label">Angle</span>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={Math.round(linearAngle(current))}
                    onChange={(e) => onChange(withLinearAngle(current, Number(e.target.value)))}
                  />
                  <span className="fill-editor__value">{Math.round(linearAngle(current))}°</span>
                </label>
              )}

              {current.type === 'conic' && (
                <label className="fill-editor__row">
                  <span className="fill-editor__label">Start</span>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={Math.round(current.angle)}
                    onChange={(e) => onChange({ ...current, angle: Number(e.target.value) })}
                  />
                  <span className="fill-editor__value">{Math.round(current.angle)}°</span>
                </label>
              )}

              {(current.type === 'radial' || current.type === 'diamond') && (
                <label className="fill-editor__row">
                  <span className="fill-editor__label">Size</span>
                  <input
                    type="range"
                    min={5}
                    max={150}
                    value={Math.round(current.radius * 100)}
                    onChange={(e) => onChange({ ...current, radius: Number(e.target.value) / 100 })}
                  />
                  <span className="fill-editor__value">{Math.round(current.radius * 100)}%</span>
                </label>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
