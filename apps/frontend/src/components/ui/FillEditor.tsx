import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlignHorizontalSpaceAround, ArrowLeftRight, RotateCw, Trash2 } from 'lucide-react';
import { ColorPanel } from './ColorPanel';
import { PORTAL_SURFACE_ATTR } from './portalSurface';
import { useFloatingPanel } from './useFloatingPanel';
import {
  convertPaint,
  cssAsImage,
  distributeStops,
  isGradient,
  linearAngle,
  paintToCss,
  withLinearAngle,
  reverseStops,
  withAlpha,
  type GradientPaint,
  type GradientStop,
  type Paint,
  type PaintType,
} from '../../engine/model/paint';
import { colorAtOffset } from '../../engine/model/colorFormat';
import { gradientPreviewCss } from '../../engine/model/paintPreview';
import { applyPreset, fadeStops, GRADIENT_PRESETS, matchesPreset, stopDrag } from '../../engine/model/gradientPresets';

interface Props {
  paint: Paint | undefined;
  onChange: (paint: Paint) => void;
  /**
   * The selected objects have different fills. `paint: undefined` cannot say
   * so — it already means "no fill set" — and showing the first one's colour
   * would be a claim the next click makes true.
   */
  mixed?: boolean;
}

const CHECKER = 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%)';
const NO_FILL =
  `linear-gradient(to top right, transparent calc(50% - 1.5px), #EF4444 calc(50% - 1.5px), #EF4444 calc(50% + 1.5px), transparent calc(50% + 1.5px)), ${CHECKER}`;
const MIXED = 'linear-gradient(135deg, #EF4444 0 33%, #3B82F6 33% 66%, #F59E0B 66% 100%)';
const DEFAULT = '#4F46E5';
const MAX_STOPS = 8;

/** The kinds, each drawn as itself — a picker for paint you recognise, not read. */
const KINDS: Array<{ id: PaintType | 'none'; label: string; swatch: string }> = [
  { id: 'none', label: 'No fill', swatch: NO_FILL },
  { id: 'solid', label: 'Solid', swatch: '#6366F1' },
  { id: 'linear', label: 'Linear', swatch: 'linear-gradient(180deg, #6366F1, #EC4899)' },
  { id: 'radial', label: 'Radial', swatch: 'radial-gradient(circle at 50% 50%, #EC4899, #6366F1)' },
  { id: 'conic', label: 'Angular', swatch: 'conic-gradient(from 0deg at 50% 50%, #6366F1, #EC4899, #6366F1)' },
  { id: 'diamond', label: 'Diamond', swatch: 'radial-gradient(ellipse 50% 50% at 50% 50%, #EC4899, #6366F1)' },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const snap15 = (deg: number) => Math.round(deg / 15) * 15;

/**
 * Editing a fill: none, a colour, or a gradient you can take hold of.
 *
 * ## What changed
 *
 * - **One panel.** Choosing a stop's colour opened a second popover on top of
 *   this one, placed by its own rules. The picker now sits under the bar,
 *   editing the selected stop in place.
 * - **It floats beside what opened it** (`useFloatingPanel`). It was positioned
 *   inside its container, which in the Properties panel is a scrolling column —
 *   so it was clipped, and over the rows adjusted next.
 * - **The preview is a control.** The endpoints of a linear gradient, the
 *   centre and radius of a radial or diamond, the centre and start of an
 *   angular one are handles on the preview, as they are on the canvas in Figma.
 *   Shift snaps angles to 15°; double-click puts the geometry back.
 * - **The bar works the way gradient bars work.** Clicking empty bar *adds* a
 *   stop there, in the colour already at that point, so nothing changes until
 *   it is moved or recoloured. It used to move the selected stop to the click,
 *   which is the one reading nobody expects. Dragging a stop well off the bar
 *   removes it.
 * - **Presets,** including a fade of the current colour, carrying stops only so
 *   the kind and direction you set are kept.
 */
export const FillEditor: React.FC<Props> = ({ paint, onChange, mixed = false }) => {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [activeStop, setActiveStop] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const spot = useFloatingPanel({ open, trigger, panel, onClose: close });

  const current: Paint = paint ?? { type: 'solid', color: DEFAULT };
  const isNoFill = current.type === 'solid' && (current.color === 'transparent' || current.opacity === 0);
  const activeKind: PaintType | 'none' = isNoFill ? 'none' : current.type;

  const selectKind = (id: PaintType | 'none') => {
    if (id === 'none') onChange({ type: 'solid', color: 'transparent', opacity: 0 });
    else if (isNoFill) onChange(convertPaint({ type: 'solid', color: DEFAULT, opacity: 1 }, id));
    else onChange(convertPaint(current, id));
  };

  const swatch = mixed ? MIXED : isNoFill ? NO_FILL : paintToCss(current);

  return (
    <div className="fx-anchor">
      <button
        ref={setTrigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={mixed ? 'Edit fill. The selection has several' : isNoFill ? 'No fill. Edit fill' : 'Edit fill'}
        className={`fill-swatch${open ? ' is-open' : ''}`}
      >
        <span style={{ backgroundImage: cssAsImage(swatch) }} />
      </button>

      {open &&
        createPortal(
          <div
            ref={setPanel}
            role="dialog"
            aria-label="Fill"
            {...{ [PORTAL_SURFACE_ATTR]: 'fill-editor' }}
            className="cpx-popover fx"
            data-side={spot?.side}
            style={{ left: spot?.x ?? 0, top: spot?.y ?? 0, maxHeight: spot?.maxHeight, visibility: spot ? 'visible' : 'hidden' }}
          >
            <div className="fx-kinds" role="radiogroup" aria-label="Fill type">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={activeKind === k.id}
                  aria-label={k.label}
                  data-tooltip={k.label}
                  className="fx-kind"
                  onClick={() => selectKind(k.id)}
                >
                  <span style={{ backgroundImage: cssAsImage(k.swatch) }} />
                </button>
              ))}
              <span className="fx-kinds__name" aria-hidden>
                {KINDS.find((k) => k.id === activeKind)?.label}
              </span>
            </div>

            {isGradient(current) ? (
              <GradientEditor
                paint={current}
                onChange={onChange}
                selected={Math.min(activeStop, current.stops.length - 1)}
                onSelect={setActiveStop}
              />
            ) : (
              <ColorPanel
                color={isNoFill ? 'transparent' : current.color || DEFAULT}
                alpha={isNoFill ? 0 : current.opacity ?? 1}
                onChange={(color) =>
                  color === 'transparent'
                    ? onChange({ type: 'solid', color: 'transparent', opacity: 0 })
                    : onChange({ type: 'solid', color, opacity: isNoFill ? undefined : current.opacity })
                }
                onAlphaChange={(o) =>
                  onChange({
                    type: 'solid',
                    color: isNoFill ? DEFAULT : current.color,
                    opacity: o >= 1 ? undefined : o,
                  })
                }
              />
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

// ------------------------------------------------------------------ gradients

const GradientEditor: React.FC<{
  paint: GradientPaint;
  onChange: (paint: Paint) => void;
  selected: number;
  onSelect: (index: number) => void;
}> = ({ paint, onChange, selected, onSelect }) => {
  const stops = paint.stops;
  const stop = stops[selected] ?? stops[0];

  /** The live paint for handlers bound once per gesture. */
  const latest = useRef({ paint, onChange });
  latest.current = { paint, onChange };

  const setStops = (next: GradientStop[]) => onChange({ ...latest.current.paint, stops: next });
  const patchStop = (index: number, patch: Partial<GradientStop>) =>
    setStops(latest.current.paint.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const removeStop = (index: number) => {
    const all = latest.current.paint.stops;
    if (all.length <= 2) return;
    setStops(all.filter((_, i) => i !== index));
    onSelect(Math.max(0, index - 1));
  };

  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);

  return (
    <div className="fx-gradient">
      <GradientStage paint={paint} onChange={onChange} />

      <StopBar paint={paint} selected={selected} onSelect={onSelect} setStops={setStops} removeStop={removeStop} />

      <div className="fx-stoprow">
        <label className="fx-offset">
          <span className="fx-offset__swatch" style={{ backgroundImage: `linear-gradient(${withAlpha(stop.color, stop.opacity)}, ${withAlpha(stop.color, stop.opacity)}), ${CHECKER}` }} aria-hidden />
          <input
            className="cpx-input"
            aria-label="Stop position percent"
            inputMode="numeric"
            value={offsetDraft ?? `${Math.round(stop.offset * 100)}%`}
            onFocus={(e) => {
              setOffsetDraft(String(Math.round(stop.offset * 100)));
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setOffsetDraft(e.target.value)}
            onBlur={() => {
              const n = Number((offsetDraft ?? '').replace('%', ''));
              if (Number.isFinite(n)) patchStop(selected, { offset: clamp(n / 100, 0, 1) });
              setOffsetDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <div className="fx-actions">
          <button type="button" className="cpx-icon" data-tooltip="Reverse" aria-label="Reverse the gradient" onClick={() => onChange(reverseStops(paint))}>
            <ArrowLeftRight size={13} />
          </button>
          <button
            type="button"
            className="cpx-icon"
            data-tooltip="Space the stops evenly"
            aria-label="Space the stops evenly"
            disabled={stops.length < 3}
            onClick={() => onChange(distributeStops(paint))}
          >
            <AlignHorizontalSpaceAround size={13} />
          </button>
          <button
            type="button"
            className="cpx-icon"
            data-tooltip={paint.type === 'linear' ? 'Turn 90°' : paint.type === 'conic' ? 'Turn 90°' : 'Only linear and angular gradients turn'}
            aria-label="Turn the gradient 90 degrees"
            disabled={paint.type !== 'linear' && paint.type !== 'conic'}
            onClick={() => {
              if (paint.type === 'conic') onChange({ ...paint, angle: (paint.angle + 90) % 360 });
              if (paint.type === 'linear') {
                // Rotate the endpoints about the box's centre, so a gradient
                // pulled off-centre stays where it was put.
                const rot = (p: { x: number; y: number }) => ({ x: 0.5 - (p.y - 0.5), y: 0.5 + (p.x - 0.5) });
                onChange({ ...paint, from: rot(paint.from), to: rot(paint.to) });
              }
            }}
          >
            <RotateCw size={13} />
          </button>
          <button
            type="button"
            className="cpx-icon"
            data-tooltip={stops.length <= 2 ? 'A gradient needs two stops' : 'Remove stop (or drag it off the bar)'}
            aria-label="Remove the selected stop"
            disabled={stops.length <= 2}
            onClick={() => removeStop(selected)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <ColorPanel
        // Remounted per stop, so compare-and-revert returns *this* stop to the
        // colour it had, not to the first stop the panel happened to open on.
        key={selected}
        compact
        allowNone={false}
        color={stop.color}
        alpha={stop.opacity ?? 1}
        onChange={(color) => patchStop(selected, { color })}
        onAlphaChange={(o) => patchStop(selected, { opacity: o >= 1 ? undefined : o })}
      />

      <div className="fx-gradient-presets" role="group" aria-label="Gradient presets">
        {[{ id: 'fade', name: 'Fade this colour', stops: fadeStops(stop.color) }, ...GRADIENT_PRESETS].map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="fx-gradient-preset"
            aria-label={preset.name}
            data-tooltip={preset.name}
            aria-pressed={matchesPreset(paint, preset.stops)}
            style={{
              backgroundImage: `linear-gradient(90deg, ${[...preset.stops]
                .sort((a, b) => a.offset - b.offset)
                .map((s) => `${withAlpha(s.color, s.opacity)} ${s.offset * 100}%`)
                .join(', ')}), ${CHECKER}`,
            }}
            onClick={() => {
              onChange(applyPreset(paint, preset.stops));
              onSelect(0);
            }}
          />
        ))}
      </div>
    </div>
  );
};

/** The preview, with the gradient's geometry as handles on it. */
const GradientStage: React.FC<{ paint: GradientPaint; onChange: (paint: Paint) => void }> = ({ paint, onChange }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 240, height: 112 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const unit = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  /** A handle that follows the pointer through `apply`, captured so it survives leaving the tile. */
  const handle = (key: string, at: { x: number; y: number }, label: string, apply: (p: { x: number; y: number }, e: React.PointerEvent) => void, kind: 'end' | 'center' | 'aux' = 'end') => (
    <span
      key={key}
      className={`fx-handle fx-handle--${kind}`}
      role="slider"
      aria-label={label}
      tabIndex={-1}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        apply(unit(e), e);
      }}
    />
  );

  const handles: React.ReactNode[] = [];
  let guide: React.ReactNode = null;

  if (paint.type === 'linear') {
    const move = (end: 'from' | 'to') => (p: { x: number; y: number }, e: React.PointerEvent) => {
      const other = end === 'from' ? paint.to : paint.from;
      let next = p;
      if (e.shiftKey) {
        // Keep the length, snap the direction.
        const dx = (p.x - other.x) * size.width;
        const dy = (p.y - other.y) * size.height;
        const len = Math.hypot(dx, dy);
        const a = (snap15((Math.atan2(dy, dx) * 180) / Math.PI) * Math.PI) / 180;
        next = { x: clamp(other.x + (Math.cos(a) * len) / size.width, 0, 1), y: clamp(other.y + (Math.sin(a) * len) / size.height, 0, 1) };
      }
      onChange({ ...paint, [end]: next });
    };
    guide = (
      <svg className="fx-guide" aria-hidden>
        <line x1={`${paint.from.x * 100}%`} y1={`${paint.from.y * 100}%`} x2={`${paint.to.x * 100}%`} y2={`${paint.to.y * 100}%`} />
      </svg>
    );
    handles.push(handle('from', paint.from, 'Gradient start', move('from')), handle('to', paint.to, 'Gradient end', move('to')));
  } else {
    handles.push(handle('center', paint.center, 'Gradient centre', (p) => onChange({ ...paint, center: p }), 'center'));
    if (paint.type === 'radial' || paint.type === 'diamond') {
      const scale = paint.type === 'radial' ? Math.max(size.width, size.height) / 2 : size.width / 2;
      const at = { x: clamp(paint.center.x + (paint.radius * scale) / size.width, 0, 1), y: paint.center.y };
      guide = (
        <svg className="fx-guide" aria-hidden>
          <line x1={`${paint.center.x * 100}%`} y1={`${paint.center.y * 100}%`} x2={`${at.x * 100}%`} y2={`${at.y * 100}%`} />
        </svg>
      );
      handles.push(
        handle('radius', at, 'Gradient size', (p) => {
          const dist = Math.hypot((p.x - paint.center.x) * size.width, (p.y - paint.center.y) * size.height);
          onChange({ ...paint, radius: clamp(dist / scale, 0.05, 1.5) });
        }, 'aux')
      );
    } else {
      const a = (paint.angle * Math.PI) / 180;
      const reach = Math.min(size.width, size.height) * 0.36;
      const at = { x: paint.center.x + (Math.sin(a) * reach) / size.width, y: paint.center.y - (Math.cos(a) * reach) / size.height };
      guide = (
        <svg className="fx-guide" aria-hidden>
          <line x1={`${paint.center.x * 100}%`} y1={`${paint.center.y * 100}%`} x2={`${at.x * 100}%`} y2={`${at.y * 100}%`} />
        </svg>
      );
      handles.push(
        handle('angle', { x: clamp(at.x, 0, 1), y: clamp(at.y, 0, 1) }, 'Sweep start', (p, e) => {
          const dx = (p.x - paint.center.x) * size.width;
          const dy = (p.y - paint.center.y) * size.height;
          const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
          onChange({ ...paint, angle: Math.round(e.shiftKey ? snap15(deg) % 360 : deg) });
        }, 'aux')
      );
    }
  }

  return (
    <div
      ref={ref}
      className="fx-stage"
      data-tooltip="Drag the handles. Shift snaps to 15°. Double-click to reset."
      data-tooltip-pos="top"
      onDoubleClick={() => onChange({ ...convertPaint({ type: 'solid', color: '#000' }, paint.type), stops: paint.stops, opacity: paint.opacity } as Paint)}
    >
      <span className="fx-stage__paint" style={{ backgroundImage: `${gradientPreviewCss(paint, size.width, size.height)}, ${CHECKER}` }} />
      {guide}
      {handles}
      <Readout paint={paint} onChange={onChange} />
    </div>
  );
};

/** The stops, on the colours they describe. */
const StopBar: React.FC<{
  paint: GradientPaint;
  selected: number;
  onSelect: (i: number) => void;
  setStops: (stops: GradientStop[]) => void;
  removeStop: (i: number) => void;
}> = ({ paint, selected, onSelect, setStops, removeStop }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [detaching, setDetaching] = useState<number | null>(null);
  const stops = paint.stops;

  const live = useRef({ paint, setStops });
  live.current = { paint, setStops };

  const follow = (index: number, e: React.PointerEvent) => {
    const r = barRef.current!.getBoundingClientRect();
    const { offset, detaching: off } = stopDrag({ x: e.clientX, y: e.clientY }, { left: r.left, width: r.width, top: r.top, bottom: r.bottom }, live.current.paint.stops.length);
    setDetaching(off ? index : null);
    live.current.setStops(live.current.paint.stops.map((s, i) => (i === index ? { ...s, offset } : s)));
  };

  const release = (index: number) => {
    if (detaching === index) {
      setDetaching(null);
      removeStop(index);
      return;
    }
    setDetaching(null);
    // Stored order is kept while a drag is live so indices stay pinned to the
    // stop under the pointer; sorted once, on release.
    const all = live.current.paint.stops;
    const held = all[index];
    const ordered = [...all].sort((a, b) => a.offset - b.offset);
    live.current.setStops(ordered);
    onSelect(Math.max(0, ordered.indexOf(held)));
  };

  const sortedCss = [...stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${withAlpha(s.color, s.opacity)} ${s.offset * 100}%`)
    .join(', ');

  return (
    <div className="fx-bar-wrap">
      <div
        ref={barRef}
        className="fx-bar"
        data-tooltip={stops.length >= MAX_STOPS ? undefined : 'Click to add a stop'}
        data-tooltip-pos="top"
        style={{ backgroundImage: `linear-gradient(90deg, ${sortedCss}), ${CHECKER}` }}
        onPointerDown={(e) => {
          if (stops.length >= MAX_STOPS) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const offset = clamp((e.clientX - r.left) / r.width, 0, 1);
          const { color, opacity } = colorAtOffset(stops, offset);
          const added = { offset, color, opacity: opacity >= 1 ? undefined : opacity };
          setStops([...stops, added]);
          onSelect(stops.length);
        }}
      />
      {stops.map((s, i) => (
        <button
          key={i}
          type="button"
          className="fx-stop"
          data-active={i === selected || undefined}
          data-detaching={detaching === i || undefined}
          aria-label={`Stop ${i + 1} at ${Math.round(s.offset * 100)}%`}
          aria-pressed={i === selected}
          style={{
            left: `${s.offset * 100}%`,
            ['--stop' as string]: withAlpha(s.color, s.opacity),
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.focus({ preventScroll: true });
            onSelect(i);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) follow(i, e);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) release(i);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.01;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              const next = clamp(s.offset + (e.key === 'ArrowLeft' ? -step : step), 0, 1);
              setStops(stops.map((x, j) => (j === i ? { ...x, offset: next } : x)));
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && stops.length > 2) {
              e.preventDefault();
              e.stopPropagation();
              removeStop(i);
            }
          }}
        />
      ))}
    </div>
  );
};

/**
 * The geometry as a number, on the preview.
 *
 * The handles are the fast way; this is the exact way, and the keyboard's way —
 * the angle dial and size slider it replaces were the only route to the
 * geometry without a pointer, and dropping them would have taken that away.
 */
const Readout: React.FC<{ paint: GradientPaint; onChange: (paint: Paint) => void }> = ({ paint, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const value =
    paint.type === 'linear'
      ? Math.round(linearAngle(paint))
      : paint.type === 'conic'
        ? Math.round(paint.angle)
        : Math.round(paint.radius * 100);
  const unit = paint.type === 'linear' || paint.type === 'conic' ? '°' : '%';
  const label = paint.type === 'linear' ? 'Gradient angle' : paint.type === 'conic' ? 'Sweep start angle' : 'Gradient size';

  const apply = (n: number) => {
    if (!Number.isFinite(n)) return;
    if (paint.type === 'linear') onChange(withLinearAngle(paint, ((n % 360) + 360) % 360));
    else if (paint.type === 'conic') onChange({ ...paint, angle: ((n % 360) + 360) % 360 });
    else onChange({ ...paint, radius: clamp(n / 100, 0.05, 1.5) });
  };

  return (
    <input
      className="fx-readout"
      aria-label={label}
      inputMode="numeric"
      value={draft ?? `${value}${unit}`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        setDraft(String(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) apply(Number(draft.replace(/[°%]/g, '')));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = (e.shiftKey ? 15 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          apply(value + step);
          setDraft(null);
        }
      }}
    />
  );
};
