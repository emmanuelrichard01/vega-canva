import React, { useEffect, useRef } from 'react';
import { Droplet } from 'lucide-react';
import { applyNodePatches, undoManager } from '../../../engine/document';
import { HACHURE_ANGLE, SHADING_DENSITIES } from '../../../engine/model/rough';
import {
  FILL_STYLE_LABELS,
  SHADING_DENSITY_HINTS,
  SHADING_DENSITY_LABELS,
  SKETCH_LEVEL_LABELS,
} from '../../../engine/model/shadingLabels';
import { cornerRadiiOf } from '../../../engine/model/cornerRadii';
import { sharedValue } from '../../../engine/model/selection';
import { DEFAULT_INK, type AnyNode, type Appearance, type SketchLevel } from '../../../engine/model/schema';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { FillStyleIcon, ShadingDensityIcon, SketchLevelIcon } from '../../panel/sketchIcons';
import { StrokeWeightIcon } from '../../panel/strokeWeightIcon';
import { PopoverSlider } from '../RailBase';
import { RailPopover } from '../RailPopover';

// ------------------------------------------------------------------ icons

/** Corner or smooth, drawn as the two path shapes an anchor can make. */
export const CornerIcon: React.FC<{ rounded: boolean }> = ({ rounded }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
    <path
      d={rounded ? 'M3 12 Q3 3 12 3' : 'M3 12 V3 H12'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
    <circle cx="3" cy="12" r="1.8" fill="currentColor" />
  </svg>
);

/** Symmetric: drawn as the handles, since it differs from Smooth only in what they do. */
export const SymmetricIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
    <path d="M2.5 11.5 12.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="2.5" cy="11.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12.5" cy="3.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="7.5" cy="7.5" r="2" fill="currentColor" />
  </svg>
);

// ------------------------------------------------------------------ scrub

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The next value for a drag of `dx` pixels: one step per 2px, ten with Shift, a tenth with Alt. */
export function scrubValue(
  start: number,
  dx: number,
  mods: { shiftKey: boolean; altKey: boolean },
  range: { min: number; max: number; step: number }
): number {
  const mult = mods.shiftKey ? 10 : mods.altKey ? 0.1 : 1;
  const raw = start + Math.round(dx / 2) * range.step * mult;
  const snapped = mult < 1 ? Math.round(raw * 10) / 10 : Math.round(raw / range.step) * range.step;
  return clamp(snapped, range.min, range.max);
}

/**
 * A value you can drag.
 *
 * Press on the glyph and drag sideways. A press that does not move still opens
 * the popover it sits in, which holds the precise slider; a drag never does.
 *
 * One drag is one undo step: capturing stops at pointerdown and at pointerup,
 * and the undo manager's merge window is held open in between, however slowly
 * the drag goes. Writes go out at most once per frame (or per `throttleMs`,
 * for values whose every write re-lays something out), so a drag sends a frame's
 * worth of updates to peers rather than one per pointer event. Escape puts back
 * the value the drag started from. A rail that unmounts mid-drag commits what
 * was written and gives the merge window back.
 */
export const ScrubValue: React.FC<{
  value: number;
  min: number;
  max: number;
  step?: number;
  /** What the readout shows; the value itself by default. */
  display?: string;
  /** Minimum time between writes, for values whose every write re-lays something out. */
  throttleMs?: number;
  onChange: (value: number) => void;
  children: React.ReactNode;
}> = ({ value, min, max, step = 1, display, throttleMs = 0, onChange, children }) => {
  const drag = useRef<{
    x: number;
    start: number;
    moved: boolean;
    pending: number | null;
    written: number;
    timer: number;
    timerIsTimeout: boolean;
    lastWrite: number;
    timeout: number;
    onKey: (e: KeyboardEvent) => void;
  } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = () => {
    const d = drag.current;
    if (!d || d.pending === null) return;
    if (d.pending !== d.written) {
      d.written = d.pending;
      d.lastWrite = performance.now();
      onChangeRef.current(d.pending);
    }
    d.pending = null;
  };

  const finish = (revert: boolean) => {
    const d = drag.current;
    if (!d) return;
    window.removeEventListener('keydown', d.onKey, true);
    if (d.timer) {
      if (d.timerIsTimeout) window.clearTimeout(d.timer);
      else cancelAnimationFrame(d.timer);
    }
    if (revert) {
      d.pending = null;
      if (d.written !== d.start) onChangeRef.current(d.start);
    } else {
      flush();
    }
    undoManager.captureTimeout = d.timeout;
    undoManager.stopCapturing();
    drag.current = null;
  };

  // Unmounted mid-drag (the selection changed under it): never leave the undo
  // manager's merge window held open.
  useEffect(() => () => finish(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !drag.current?.moved) return;
      // The board's own Escape would deselect; this one only takes the drag back.
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    };
    drag.current = {
      x: e.clientX,
      start: value,
      moved: false,
      pending: null,
      written: value,
      timer: 0,
      timerIsTimeout: false,
      lastWrite: 0,
      timeout: undoManager.captureTimeout,
      onKey,
    };
    window.addEventListener('keydown', onKey, true);
    // Nothing before the drag merges into it.
    undoManager.stopCapturing();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 3) return;
      d.moved = true;
      // Nothing inside the drag splits off, however long it pauses.
      undoManager.captureTimeout = Number.MAX_SAFE_INTEGER;
    }
    d.pending = scrubValue(d.start, dx, e, { min, max, step });
    if (d.timer) return;
    const run = () => {
      if (drag.current !== d) return;
      d.timer = 0;
      flush();
    };
    const wait = Math.max(0, throttleMs - (performance.now() - d.lastWrite));
    d.timerIsTimeout = wait > 0;
    d.timer = wait > 0 ? window.setTimeout(run, wait) : requestAnimationFrame(run);
  };

  const end = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    const moved = d.moved;
    finish(false);
    if (!moved) return;
    // The click that follows a drag must not open the popover. It is dispatched
    // in the same task as the pointerup, so a capture listener removed on the
    // next tick catches it and nothing else.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };

  return (
    <span
      className="rail-scrub"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
      <span className="rail-scrub__value" aria-hidden="true">{display ?? value}</span>
    </span>
  );
};

// ------------------------------------------------------------------ stroke

/**
 * Stroke colour and weight. The trigger shows the weight the object is drawn
 * at, which for a run with nothing stored is the renderer's default, not 0.
 */
export const StrokeControl: React.FC<{
  appearance: Appearance;
  /** The weight the renderer draws, from `drawnStrokeWidth`. */
  width: number;
  onChange: (patch: Partial<Appearance>) => void;
}> = ({ appearance, width, onChange }) => {
  const color = appearance.stroke?.color ?? DEFAULT_INK;
  const setWidth = (w: number) => onChange({ stroke: { color, ...appearance.stroke, width: w } });
  return (
    <RailPopover
      label="Stroke"
      trigger={
        <ScrubValue value={width} min={0} max={40} onChange={setWidth}>
          <StrokeWeightIcon width={width} />
        </ScrubValue>
      }
    >
      <div className="ctx-popover__row">
        <span className="ctx-popover__label">Colour</span>
        <ColorPickerPopover
          color={color}
          onChange={(next) => onChange({ stroke: { ...appearance.stroke, width: width || 2, color: next } })}
        />
      </div>
      <PopoverSlider label="Weight" value={width} min={0} max={40} onChange={setWidth} />
    </RailPopover>
  );
};

// ------------------------------------------------------------------ opacity

/** Opacity as a percentage you can drag. */
export const OpacityControl: React.FC<{ value: number; onChange: (opacity: number) => void }> = ({ value, onChange }) => {
  const pct = Math.round(value * 100);
  const set = (v: number) => onChange(v / 100);
  return (
    <RailPopover
      label="Opacity"
      trigger={
        <ScrubValue value={pct} min={0} max={100} display={`${pct}%`} onChange={set}>
          <Droplet size={16} />
        </ScrubValue>
      }
    >
      <PopoverSlider label="Opacity" value={pct} min={0} max={100} suffix="%" onChange={set} />
    </RailPopover>
  );
};

// ------------------------------------------------------------------ corner radius

export const CornerRadiusControl: React.FC<{
  appearance: Appearance;
  onChange: (patch: Partial<Appearance>) => void;
}> = ({ appearance, onChange }) => {
  const radius = cornerRadiiOf(appearance.cornerRadius)[0];
  const set = (cornerRadius: number) => onChange({ cornerRadius });
  return (
    <RailPopover
      label="Corner radius"
      trigger={
        <ScrubValue value={radius} min={0} max={200} onChange={set}>
          <CornerIcon rounded />
        </ScrubValue>
      }
    >
      <PopoverSlider label="Corner radius" value={radius} min={0} max={200} onChange={set} />
    </RailPopover>
  );
};

// ------------------------------------------------------------------ sketch

const SKETCH_LEVELS = ['off', 'light', 'medium', 'heavy'] as const;
const FILL_STYLES = ['solid', 'hachure', 'crosshatch', 'zigzag', 'dots'] as const;

/**
 * Sketch, and the shading that only means something once there is a sketch.
 *
 * The popover grows by exactly what the current choice makes meaningful: no
 * shading without a sketch level, no density or angle without strokes to lay.
 */
export const SketchControl: React.FC<{
  appearance: Appearance;
  /** Whether the object has an interior to shade. Lines and connectors do not. */
  shades: boolean;
  onChange: (patch: Partial<Appearance>) => void;
}> = ({ appearance, shades, onChange }) => (
  <RailPopover label="Sketch" trigger={<SketchLevelIcon level={appearance.sketch ?? 'off'} />} align="start">
    <span className="ctx-popover__label">Sketch</span>
    <div className="ctx-shape-grid">
      {SKETCH_LEVELS.map((lvl) => (
        <button
          key={lvl}
          type="button"
          className="ctx-shape-btn"
          aria-pressed={(appearance.sketch ?? 'off') === lvl}
          aria-label={SKETCH_LEVEL_LABELS[lvl]}
          data-tooltip={SKETCH_LEVEL_LABELS[lvl]}
          onClick={() => onChange({ sketch: lvl === 'off' ? undefined : lvl })}
        >
          <SketchLevelIcon level={lvl} />
        </button>
      ))}
    </div>
    {appearance.sketch && shades && (
      <>
        <span className="ctx-popover__label">Shading</span>
        <div className="ctx-shape-grid">
          {FILL_STYLES.map((st) => (
            <button
              key={st}
              type="button"
              className="ctx-shape-btn"
              aria-pressed={(appearance.fillStyle ?? 'solid') === st}
              aria-label={FILL_STYLE_LABELS[st]}
              data-tooltip={FILL_STYLE_LABELS[st]}
              onClick={() => onChange({ fillStyle: st === 'solid' ? undefined : st })}
            >
              <FillStyleIcon style={st} />
            </button>
          ))}
        </div>
      </>
    )}
    {appearance.sketch && shades && appearance.fillStyle && appearance.fillStyle !== 'solid' && (
      <>
        <span className="ctx-popover__label">Density</span>
        <div className="ctx-shape-grid">
          {SHADING_DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              className="ctx-shape-btn"
              aria-pressed={(appearance.shadingDensity ?? 'medium') === d}
              aria-label={SHADING_DENSITY_LABELS[d]}
              data-tooltip={SHADING_DENSITY_HINTS[d]}
              onClick={() => onChange({ shadingDensity: d === 'medium' ? undefined : d })}
            >
              <ShadingDensityIcon density={d} />
            </button>
          ))}
        </div>
        <PopoverSlider
          label="Angle"
          value={appearance.shadingAngle ?? HACHURE_ANGLE}
          min={-90}
          max={90}
          suffix="°"
          onChange={(shadingAngle) => onChange({ shadingAngle })}
        />
      </>
    )}
  </RailPopover>
);

/** Sketch across a selection, merged per node so nobody's fill or stroke is overwritten. */
export const BulkSketchControl: React.FC<{ nodes: readonly AnyNode[] }> = ({ nodes }) => {
  const level = sharedValue(nodes, (n) => (n as { appearance?: Appearance }).appearance?.sketch ?? 'off');
  const current = (level.mixed ? 'off' : (level.value as SketchLevel | 'off')) ?? 'off';
  return (
    <RailPopover label="Sketch" trigger={<SketchLevelIcon level={current} />}>
      <span className="ctx-popover__label">Sketch</span>
      <div className="ctx-shape-grid">
        {SKETCH_LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            className="ctx-shape-btn"
            aria-pressed={!level.mixed && (level.value ?? 'off') === lvl}
            aria-label={SKETCH_LEVEL_LABELS[lvl]}
            data-tooltip={SKETCH_LEVEL_LABELS[lvl]}
            onClick={() =>
              applyNodePatches(
                nodes.map((n) => ({
                  id: n.id,
                  changes: {
                    appearance: {
                      ...((n as { appearance?: Appearance }).appearance ?? {}),
                      sketch: lvl === 'off' ? undefined : lvl,
                    },
                  },
                }))
              )
            }
          >
            <SketchLevelIcon level={lvl} />
          </button>
        ))}
      </div>
    </RailPopover>
  );
};
