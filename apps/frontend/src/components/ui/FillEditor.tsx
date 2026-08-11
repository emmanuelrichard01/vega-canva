import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { EyedropperButton } from './EyedropperButton';
import {
  convertPaint,
  isGradient,
  linearAngle,
  paintToCss,
  sortedStops,
  withLinearAngle,
  type GradientStop,
  type Paint,
  type PaintType,
} from '../../engine/model/paint';

interface Props {
  paint: Paint | undefined;
  onChange: (paint: Paint) => void;
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
export const FillEditor: React.FC<Props> = ({ paint, onChange }) => {
  const [open, setOpen] = useState(false);
  const [activeStop, setActiveStop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current: Paint = paint ?? { type: 'solid', color: '#4F46E5' };
  const stops = isGradient(current) ? sortedStops(current) : [];
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
    const next = [...stops, { offset: bestAt, color: before?.color ?? '#6366F1', opacity: before?.opacity }];
    next.sort((a, b) => a.offset - b.offset);
    setStops(next);
    setActiveStop(next.findIndex((s) => s.offset === bestAt));
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

  // Dragging is tracked on the window, not the handle: the pointer routinely
  // leaves a 12px dot during a drag, and a handler on the dot would drop the
  // gesture the moment it did.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const index = draggingRef.current;
      if (index === null) return;
      patchStop(index, { offset: offsetFromEvent(e.clientX) });
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  const css = paintToCss(current);

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Edit fill"
        className="fill-swatch"
      >
        {/* The paint sits on a chequerboard the button itself draws. A
            semi-transparent fill shown over a flat panel is indistinguishable
            from an opaque paler one. */}
        <span style={{ background: css }} />
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
            <label className="fill-editor__row">
              <span className="fill-editor__label">Colour</span>
              <input
                type="color"
                value={current.color || '#4F46E5'}
                onChange={(e) => onChange({ ...current, color: e.target.value })}
                className="fill-editor__color"
              />
              <EyedropperButton onPick={(color) => onChange({ ...current, color })} />
            </label>
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
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${stops
                      .map((s) => `${s.color} ${s.offset * 100}%`)
                      .join(', ')})`,
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
                    style={{ left: `${stop.offset * 100}%`, background: stop.color }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setActiveStop(i);
                      draggingRef.current = i;
                    }}
                  />
                ))}
              </div>

              <div className="fill-editor__row">
                <input
                  type="color"
                  value={stops[selected]?.color ?? '#6366F1'}
                  onChange={(e) => patchStop(selected, { color: e.target.value })}
                  className="fill-editor__color"
                  aria-label="Stop colour"
                />
                <EyedropperButton
                  label="Pick this stop's colour from the screen"
                  onPick={(color) => patchStop(selected, { color })}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((stops[selected]?.opacity ?? 1) * 100)}
                  onChange={(e) => patchStop(selected, { opacity: Number(e.target.value) / 100 })}
                  className="fill-editor__alpha"
                  aria-label="Stop opacity"
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
