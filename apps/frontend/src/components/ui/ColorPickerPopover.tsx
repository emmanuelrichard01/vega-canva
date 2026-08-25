import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyedropperButton } from './EyedropperButton';
import { contrastInk, hexToHsv, hsvToHex, normalizeHex, type HSV } from '../../engine/model/color';
import { CURATED_PALETTES, paletteOf, tintsAndShades } from '../../engine/model/colorRamp';
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
  /**
   * Which source of ready-made colours is showing.
   *
   * ## Why tabs rather than a scrolling list
   *
   * Four stacked sources -- a derived ramp, neutrals, hues, fourteen curated
   * palettes and your recents -- came to about five hundred pixels, which is
   * most of a laptop's height for a popover attached to a 24px swatch.
   *
   * The obvious fix is to cap the tall one and let it scroll, and this project
   * has already tried that twice on the identical control in the grid panel:
   * three rows visible, then six, and neither was enough to *compare* in --
   * which is the entire reason the ramps are shown side by side instead of
   * hidden behind a dropdown. A picker you have to scroll to see the options in
   * is a dropdown with extra steps. It would also be a scroll region nested
   * inside a popover that already scrolls, where the wheel does whichever of
   * the two you did not mean.
   *
   * Tabs solve the height without taking the comparison away: each source is
   * whole when you are looking at it, and none of them costs height when you
   * are not. The one thing that stays pinned is the shade ramp, because it is
   * derived from the colour currently in hand and is the row people reach for
   * most -- putting it behind a click would hide the picker's best answer.
   */
  const [source, setSource] = useState<'palettes' | 'swatches' | 'recent'>('palettes');
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
      const width = 268;
      const height = popoverRef.current?.offsetHeight ?? 480;
      const margin = 8;

      // Prefer below-and-left-aligned, then flip above, then clamp — a picker
      // pinned to the right-hand panel opens past the window edge otherwise.
      /**
       * Below, then above, then clamped to the viewport.
       *
       * The clamp is the part that matters now the picker is taller: with
       * palettes and a shade ramp it can exceed the window on a short display,
       * and both preferred placements then run off an edge. `max-height` on the
       * popover lets it scroll inside itself rather than being cut off, and
       * pinning the top to the margin is what keeps its own scrollbar reachable.
       */
      let top = trigger.bottom + margin;
      if (top + height > window.innerHeight - margin) {
        top = trigger.top - height - margin;
      }
      top = Math.min(top, Math.max(margin, window.innerHeight - height - margin));
      top = Math.max(margin, top);
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

  /**
   * Recomputed only when the colour changes, not on every drag frame.
   *
   * Nine `hexToHsv` / `hsvToHex` round trips is nothing on its own and is
   * something at sixty a second while a saturation drag is live -- and the
   * answer is identical for every frame that lands on the same hex.
   */
  const shades = useMemo(() => tintsAndShades(displayColor, 9), [displayColor]);

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
            className="cp-field"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`,
            }}
          >
            {/* The handle takes a ring in whichever of black or white will show
                against the colour under it. A fixed white ring vanishes on a
                pale fill, which is exactly where precision matters most. */}
            <div
              className="cp-field__handle"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                borderColor: contrastInk(displayColor),
                background: displayColor,
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

          {/**
            * This colour's own family, before anybody else's.
            *
            * The question people arrive at a picker with is almost never "what
            * colours exist" -- it is *this one, but lighter*, and neither a
            * fixed swatch set nor a saturation-value field answers it. The
            * swatches are somebody else's colours; the field asks you to hold a
            * hue steady by eye while moving one axis, which is the one thing a
            * two-axis drag is worst at.
            *
            * Derived, so it is always this colour's ramp, and consistent across
            * hues -- the third step of a blue and the third step of a red sit
            * the same distance from their parents. That is what makes a set of
            * tints picked here hold together as a set.
            */}
          <div className="cp-group">
            <span className="cp-group__label">Shades</span>
            <div className="cp-ramp" role="group" aria-label="Tints and shades of the current colour">
              {shades.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="cp-ramp__step"
                  aria-label={c}
                  data-tooltip={c.toUpperCase()}
                  data-active={(!isNone && c.toUpperCase() === displayColor.toUpperCase()) || undefined}
                  style={{ background: c }}
                  onClick={() => handlePick(c)}
                />
              ))}
            </div>
          </div>

          <div className="cp-tabs" role="tablist" aria-label="Colour sources">
            {([
              ['palettes', 'Palettes'],
              ['swatches', 'Swatches'],
              ['recent', 'Recent'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={source === id}
                className="cp-tab"
                data-active={source === id || undefined}
                // Empty is still worth showing, greyed: a tab that appeared
                // only once you had used a colour would move the other two
                // under the pointer the first time you picked one.
                disabled={id === 'recent' && recents.length === 0}
                onClick={() => setSource(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="cp-panel" role="tabpanel">
            {source === 'palettes' && (
              /**
               * The curated ramps, the same ones the grid generator offers.
               *
               * They were the best colour affordance in the app and reachable
               * from exactly one panel, while every stroke and every piece of
               * text went through a row of nine flat hues. Two standards for one
               * decision, with the good one hidden.
               *
               * Presented as whole ramps rather than as a wall of eighty-four
               * swatches, because the ramp is the unit worth choosing from: the
               * colours in a row are related, and shown together they say so.
               * Every chip is still its own target.
               */
              <div className="cp-palettes">
                {CURATED_PALETTES.map((palette) => (
                  <div
                    key={palette.id}
                    className="cp-palette"
                    data-active={(!isNone && paletteOf(displayColor) === palette.id) || undefined}
                  >
                    {palette.colors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="cp-palette__chip"
                        aria-label={`${palette.name} ${c}`}
                        data-tooltip={`${palette.name} · ${c.toUpperCase()}`}
                        data-active={(!isNone && c.toUpperCase() === displayColor.toUpperCase()) || undefined}
                        style={{ background: c }}
                        onClick={() => handlePick(c)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {source === 'swatches' && (
              <>
                <Swatches label="Neutrals" colors={NEUTRALS} current={displayColor} isNone={isNone} onPick={handlePick} />
                <Swatches label="Colours" colors={HUES} current={displayColor} isNone={isNone} onPick={handlePick} />
              </>
            )}

            {source === 'recent' && (
              <Swatches label="On this board" colors={recents} current={displayColor} isNone={isNone} onPick={handlePick} />
            )}
          </div>
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
    className="cp-track"
    style={{ background }}
  >
    <div className="cp-track__handle" style={{ left: `${value * 100}%`, background: handleColor }} />
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
