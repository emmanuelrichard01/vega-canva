import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyedropperButton } from './EyedropperButton';
import { contrastInk, hexToHsv, hsvToHex, normalizeHex, type HSV } from '../../engine/model/color';
import { PORTAL_SURFACE_ATTR } from './portalSurface';

interface Props {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  /**
   * The selected objects disagree on this colour.
   *
   * The trigger shows a split swatch rather than one of the values — see the
   * note on the swatch itself.
   */
  mixed?: boolean;
  /**
   * The colour's own alpha, 0..1, where the value being edited has somewhere
   * to store one.
   *
   * Optional because most colours here do not: a stroke colour, a text colour
   * and a shadow colour are plain hex strings, and offering an alpha slider
   * that writes nowhere is the exact failure the object registry's header
   * warns about. Only a solid fill's paint carries `opacity`, so only it
   * passes these.
   */
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
}

/**
 * Colours already on this board, newest first.
 *
 * Kept in `localStorage` rather than in the document: which colours *you* have
 * reached for is a fact about you, not about the board, so it must not appear
 * in anyone else's picker or enter the update log. Same call the comment read
 * marks and the tag filter make.
 */
const RECENTS_KEY = 'vega_recent_colors';
const MAX_RECENTS = 10;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    // A corrupt or unavailable store must not take the picker down with it.
    return [];
  }
}

function pushRecent(color: string): void {
  try {
    const next = [color, ...readRecents().filter((c) => c !== color)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage is a nicety here, never a requirement */
  }
}

/**
 * A palette that spans the space, rather than eight arbitrary pastels.
 *
 * What was here before was eight named pastel swatches — "Mint", "Peach" — with
 * emoji, which is a sticky-note palette and was being offered as the entire
 * colour system for strokes, text and shadows. There was no black, no white
 * that was not also the page, and no way to reach a saturated colour at all.
 *
 * Two rows: a neutral ramp, because most strokes and most text are grey, and a
 * hue ramp at one saturation so the row reads as a spectrum instead of as a
 * bag of colours.
 */
const NEUTRALS = ['transparent', '#000000', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#F3F4F6', '#FFFFFF'];
const HUES = ['#EF4444', '#F97316', '#F59E0B', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899'];

/** The checkerboard that says "this is see-through" rather than "this is grey". */
const CHECKER =
  'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';

/** The standard diagonal red sash over checkerboard representing None / Transparent. */
const NO_FILL_PATTERN =
  `linear-gradient(to top right, transparent calc(50% - 1.5px), #EF4444 calc(50% - 1.5px), #EF4444 calc(50% + 1.5px), transparent calc(50% + 1.5px)), ${CHECKER}`;

export const ColorPickerPopover: React.FC<Props> = ({
  color,
  onChange,
  label,
  mixed = false,
  opacity,
  onOpacityChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const isNone = color === 'transparent' || opacity === 0;
  const displayColor = !color || color === 'transparent' ? '#000000' : color;
  const hsv = hexToHsv(displayColor) ?? { h: 0, s: 0, v: 0 };
  const alpha = isNone ? 0 : (opacity ?? 1);

  /**
   * Commit a colour, and remember it.
   *
   * Every path into the picker funnels through here so that the recents list
   * cannot drift from what was actually applied.
   */
  const commit = useCallback(
    (next: string) => {
      onChange(next);
      if (next !== 'transparent') pushRecent(next);
      // Re-read rather than waiting for the next open: the whole point of a
      // recents row is the colour you just used being there.
      setRecents(readRecents());
    },
    [onChange]
  );

  const setHsv = (patch: Partial<HSV>) => {
    const nextHex = hsvToHex({ ...hsv, ...patch });
    commit(nextHex);
    if (opacity === 0 && onOpacityChange) onOpacityChange(1);
  };

  useEffect(() => {
    if (isOpen) {
      setRecents(readRecents());
      setHexDraft(isNone ? 'NONE' : displayColor.toUpperCase());
    }
    // `displayColor` deliberately absent: reopening should re-seed the field,
    // but a colour changing *while* the picker is open must not overwrite what
    // is being typed into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * Place the popover in the viewport, not in the panel.
   *
   * Rendered through a portal and positioned `fixed`, because both places this
   * is used clip it otherwise: the Properties panel is a 230px column with
   * `overflow-y: auto`, and the object toolbar floats near the canvas edge. The
   * comments overlay learned the same thing — the focused surface floats, and
   * only the focused surface.
   */
  useLayoutEffect(() => {
    if (!isOpen) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = 248;
      const height = popoverRef.current?.offsetHeight ?? 340;
      const margin = 8;

      // Prefer below-and-left-aligned, then flip above, then clamp — a picker
      // pinned to the right-hand panel opens past the window edge otherwise.
      let top = trigger.bottom + margin;
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, trigger.top - height - margin);
      }
      let left = trigger.left + trigger.width / 2 - width / 2;
      left = Math.min(left, window.innerWidth - width - margin);
      left = Math.max(margin, left);
      setPosition({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    // Capture, so Escape closes the picker rather than clearing the canvas
    // selection underneath it.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen]);

  /**
   * Drag anywhere in a track, including outside it.
   *
   * Pointer capture rather than window listeners: the pointer routinely leaves
   * a 160px square mid-drag, and a control that stops following it there feels
   * broken in a way that is hard to name and impossible to miss.
   */
  const trackHandlers = (onMove: (fx: number, fy: number) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      );
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      );
    },
  });

  const swatchBackground = mixed
    ? // Not one of the values, and not a colour of its own: a bar across the
      // swatch says "several" without claiming any of them is the answer.
      'linear-gradient(135deg, #EF4444 0 33%, #3B82F6 33% 66%, #F59E0B 66% 100%)'
    : isNone
      ? NO_FILL_PATTERN
      : alpha < 1
        ? `linear-gradient(${displayColor}, ${displayColor}), ${CHECKER}`
        : displayColor;

  const commitHex = () => {
    const raw = hexDraft.trim().toLowerCase();
    if (raw === 'none' || raw === 'transparent') {
      commit('transparent');
      if (onOpacityChange) onOpacityChange(0);
      return;
    }
    const parsed = normalizeHex(hexDraft);
    if (parsed) {
      commit(parsed);
      if (opacity === 0 && onOpacityChange) onOpacityChange(1);
    } else {
      setHexDraft(isNone ? 'NONE' : displayColor.toUpperCase());
    }
  };

  const handlePick = (c: string) => {
    if (c === 'transparent') {
      commit('transparent');
      if (onOpacityChange) onOpacityChange(0);
    } else {
      commit(c);
      if (opacity === 0 && onOpacityChange) onOpacityChange(1);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}>
      {label && <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '4px' }}>{label}</span>}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={mixed ? 'Mixed colours — open the colour picker' : isNone ? 'No fill / Transparent' : `Colour ${displayColor}`}
        onClick={() => setIsOpen((v) => !v)}
        className={`cp-trigger${isOpen ? ' is-open' : ''}`}
        style={{
          background: swatchBackground,
          backgroundBlendMode: !mixed && !isNone && alpha < 1 ? 'normal' : undefined,
        }}
      />

      {isOpen && position && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Colour picker"
          // Marks this as UI rather than "outside", for every ancestor that
          // closes on an outside click. Without it the fill editor above this
          // dismissed itself the moment you touched a swatch.
          {...{ [PORTAL_SURFACE_ATTR]: 'color-picker' }}
          className="cp-popover"
          style={{ top: position.top, left: position.left }}
        >
          {/* Saturation against value, at the current hue. The handle takes a
              ring in whichever of black or white will show against the colour
              under it — a fixed white ring vanishes on a pale fill. */}
          <div
            {...trackHandlers((fx, fy) => setHsv({ s: fx, v: 1 - fy }))}
            role="application"
            aria-label="Saturation and brightness"
            style={{
              position: 'relative', height: 132, borderRadius: 8, cursor: 'crosshair',
              touchAction: 'none',
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`,
            }}
          >
            <div
              style={{
                position: 'absolute', width: 12, height: 12, borderRadius: '50%',
                left: `calc(${hsv.s * 100}% - 6px)`, top: `calc(${(1 - hsv.v) * 100}% - 6px)`,
                border: `2px solid ${contrastInk(displayColor)}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.4)', pointerEvents: 'none',
              }}
            />
          </div>

          <Track
            ariaLabel="Hue"
            value={hsv.h / 360}
            onChange={(f) => setHsv({ h: f * 360 })}
            background="linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)"
            handleColor={hsvToHex({ h: hsv.h, s: 1, v: 1 })}
            trackHandlers={trackHandlers}
          />

          {/* Only where the value can hold one — see the prop's note. */}
          {onOpacityChange && (
            <Track
              ariaLabel="Opacity"
              value={alpha}
              onChange={(f) => onOpacityChange(Math.round(f * 100) / 100)}
              background={`linear-gradient(to right, transparent, ${displayColor}), ${CHECKER}`}
              handleColor={displayColor}
              trackHandlers={trackHandlers}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              value={hexDraft}
              spellCheck={false}
              aria-label="Hex colour"
              onChange={(e) => setHexDraft(e.target.value)}
              // Committed on blur and on Enter, never per keystroke: typing
              // `#E11D48` used to write `#E`, `#E1`, `#E11`… repainting the
              // object with garbage on the way to the colour you wanted.
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitHex(); }
                if (e.key === 'Escape') { setHexDraft(isNone ? 'NONE' : displayColor.toUpperCase()); }
              }}
              className="cp-hex"
            />
            {onOpacityChange && (
              <span className="cp-alpha">{Math.round(alpha * 100)}%</span>
            )}
            <EyedropperButton onPick={(picked) => handlePick(picked)} />
          </div>

          <Swatches label="Neutrals" colors={NEUTRALS} current={displayColor} isNone={isNone} onPick={handlePick} />
          <Swatches label="Colours" colors={HUES} current={displayColor} isNone={isNone} onPick={handlePick} />
          {recents.length > 0 && (
            <Swatches label="Recent" colors={recents} current={displayColor} isNone={isNone} onPick={handlePick} />
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

/**
 * A one-dimensional slider drawn as the thing it selects.
 *
 * Arrow keys move it too — the previous picker could only be operated with a
 * mouse, and a hue that can only be reached by dragging is a hue somebody
 * cannot reach at all.
 */
const Track: React.FC<{
  ariaLabel: string;
  value: number;
  onChange: (fraction: number) => void;
  background: string;
  handleColor: string;
  trackHandlers: (onMove: (fx: number, fy: number) => void) => Record<string, unknown>;
}> = ({ ariaLabel, value, onChange, background, handleColor, trackHandlers }) => (
  <div
    {...trackHandlers((fx) => onChange(fx))}
    role="slider"
    tabIndex={0}
    aria-label={ariaLabel}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)}
    onKeyDown={(e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, value - step)); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(1, value + step)); }
      if (e.key === 'Home') { e.preventDefault(); onChange(0); }
      if (e.key === 'End') { e.preventDefault(); onChange(1); }
    }}
    style={{
      position: 'relative', height: 12, borderRadius: 999, background,
      cursor: 'ew-resize', touchAction: 'none',
    }}
  >
    <div
      style={{
        position: 'absolute', top: '50%', left: `${value * 100}%`,
        transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: '50%',
        background: handleColor, border: '2px solid #fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.45)', pointerEvents: 'none',
      }}
    />
  </div>
);

const Swatches: React.FC<{
  label: string;
  colors: string[];
  current: string;
  isNone?: boolean;
  onPick: (color: string) => void;
}> = ({ label, colors, current, isNone = false, onPick }) => (
  <div className="cp-group">
    <span className="cp-group__label">{label}</span>
    <div className="cp-swatches">
      {colors.map((c) => {
        const isTransparent = c === 'transparent';
        const active = isTransparent ? isNone : (!isNone && c.toUpperCase() === current.toUpperCase());
        return (
          <button
            key={`${label}-${c}`}
            type="button"
            aria-label={isTransparent ? 'No fill / None' : c}
            aria-pressed={active}
            data-tooltip={isTransparent ? 'No fill / None' : c.toUpperCase()}
            onClick={() => onPick(c)}
            // The selected ring is the accent, not a hardcoded blue: it used
            // to fall back to `#3B82F6`, which is neither the focus ring nor
            // anything else in the system.
            className={`cp-swatch${isTransparent ? ' cp-swatch--none' : ''}${active ? ' is-active' : ''}`}
            style={{
              background: isTransparent ? NO_FILL_PATTERN : c,
            }}
          />
        );
      })}
    </div>
  </div>
);
