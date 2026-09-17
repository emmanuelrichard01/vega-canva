import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { EyedropperButton } from './EyedropperButton';
import { contrastInk, hexToHsv, hsvToHex, type HSV } from '../../engine/model/color';
import { CURATED_PALETTES, paletteOf, tintsAndShades } from '../../engine/model/colorRamp';
import {
  boardColors,
  contrastGrade,
  contrastRatio,
  formatColor,
  parseInFormat,
  type ColorFormat,
} from '../../engine/model/colorFormat';
import { withAlpha } from '../../engine/model/paint';
import { useStore } from '../../hooks/useStore';

/**
 * The body of every colour control in the app: a picker, not a popover.
 *
 * ## Why it is its own component now
 *
 * Choosing a gradient stop's colour used to open a colour *popover* from inside
 * the fill *popover*: two floating panels stacked on a 24px swatch, the second
 * one placed by its own rules and dismissed by its own outside-click, which the
 * first had to be taught to ignore. Every design tool with gradients edits the
 * stop in place, under the bar. So the picker is a panel that can be placed
 * anywhere — alone in the colour popover, or inline under the gradient bar.
 *
 * ## What it adds, and where each came from
 *
 * - **Current beside original.** The preview chip is split: the colour the
 *   picker opened on, and the one in hand. Click the old half to go back —
 *   the "compare and revert" every paint program has, and the only undo that
 *   does not also undo whatever you did before opening the picker.
 * - **Any format in, your format out.** HEX, RGB or HSL, remembered between
 *   visits; the field accepts all three and CSS names whatever it is showing.
 * - **This board's colours** (Figma, Lucidchart), counted from the document, so
 *   "the blue the other boxes use" is one click and not a trip to find a box.
 * - **Number keys pick a shade** (Excalidraw): with focus in the picker, 1–9
 *   choose along the ramp of the current colour.
 * - **Contrast, where it matters.** Given the surface the colour will sit on,
 *   it shows the ratio and its WCAG grade, live, while you drag.
 * - **The hue survives greys.** Hue was re-derived from the hex on every
 *   render, and a grey has no hue: dragging into the left edge or the bottom of
 *   the field threw the hue away, and the hue slider snapped back to red.
 */

export interface ColorPanelProps {
  /** A hex colour, or `transparent`. */
  color: string;
  onChange: (color: string) => void;
  /** 0..1, where the value being edited can store one. */
  alpha?: number;
  onAlphaChange?: (alpha: number) => void;
  /** Offer the "none" swatch. */
  allowNone?: boolean;
  /** The surface this colour will be read against, for the contrast readout. */
  contrastAgainst?: string;
  /** Shorter field and fewer rows, for editing a gradient stop under its bar. */
  compact?: boolean;
}

const FORMAT_KEY = 'vega_color_format';
const SOURCE_KEY = 'vega_color_source';
const RECENTS_KEY = 'vega_recent_colors';
const MAX_RECENTS = 10;

type Source = 'swatches' | 'board' | 'palettes';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a nicety, never a requirement */
  }
}

function readRecents(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function pushRecent(color: string) {
  try {
    const next = [color, ...readRecents().filter((c) => c.toUpperCase() !== color.toUpperCase())].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * Three rows of ten: greys, strong hues, soft hues.
 *
 * Aligned in columns on purpose — a strong colour sits above its own soft
 * version — so the grid can be read two ways: across for "a red", down for
 * "the red, lighter". FigJam's palette is laid out the same way for the same
 * reason.
 */
const NEUTRALS = ['#000000', '#1F2937', '#374151', '#4B5563', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB', '#F3F4F6', '#FFFFFF'];
const STRONG = ['#EF4444', '#F97316', '#F59E0B', '#22C55E', '#14B8A6', '#0EA5E9', '#3B82F6', '#6366F1', '#A855F7', '#EC4899'];
const SOFT = ['#FECACA', '#FED7AA', '#FDE68A', '#BBF7D0', '#99F6E4', '#BAE6FD', '#BFDBFE', '#C7D2FE', '#E9D5FF', '#FBCFE8'];

const FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl'];
const SOURCES: readonly Source[] = ['swatches', 'board', 'palettes'];

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** Behind anything translucent, so see-through reads as see-through and not as pale. */
const CHECKER = 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%)';
const flat = (c: string) => `linear-gradient(${c}, ${c}), ${CHECKER}`;

export const ColorPanel: React.FC<ColorPanelProps> = ({
  color,
  onChange,
  alpha: alphaProp,
  onAlphaChange,
  allowNone = true,
  contrastAgainst,
  compact = false,
}) => {
  const isNone = color === 'transparent' || alphaProp === 0;
  const hex = !color || color === 'transparent' ? '#000000' : color.toUpperCase();
  const alpha = isNone ? 0 : alphaProp ?? 1;

  /**
   * HSV held here, not re-derived from the hex every render.
   *
   * Synced from the prop only when the prop names a *different* colour than
   * the one this state already draws — and when that colour is a grey, the
   * hue in hand is kept, because a grey has none of its own to give.
   */
  const [hsv, setHsvState] = useState<HSV>(() => hexToHsv(hex) ?? { h: 0, s: 0, v: 0 });
  useEffect(() => {
    setHsvState((current) => {
      if (same(hsvToHex(current), hex)) return current;
      const next = hexToHsv(hex) ?? current;
      return next.s === 0 || next.v === 0 ? { ...next, h: current.h } : next;
    });
  }, [hex]);

  /** What the picker opened on, for compare-and-revert. */
  const original = useRef({ color, alpha: alphaProp });

  const [format, setFormat] = useState<ColorFormat>(() => read(FORMAT_KEY, FORMATS, 'hex'));
  const [source, setSource] = useState<Source>(() => read(SOURCE_KEY, SOURCES, 'swatches'));
  const [draft, setDraft] = useState<string | null>(null);
  const [alphaDraft, setAlphaDraft] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [copied, setCopied] = useState(false);

  const commit = useCallback(
    (next: string, remember = true) => {
      onChange(next);
      if (next !== 'transparent' && remember) {
        pushRecent(next);
        setRecents(readRecents());
      }
      // Choosing a colour for something that had none makes it visible.
      if (next !== 'transparent' && alphaProp === 0) onAlphaChange?.(1);
    },
    [onChange, onAlphaChange, alphaProp]
  );

  const setHsv = (patch: Partial<HSV>) => {
    const next = { ...hsv, ...patch };
    setHsvState(next);
    // Dragging writes, but only the release is worth remembering: sixty recents
    // a second would push every real one out of the list.
    commit(hsvToHex(next), false);
  };

  const pick = (c: string) => {
    if (c === 'transparent') {
      onChange('transparent');
      onAlphaChange?.(0);
      return;
    }
    const next = hexToHsv(c);
    if (next) setHsvState(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next);
    commit(c);
  };

  const shades = useMemo(() => tintsAndShades(hex, 9), [hex]);

  const objects = useStore((s) => s.objects);
  const onBoard = useMemo(
    () => (source === 'board' ? boardColors(objects, compact ? 10 : 20) : []),
    [objects, source, compact]
  );

  /** Pointer drags that keep following outside the control. */
  const drag = (onMove: (fx: number, fy: number) => void, onEnd?: () => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus({ preventScroll: true });
      const r = e.currentTarget.getBoundingClientRect();
      onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const r = e.currentTarget.getBoundingClientRect();
      onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    },
    onPointerUp: () => onEnd?.(),
  });

  const rememberCurrent = () => {
    pushRecent(hsvToHex(hsv));
    setRecents(readRecents());
  };

  const commitDraft = () => {
    if (draft === null) return;
    const raw = draft.trim().toLowerCase();
    setDraft(null);
    if (raw === 'none' || raw === 'transparent') {
      if (allowNone) pick('transparent');
      return;
    }
    const parsed = parseInFormat(draft, format);
    if (!parsed) return;
    pick(parsed.hex);
    if (parsed.alpha !== undefined) onAlphaChange?.(parsed.alpha);
  };

  const commitAlpha = () => {
    if (alphaDraft === null) return;
    const n = Number(alphaDraft.replace('%', '').trim());
    setAlphaDraft(null);
    if (Number.isFinite(n)) onAlphaChange?.(Math.min(1, Math.max(0, Math.round(n) / 100)));
  };

  const onPanelKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      pick(shades[Number(e.key) - 1]);
    }
  };

  const fieldKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, Partial<HSV>> = {
      ArrowLeft: { s: Math.max(0, hsv.s - step) },
      ArrowRight: { s: Math.min(1, hsv.s + step) },
      ArrowUp: { v: Math.min(1, hsv.v + step) },
      ArrowDown: { v: Math.max(0, hsv.v - step) },
    };
    if (moves[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      setHsv(moves[e.key]);
    }
  };

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const shown = isNone ? 'None' : formatColor(hex, format);
  const ratio = contrastAgainst && !isNone ? contrastRatio(hex, contrastAgainst) : null;

  const swatch = (c: string, key: string, title?: string) => {
    const none = c === 'transparent';
    const active = none ? isNone : !isNone && same(c, hex);
    return (
      <button
        key={key}
        type="button"
        className={`cpx-swatch${none ? ' cpx-swatch--none' : ''}`}
        style={none ? undefined : { background: c }}
        aria-label={title ?? (none ? 'No colour' : c)}
        aria-pressed={active}
        data-tooltip={title ?? (none ? 'No colour' : c.toUpperCase())}
        onClick={() => pick(c)}
      >
        {active && <Check size={11} strokeWidth={3} style={{ color: none ? 'var(--text-primary)' : contrastInk(c) }} aria-hidden />}
      </button>
    );
  };

  return (
    <div className={`cpx${compact ? ' cpx--compact' : ''}`} onKeyDown={onPanelKey}>
      <div
        {...drag((fx, fy) => setHsv({ s: fx, v: 1 - fy }), rememberCurrent)}
        className="cpx-field"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onKeyDown={fieldKey}
        style={{ backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})` }}
      >
        <span
          className="cpx-field__handle"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv), borderColor: contrastInk(hsvToHex(hsv)) }}
        />
      </div>

      <div className="cpx-controls">
        <EyedropperButton onPick={(c) => pick(c)} />
        <div className="cpx-tracks">
          <Track
            label="Hue"
            value={hsv.h / 360}
            onChange={(f) => setHsv({ h: Math.min(359.9, f * 360) })}
            onEnd={rememberCurrent}
            className="cpx-track--hue"
            handle={hueHex}
            valueText={`${Math.round(hsv.h)} degrees`}
          />
          {onAlphaChange && (
            <Track
              label="Opacity"
              value={alpha}
              onChange={(f) => onAlphaChange(Math.round(f * 100) / 100)}
              className="cpx-track--alpha"
              style={{ backgroundImage: `linear-gradient(to right, ${withAlpha(hex, 0)}, ${hex}), ${CHECKER}` }}
              handle={withAlpha(hex, alpha)}
              valueText={`${Math.round(alpha * 100)}%`}
            />
          )}
        </div>
        {/* Before and after. The left half reverts. */}
        <div className="cpx-compare" aria-label="Compare with the colour you started with">
          <button
            type="button"
            className="cpx-compare__was"
            data-tooltip="Back to the colour you started with"
            aria-label="Revert to the original colour"
            style={{
              backgroundImage: flat(
                original.current.color === 'transparent' ? 'transparent' : withAlpha(original.current.color, original.current.alpha)
              ),
            }}
            onClick={() => {
              const was = original.current;
              pick(was.color);
              if (was.alpha !== undefined) onAlphaChange?.(was.alpha);
            }}
          />
          <span
            className="cpx-compare__now"
            aria-hidden
            style={{ backgroundImage: flat(isNone ? 'transparent' : withAlpha(hex, alpha)) }}
          />
        </div>
      </div>

      <div className="cpx-inputs">
        <button
          type="button"
          className="cpx-format"
          data-tooltip="Switch between HEX, RGB and HSL"
          aria-label={`Colour format: ${format.toUpperCase()}. Switch format`}
          onClick={() => {
            const next = FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length];
            setFormat(next);
            write(FORMAT_KEY, next);
          }}
        >
          {format.toUpperCase()}
          <ChevronDown size={11} aria-hidden />
        </button>
        <input
          className="cpx-input cpx-input--value"
          value={draft ?? shown}
          spellCheck={false}
          aria-label={`Colour value in ${format.toUpperCase()}`}
          onFocus={(e) => {
            setDraft(shown);
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onPaste={(e) => {
            // A pasted colour is a complete thought: apply it now, in whatever
            // format it arrived, rather than waiting for Enter.
            const text = e.clipboardData.getData('text');
            const parsed = parseInFormat(text, format);
            if (!parsed) return;
            e.preventDefault();
            pick(parsed.hex);
            if (parsed.alpha !== undefined) onAlphaChange?.(parsed.alpha);
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setDraft(null);
            }
          }}
        />
        {onAlphaChange && (
          <input
            className="cpx-input cpx-input--alpha"
            value={alphaDraft ?? `${Math.round(alpha * 100)}%`}
            aria-label="Opacity percent"
            inputMode="numeric"
            onFocus={(e) => {
              setAlphaDraft(String(Math.round(alpha * 100)));
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setAlphaDraft(e.target.value)}
            onBlur={commitAlpha}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitAlpha();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
                onAlphaChange(Math.min(1, Math.max(0, Math.round(alpha * 100 + step) / 100)));
                setAlphaDraft(null);
              }
            }}
          />
        )}
        <button
          type="button"
          className="cpx-icon"
          aria-label="Copy colour"
          data-tooltip={copied ? 'Copied' : 'Copy'}
          disabled={isNone}
          onClick={() => {
            void navigator.clipboard?.writeText(formatColor(hex, format)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      <div className="cpx-ramp" role="group" aria-label="Shades of this colour. Press 1 to 9 to pick one">
        {shades.map((c, i) => (
          <button
            key={i}
            type="button"
            className="cpx-ramp__step"
            style={{ background: c }}
            aria-label={`Shade ${i + 1}, ${c}`}
            data-tooltip={`${c.toUpperCase()}  ·  ${i + 1}`}
            data-active={(!isNone && same(c, hex)) || undefined}
            onClick={() => pick(c)}
          />
        ))}
      </div>

      <div className="cpx-tabs" role="tablist" aria-label="Colour sources">
        {SOURCES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="cpx-tab"
            aria-selected={source === id}
            onClick={() => {
              setSource(id);
              write(SOURCE_KEY, id);
            }}
          >
            {id === 'swatches' ? 'Swatches' : id === 'board' ? 'This board' : 'Palettes'}
          </button>
        ))}
      </div>

      <div className="cpx-source" role="tabpanel">
        {source === 'swatches' && (
          <>
            {recents.length > 0 && (
              <div className="cpx-row">
                <span className="cpx-row__label">Recent</span>
                <div className="cpx-grid">{recents.map((c, i) => swatch(c, `r${i}`))}</div>
              </div>
            )}
            <div className="cpx-grid">
              {(allowNone ? ['transparent', ...NEUTRALS.slice(0, 9)] : NEUTRALS).map((c, i) => swatch(c, `n${i}`))}
              {STRONG.map((c, i) => swatch(c, `s${i}`))}
              {!compact && SOFT.map((c, i) => swatch(c, `p${i}`))}
            </div>
          </>
        )}

        {source === 'board' &&
          (onBoard.length > 0 ? (
            <div className="cpx-grid">
              {onBoard.map(({ color: c, count }, i) =>
                swatch(c, `b${i}`, `${c.toUpperCase()} · used ${count} ${count === 1 ? 'time' : 'times'}`)
              )}
            </div>
          ) : (
            <p className="cpx-empty">Colours used on this board collect here, most used first.</p>
          ))}

        {source === 'palettes' && (
          <div className="cpx-palettes">
            {CURATED_PALETTES.slice(0, compact ? 8 : undefined).map((palette) => (
              <div
                key={palette.id}
                className="cpx-palette"
                data-active={(!isNone && paletteOf(hex) === palette.id) || undefined}
              >
                {palette.colors.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className="cpx-palette__chip"
                    style={{ background: c }}
                    aria-label={`${palette.name} ${c}`}
                    data-tooltip={`${palette.name} · ${c.toUpperCase()}`}
                    data-active={(!isNone && same(c, hex)) || undefined}
                    onClick={() => pick(c)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {ratio !== null && contrastAgainst && (
        <div className="cpx-contrast" data-grade={contrastGrade(ratio).replace(' ', '-').toLowerCase()}>
          <span className="cpx-contrast__sample" style={{ background: contrastAgainst, color: hex }} aria-hidden>
            Aa
          </span>
          <span className="cpx-contrast__text">
            Contrast <strong>{ratio.toFixed(1)}:1</strong>
          </span>
          <span className="cpx-contrast__grade">{contrastGrade(ratio)}</span>
        </div>
      )}
    </div>
  );
};

const Track: React.FC<{
  label: string;
  value: number;
  onChange: (fraction: number) => void;
  onEnd?: () => void;
  className: string;
  style?: React.CSSProperties;
  handle: string;
  valueText: string;
}> = ({ label, value, onChange, onEnd, className, style, handle, valueText }) => {
  const set = (fx: number) => onChange(Math.min(1, Math.max(0, fx)));
  return (
    <div
      className={`cpx-track ${className}`}
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={valueText}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        const r = e.currentTarget.getBoundingClientRect();
        set((e.clientX - r.left) / r.width);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const r = e.currentTarget.getBoundingClientRect();
        set((e.clientX - r.left) / r.width);
      }}
      onPointerUp={() => onEnd?.()}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        const map: Record<string, number> = {
          ArrowLeft: value - step, ArrowDown: value - step, ArrowRight: value + step, ArrowUp: value + step, Home: 0, End: 1,
        };
        if (map[e.key] === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        set(map[e.key]);
      }}
    >
      <span className="cpx-track__handle" style={{ left: `${value * 100}%`, ['--handle' as string]: handle }} />
    </div>
  );
};
