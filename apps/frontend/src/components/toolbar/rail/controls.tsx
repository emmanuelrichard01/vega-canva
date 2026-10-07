import React, { useEffect, useRef } from 'react';
import { Droplet } from 'lucide-react';
import { applyNodePatches, undoManager } from '../../../engine/document';
import { HACHURE_ANGLE, SHADING_DENSITIES, SKETCH_LEVELS } from '../../../engine/model/rough';
import { boardSketchFor, lookPatch, resolveSketch, sketchPatch, sketchSource } from '../../../engine/model/roughMode';
import { useBoardSketch } from '../../../engine/model/roughBoard';
import {
  FILL_STYLE_LABELS,
  FILL_STYLE_ORDER,
  SHADING_DENSITY_HINTS,
  SHADING_DENSITY_LABELS,
  SKETCH_LEVEL_LABELS,
  SKETCH_LEVEL_NAMES,
  SKETCH_LOOK_LABELS,
} from '../../../engine/model/shadingLabels';
import { cornerRadiiOf } from '../../../engine/model/cornerRadii';
import { sharedValue } from '../../../engine/model/selection';
import { DEFAULT_INK, type AnyNode, type Appearance, type SketchLevel } from '../../../engine/model/schema';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import {
  CleanLookGlyph,
  FillStyleIcon,
  ShadingDensityIcon,
  SketchLevelIcon,
  SketchLookGlyph,
  SketchStateIcon,
} from '../../panel/sketchIcons';
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

/** What a tile in the sketch popover asks for. */
type SketchChoiceVerb = 'clean' | 'sketch' | 'follow' | SketchLevel;

/**
 * The patch one choice makes on one object, given the board as it reaches that
 * object, or null when the object is already there. "Follow" on an object the
 * board does not reach changes nothing.
 */
function patchFor(choice: SketchChoiceVerb, appearance: Appearance | undefined, board: SketchLevel | null) {
  if (choice === 'clean' || choice === 'sketch') return lookPatch(choice, appearance, board);
  if (choice === 'follow') return board ? sketchPatch('follow', board) : null;
  return sketchPatch(choice, board);
}

/** One square tile in a sketch popover's grid. */
const SketchTile: React.FC<{
  pressed: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ pressed, label, hint, onClick, children }) => (
  <button
    type="button"
    className="ctx-shape-btn"
    aria-pressed={pressed}
    aria-label={label}
    data-tooltip={hint ?? label}
    onClick={onClick}
  >
    {children}
  </button>
);

/**
 * The look and the roughness, which every sketchable selection offers.
 *
 * `current` is the resolved state (undefined for crisp, or mixed); `apply`
 * writes one override choice to whatever is selected.
 */
const LookAndRoughness: React.FC<{
  current: { level: SketchLevel | undefined; mixed: boolean };
  board: SketchLevel | null;
  overridden: boolean;
  apply: (choice: SketchChoiceVerb) => void;
}> = ({ current, board, overridden, apply }) => {
  const sketched = !current.mixed && Boolean(current.level);
  return (
    <>
      <span className="ctx-popover__label">Look</span>
      <div className="ctx-shape-grid sketch-rail-grid--2">
        <SketchTile pressed={!current.mixed && !current.level} label={SKETCH_LOOK_LABELS.clean} onClick={() => apply('clean')}>
          <CleanLookGlyph />
        </SketchTile>
        <SketchTile
          pressed={sketched}
          label={SKETCH_LOOK_LABELS.sketch}
          onClick={() => apply('sketch')}
        >
          <SketchLookGlyph />
        </SketchTile>
      </div>
      {board && overridden && (
        <button type="button" className="ctx-popover__action" onClick={() => apply('follow')}>
          Follow the board ({SKETCH_LEVEL_NAMES[board]})
        </button>
      )}
      {sketched && (
        <>
          <span className="ctx-popover__label">Roughness</span>
          <div className="ctx-shape-grid sketch-rail-grid--3">
            {SKETCH_LEVELS.map((lvl) => (
              <SketchTile
                key={lvl}
                pressed={current.level === lvl}
                label={SKETCH_LEVEL_LABELS[lvl]}
                onClick={() => apply(lvl)}
              >
                <SketchLevelIcon level={lvl} />
              </SketchTile>
            ))}
          </div>
        </>
      )}
    </>
  );
};

/**
 * Sketch, and the shading that only means something once there is a sketch.
 *
 * The popover grows by exactly what the current choice makes meaningful: no
 * roughness or shading while the object is crisp, no density or angle without
 * strokes to lay.
 */
export const SketchControl: React.FC<{
  appearance: Appearance;
  /** Whether the object has an interior to shade. Lines and connectors do not. */
  shades: boolean;
  /** Whether the board's sketch mode reaches this object. Pencil strokes pass false. */
  followsBoard?: boolean;
  onChange: (patch: Partial<Appearance>) => void;
}> = ({ appearance, shades, followsBoard = true, onChange }) => {
  const boardLevel = useBoardSketch();
  const board = followsBoard ? boardLevel : null;
  const level = resolveSketch(appearance, board);
  const style = appearance.fillStyle ?? 'solid';
  return (
    <RailPopover label="Sketch" trigger={<SketchStateIcon level={level} />} align="start">
      <LookAndRoughness
        current={{ level, mixed: false }}
        board={board}
        overridden={sketchSource(appearance, board) !== 'board'}
        apply={(choice) => {
          const patch = patchFor(choice, appearance, board);
          if (patch) onChange(patch);
        }}
      />
      {level && shades && (
        <>
          <span className="ctx-popover__label">Fill</span>
          <div className="ctx-shape-grid sketch-rail-grid--5">
            {FILL_STYLE_ORDER.map((st) => (
              <SketchTile
                key={st}
                pressed={style === st}
                label={FILL_STYLE_LABELS[st]}
                onClick={() => onChange({ fillStyle: st === 'solid' ? undefined : st })}
              >
                <FillStyleIcon style={st} />
              </SketchTile>
            ))}
          </div>
        </>
      )}
      {level && shades && style !== 'solid' && (
        <>
          <span className="ctx-popover__label">Density</span>
          <div className="ctx-shape-grid sketch-rail-grid--3">
            {SHADING_DENSITIES.map((d) => (
              <SketchTile
                key={d}
                pressed={(appearance.shadingDensity ?? 'medium') === d}
                label={SHADING_DENSITY_LABELS[d]}
                hint={SHADING_DENSITY_HINTS[d]}
                onClick={() => onChange({ shadingDensity: d === 'medium' ? undefined : d })}
              >
                <ShadingDensityIcon density={d} />
              </SketchTile>
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
};

/** Sketch across a selection, merged per node so nobody's fill or stroke is overwritten. */
export const BulkSketchControl: React.FC<{ nodes: readonly AnyNode[] }> = ({ nodes }) => {
  const boardLevel = useBoardSketch();
  const appearanceOf = (n: AnyNode) => (n as { appearance?: Appearance }).appearance;
  const boardOf = (n: AnyNode) => boardSketchFor(n.type, boardLevel);
  // The board as the selection sees it: on if it reaches any of it.
  const board = nodes.some((n) => boardOf(n)) ? boardLevel : null;
  const level = sharedValue(nodes, (n) => resolveSketch(appearanceOf(n), boardOf(n)) ?? 'off');
  const current = {
    level: level.mixed || level.value === 'off' ? undefined : (level.value as SketchLevel | undefined),
    mixed: level.mixed,
  };
  const overridden = nodes.some((n) => boardOf(n) !== null && sketchSource(appearanceOf(n), boardOf(n)) !== 'board');
  return (
    <RailPopover label="Sketch" trigger={<SketchStateIcon level={current.level} />}>
      <LookAndRoughness
        current={current}
        board={board}
        overridden={overridden}
        apply={(choice) => {
          applyNodePatches(
            nodes.map((n) => {
              const patch = patchFor(choice, appearanceOf(n), boardOf(n));
              return patch ? { id: n.id, changes: { appearance: { ...(appearanceOf(n) ?? {}), ...patch } } } : null;
            }).filter((p): p is NonNullable<typeof p> => p !== null)
          );
        }}
      />
    </RailPopover>
  );
};
