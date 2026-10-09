import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Search, Star, X } from 'lucide-react';
import {
  getPinnedShapes,
  getRecentShapes,
  subscribePinnedShapes,
  subscribeRecentShapes,
  togglePinnedShape,
} from '../../engine/tools/recentShapes';
import { placeShapeAt } from '../../engine/tools/ShapeTool';
import { TOOL_SHORTCUTS } from '../../engine/tools/shortcuts';
import { editor } from '../../engine/api/EditorAPI';
import { cameraSystem } from '../../engine/CameraSystem';
import { prefersReducedMotion } from '../../engine/cameraMotion';
import { canUseTool } from '../../engine/model/permissions';
import { ThemeService } from '../../engine/ThemeService';
import { shapeToPath } from '../../engine/model/shapeToPath';
import { shapeFeaturePaths } from '../../engine/model/shapeOutline';
import { contourData } from '../../engine/model/pathGeometry';
import type { ShapeNode } from '../../engine/model/schema';
import { ShapeIcon } from './shapeIcons';
import { SHAPE_BY_PRESET, placedSize, shapeToolId, type ShapePreset } from './shapeCatalog';
import {
  FAMILY_SECTIONS,
  LIBRARY_GRID,
  LIBRARY_LAYOUT,
  LIBRARY_PRESETS,
  QUICK_SHAPES,
  clientToBoard,
  enterAt,
  gridMove,
  librarySections,
  searchShapes,
  suggestShapes,
  type GridKey,
  type LibrarySection,
} from './shapeLibrary';
import './shapeLibrary.css';

/**
 * The Shape seat's library: every shape, searchable, on one scroll.
 *
 * ## Layout
 *
 * A search field and a jump control on top, then one scroll: the common eight,
 * the shapes you pinned, the ones you used lately, and every family with its
 * heading pinned to the top while you are in it. Each shape appears once per
 * family and once in a search. The body holds a fixed height, so filtering
 * never resizes the flyout under the pointer, and it is clamped to the
 * viewport so a short window still reaches the search.
 *
 * ## What a tile does
 *
 * - **Click** arms the Shape tool with it and folds the library back to the
 *   seat's row, which stays open (see `seatMenuModel`).
 * - **Shift+click** arms it and keeps the library open.
 * - **Drag** it onto the board to place one where you let go, at its natural
 *   size. The library stays open, so several can be dragged out in a row.
 * - **Enter** places one in the middle of the view, offset from the last one
 *   placed there so a run of them does not stack invisibly.
 * - **\*** pins or unpins it; so does the star on its corner.
 *
 * Resting on a tile for 300ms, or reaching it from the keyboard, shows a card
 * with a larger picture, the name, the one-line description, the other names
 * it answers to, and its key when it has one.
 *
 * ## Keyboard
 *
 * Tab moves between the search, the jump control and each section; the arrows
 * move inside a section by the grid's drawn columns and carry on into the
 * next section in the same column. Typing on a tile goes to the search rather
 * than to the board's one-key tools. Escape clears the search, then closes the
 * library and puts focus back on the seat.
 *
 * Previews are drawn by `ShapeIcon` and the card's `Specimen`, both from the
 * contour the canvas draws, so the library cannot show a shape the board will
 * not make.
 */

const COLS = LIBRARY_LAYOUT.cols;
/** The tile measurements, handed to the stylesheet. See `LIBRARY_LAYOUT`. */
const LAYOUT_VARS = {
  width: LIBRARY_LAYOUT.width,
  '--shape-lib-cols': String(LIBRARY_LAYOUT.cols),
  '--shape-lib-tile': `${LIBRARY_LAYOUT.tile}px`,
  '--shape-lib-gap': `${LIBRARY_LAYOUT.gap}px`,
  '--shape-lib-grid': `${LIBRARY_GRID}px`,
} as React.CSSProperties;
const HOVER_DELAY = 300;

/**
 * The icon library's entry, offered only once the library exists.
 *
 * A build-time question rather than a runtime one: the glob is empty until
 * `components/icons/IconBrowser.tsx` is written, and then the entry appears and
 * asks whoever owns the browser to open it.
 */
const ICON_LIBRARY = Object.keys(import.meta.glob('../icons/IconBrowser.tsx')).length > 0;

type CardState = { preset: ShapePreset; anchor: DOMRect } | null;

interface Props {
  /** The armed shape, ringed in ink. */
  value: ShapePreset | null;
  /** Arm a shape and close the library. */
  onPick: (preset: ShapePreset) => void;
  /** Put the caret in the search on open. */
  focusSearch?: boolean;
  /**
   * Arm a shape and leave the library open (Shift+click). Without it the tool
   * is armed directly through the board's tool-change event.
   */
  onArm?: (preset: ShapePreset) => void;
}

export const ShapeSheet: React.FC<Props> = ({ value, onPick, focusSearch = false, onArm }) => {
  const recent = useSyncExternalStore(subscribeRecentShapes, getRecentShapes, getRecentShapes);
  const pinned = useSyncExternalStore(subscribePinnedShapes, getPinnedShapes, getPinnedShapes);
  const [query, setQuery] = useState('');
  const [card, setCard] = useState<CardState>(null);
  const [family, setFamily] = useState<string>(FAMILY_SECTIONS[0]?.id ?? '');
  const [roving, setRoving] = useState<Record<string, number>>({});
  const [carrying, setCarrying] = useState<ShapePreset | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  /** Set for the click that follows the release of a drag, which must not also arm. */
  const carryEnded = useRef(false);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    []
  );

  const q = query.trim();
  const sections = useMemo<LibrarySection[]>(() => {
    if (!q) return librarySections(recent, pinned);
    const hits = searchShapes(q);
    if (hits.length) return [{ id: 'results', label: `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`, presets: hits }];
    // The nearest names when there are any near enough to be a typo, and the
    // common shapes when the query is nothing like a shape.
    const near = suggestShapes(q);
    return [
      near.length
        ? { id: 'closest', label: 'Closest names', presets: near }
        : { id: 'closest', label: 'Common shapes', presets: QUICK_SHAPES },
    ];
  }, [q, recent, pinned]);
  const empty = Boolean(q) && sections[0]?.id === 'closest';
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  // -- Card ---------------------------------------------------------------

  const showCard = useCallback((preset: ShapePreset, el: HTMLElement, immediate = false) => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(hideTimer.current);
    const open = () => setCard({ preset, anchor: el.getBoundingClientRect() });
    if (immediate) open();
    else hoverTimer.current = window.setTimeout(open, HOVER_DELAY);
  }, []);

  const hideCard = useCallback((soon = false) => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(hideTimer.current);
    if (soon) hideTimer.current = window.setTimeout(() => setCard(null), 120);
    else setCard(null);
  }, []);

  // -- Acting on a tile -----------------------------------------------------

  const arm = (preset: ShapePreset, keepOpen: boolean) => {
    if (!keepOpen) {
      onPick(preset);
      return;
    }
    if (onArm) onArm(preset);
    else window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: shapeToolId(preset) }));
  };

  const placeInView = (preset: ShapePreset) => {
    if (!canUseTool('shape')) return;
    placeShapeAt(editor, preset, nextCentre());
  };

  const tileAt = (section: string, index: number) =>
    bodyRef.current?.querySelector<HTMLButtonElement>(`.shape-lib__tile[data-section="${section}"][data-index="${index}"]`) ?? null;

  const focusTile = (section: string, index: number) => {
    setRoving((r) => (r[section] === index ? r : { ...r, [section]: index }));
    const el = tileAt(section, index);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  };

  /** Close by handing focus back to the seat; the dock's own Escape handling does the closing. */
  const returnToSeat = () => {
    rootRef.current?.closest('.dock-slot')?.querySelector<HTMLButtonElement>(':scope > .dock-btn')?.focus();
  };

  const onTileKey = (e: React.KeyboardEvent<HTMLButtonElement>, sectionIndex: number, index: number, preset: ShapePreset) => {
    const section = sections[sectionIndex];
    if (e.key === 'Escape') {
      hideCard();
      returnToSeat();
      return;
    }
    if (e.key === '*') {
      e.preventDefault();
      e.stopPropagation();
      togglePinnedShape(preset);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      placeInView(preset);
      return;
    }
    // Typing goes to the search, not to the board's one-key tools: an `e`
    // here must not hand over the eraser.
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      setQuery((current) => current + e.key);
      searchRef.current?.focus();
      return;
    }
    const keys: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    // Stopped here so the room does not also pan the board with the arrows.
    e.preventDefault();
    e.stopPropagation();
    const move = gridMove(index, section.presets.length, COLS, e.key as GridKey);
    if ('to' in move) {
      focusTile(section.id, move.to);
      return;
    }
    const nextIndex = sectionIndex + (move.leave === 'down' ? 1 : -1);
    const next = sections[nextIndex];
    if (!next) {
      if (move.leave === 'up') searchRef.current?.focus();
      return;
    }
    focusTile(next.id, enterAt(next.presets.length, COLS, move.column, move.leave === 'down' ? 'above' : 'below'));
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = sections[0];
      if (first) focusTile(first.id, roving[first.id] ?? 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (q && !empty && sections[0]?.presets[0]) placeInView(sections[0].presets[0]);
    } else if (e.key === 'Escape') {
      if (query) {
        // The first Escape clears the search; the next one closes the library.
        e.stopPropagation();
        setQuery('');
      } else {
        returnToSeat();
      }
    }
  };

  // -- Dragging a tile onto the board ------------------------------------------

  const placeGhost = (x: number, y: number, preset: ShapePreset) => {
    const el = ghostRef.current;
    if (!el) return;
    const onBoard = Boolean(document.elementFromPoint(x, y)?.closest('.konvajs-content'));
    const natural = placedSize(preset);
    const zoom = cameraSystem.zoom || 1;
    const fit = onBoard ? Math.min(1, 280 / Math.max(natural.width * zoom, natural.height * zoom)) : 0;
    const w = onBoard ? Math.max(20, natural.width * zoom * fit) : 40;
    const h = onBoard ? Math.max(20, natural.height * zoom * fit) : 40;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    el.dataset.over = onBoard ? 'board' : 'chrome';
  };

  const lastPoint = useRef({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (carrying) placeGhost(lastPoint.current.x, lastPoint.current.y, carrying);
  }, [carrying]);

  const beginCarry = (e: React.PointerEvent<HTMLButtonElement>, preset: ShapePreset) => {
    // A finger on a tile is as likely to be scrolling the sheet as carrying a
    // shape, so touch keeps the scroll and a tap still arms.
    if (e.button !== 0 || e.pointerType === 'touch' || !canUseTool('shape')) return;
    const tile = e.currentTarget;
    const pointerId = e.pointerId;
    const origin = { x: e.clientX, y: e.clientY };
    let carried = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastPoint.current = { x: ev.clientX, y: ev.clientY };
      if (!carried) {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 6) return;
        carried = true;
        try { tile.setPointerCapture(pointerId); } catch { /* already released */ }
        hideCard();
        setCarrying(preset);
        return;
      }
      placeGhost(ev.clientX, ev.clientY, preset);
    };

    const finish = (ev: PointerEvent | null) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey, true);
      if (!carried) return;
      carryEnded.current = true;
      window.setTimeout(() => { carryEnded.current = false; }, 0);
      try { tile.releasePointerCapture(pointerId); } catch { /* already released */ }
      setCarrying(null);
      if (!ev) return;
      const stage = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.konvajs-content');
      if (!stage) return;
      const at = clientToBoard({ x: ev.clientX, y: ev.clientY }, stage.getBoundingClientRect(), cameraSystem);
      if (Number.isFinite(at.x) && Number.isFinite(at.y)) placeShapeAt(editor, preset, at);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(ev);
    };
    const cancel = () => finish(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !carried) return;
      ev.stopPropagation();
      finish(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey, true);
  };

  // -- The jump control -------------------------------------------------------

  const jump = (id: string) => {
    hideCard();
    if (query) setQuery('');
    setFamily(id);
    // After the families are back on the scroll, if a search had replaced them.
    requestAnimationFrame(() => {
      const body = bodyRef.current;
      const target = body?.querySelector<HTMLElement>(`[data-family="${id}"]`);
      if (!body || !target) return;
      body.scrollTo({ top: target.offsetTop, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  };

  const onBodyScroll = () => {
    hideCard();
    const body = bodyRef.current;
    if (!body || q) return;
    let current = FAMILY_SECTIONS[0]?.id ?? '';
    for (const el of Array.from(body.querySelectorAll<HTMLElement>('[data-family]'))) {
      if (el.offsetTop - body.scrollTop <= 48) current = el.dataset.family ?? current;
    }
    if (current !== family) setFamily(current);
  };

  const onJumpKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const at = FAMILY_SECTIONS.findIndex((f) => f.id === family);
    const next = FAMILY_SECTIONS[(at + (e.key === 'ArrowRight' ? 1 : -1) + FAMILY_SECTIONS.length) % FAMILY_SECTIONS.length];
    jump(next.id);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-jump="${next.id}"]`)?.focus();
  };

  // -- Render -------------------------------------------------------------------

  const rovingIndex = (section: LibrarySection) => {
    const stored = roving[section.id];
    if (stored !== undefined && stored < section.presets.length) return stored;
    const current = value ? section.presets.indexOf(value) : -1;
    return current >= 0 ? current : 0;
  };

  return (
    <div className="shape-lib" ref={rootRef} style={LAYOUT_VARS} data-carrying={carrying ? '' : undefined}>
      <div className="shape-lib__head">
        <label className="shape-lib__search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={`Search ${LIBRARY_PRESETS.length} shapes`}
            aria-label="Search shapes"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {query && (
            <button
              type="button"
              className="shape-lib__clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="shape-lib__jump" role="group" aria-label="Jump to a family" onKeyDown={onJumpKey}>
          {FAMILY_SECTIONS.map((f) => {
            const on = !q && f.id === family;
            return (
              <button
                key={f.id}
                type="button"
                data-jump={f.id}
                aria-current={on ? 'true' : undefined}
                tabIndex={f.id === family ? 0 : -1}
                onClick={() => jump(f.id)}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="shape-lib__body" ref={bodyRef} onScroll={onBodyScroll} onMouseLeave={() => hideCard(true)}>
        {empty && (
          <p className="shape-lib__empty" role="status">
            No shapes match “{q}”
          </p>
        )}
        {sections.map((section, sectionIndex) => {
          const active = rovingIndex(section);
          return (
            <section
              key={section.id}
              className="shape-lib__section"
              data-family={section.family ? section.id : undefined}
              data-kind={section.id}
              role="group"
              aria-label={section.label}
            >
              {section.id !== 'quick' && (
                <div className="shape-lib__heading" aria-hidden="true">
                  {section.label}
                </div>
              )}
              <div className="shape-lib__grid">
                {section.presets.map((preset, index) => {
                  const entry = SHAPE_BY_PRESET[preset];
                  const on = value === preset;
                  const isPinned = pinnedSet.has(preset);
                  return (
                    <div key={preset} className="shape-lib__cell">
                      <button
                        type="button"
                        className="shape-lib__tile"
                        role="menuitemradio"
                        aria-checked={on}
                        aria-label={`${entry.label}. ${entry.hint}`}
                        aria-keyshortcuts="Enter *"
                        data-section={section.id}
                        data-index={index}
                        data-current={on || undefined}
                        tabIndex={index === active ? 0 : -1}
                        onClick={(e) => {
                          if (carryEnded.current) return;
                          hideCard();
                          arm(preset, e.shiftKey);
                        }}
                        onPointerDown={(e) => {
                          hideCard();
                          beginCarry(e, preset);
                        }}
                        onMouseEnter={(e) => showCard(preset, e.currentTarget, card !== null)}
                        onMouseLeave={() => hideCard(true)}
                        onFocus={(e) => {
                          setRoving((r) => (r[section.id] === index ? r : { ...r, [section.id]: index }));
                          if (e.currentTarget.matches(':focus-visible')) showCard(preset, e.currentTarget, card !== null);
                        }}
                        onBlur={() => hideCard(true)}
                        onKeyDown={(e) => onTileKey(e, sectionIndex, index, preset)}
                      >
                        <ShapeIcon kind={preset} size={22} />
                      </button>
                      <button
                        type="button"
                        className="shape-lib__pin"
                        tabIndex={-1}
                        aria-pressed={isPinned}
                        aria-label={isPinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
                        onClick={() => togglePinnedShape(preset)}
                        onMouseEnter={() => window.clearTimeout(hideTimer.current)}
                      >
                        <Star size={10} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!q && ICON_LIBRARY && (
          <button
            type="button"
            className="shape-lib__icons"
            onClick={() => window.dispatchEvent(new CustomEvent('vega:open-icon-library'))}
          >
            Icons
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {card && <PreviewCard preset={card.preset} anchor={card.anchor} sheet={rootRef.current} pinned={pinnedSet.has(card.preset)} />}
      {carrying &&
        createPortal(
          <div ref={ghostRef} className="shape-lib-ghost" aria-hidden="true">
            <Specimen preset={carrying} filled />
          </div>,
          document.body
        )}
    </div>
  );
};

/**
 * Where Enter puts a shape: the middle of the view, stepped down and right
 * from the last one placed there while the view has not moved.
 */
let lastCentre: { x: number; y: number; n: number } | null = null;
function nextCentre(): { x: number; y: number } {
  const centre = cameraSystem.screenToWorld(cameraSystem.width / 2, cameraSystem.height / 2);
  const same = lastCentre && Math.hypot(lastCentre.x - centre.x, lastCentre.y - centre.y) < 1;
  const n = same && lastCentre ? lastCentre.n + 1 : 0;
  lastCentre = { ...centre, n };
  const step = 24 / (cameraSystem.zoom || 1);
  return { x: centre.x + n * step, y: centre.y + n * step };
}

/**
 * A preset drawn as the board draws it, at its natural proportions: the
 * outline from `shapeToPath` and the interior lines from `shapeFeaturePaths`.
 * Scaled by its `viewBox`, with the stroke held to screen pixels.
 */
const Specimen: React.FC<{ preset: ShapePreset; filled?: boolean }> = ({ preset, filled }) => {
  const drawing = useMemo(() => {
    const entry = SHAPE_BY_PRESET[preset];
    const { width, height } = placedSize(preset);
    const node = {
      geometry: entry.geometry,
      width,
      height,
      appearance: entry.cornerRadiusRatio ? { cornerRadius: Math.min(width, height) * entry.cornerRadiusRatio } : undefined,
    } as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'>;
    return { width, height, outline: contourData(shapeToPath(node)), features: shapeFeaturePaths(node) };
  }, [preset]);
  const pad = 4;
  const fill = filled ? ThemeService.getDefaultShapeFill() : 'var(--shape-lib-specimen-fill, var(--surface-primary))';
  const ink = filled ? ThemeService.getDefaultStrokeColor() : 'currentColor';
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${drawing.width + pad * 2} ${drawing.height + pad * 2}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path d={drawing.outline} fill={fill} fillRule="evenodd" stroke={ink} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {drawing.features.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={ink} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
};

/**
 * The card a resting pointer earns: the shape larger, its name, what it is
 * for, what else it is called, and its key.
 *
 * Beside the library rather than over it, on whichever side has room, and
 * level with the tile. Fixed to the window, because the flyout's own box is
 * the wrong thing to be positioned in: the card must not be clipped by it or
 * widen it.
 */
const CARD_WIDTH = 236;
const PreviewCard: React.FC<{ preset: ShapePreset; anchor: DOMRect; sheet: HTMLElement | null; pinned: boolean }> = ({
  preset,
  anchor,
  sheet,
  pinned,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const entry = SHAPE_BY_PRESET[preset];
  const key = TOOL_SHORTCUTS[shapeToolId(preset)];
  const aliases = (entry.keywords ?? []).slice(0, 6);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bounds = (sheet ?? el).getBoundingClientRect();
    const gap = 12;
    const left = bounds.left - CARD_WIDTH - gap >= 8 ? bounds.left - CARD_WIDTH - gap : Math.min(bounds.right + gap, window.innerWidth - CARD_WIDTH - 8);
    const height = el.offsetHeight;
    const top = Math.max(8, Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset.ready = '';
  }, [anchor, sheet, preset]);

  return createPortal(
    <div ref={ref} className="shape-lib-card" role="tooltip" style={{ width: CARD_WIDTH }}>
      <div className="shape-lib-card__picture">
        <Specimen preset={preset} />
      </div>
      <div className="shape-lib-card__title">
        <span className="shape-lib-card__name">{entry.label}</span>
        {key && <kbd className="shape-lib-card__key">{key}</kbd>}
        {pinned && (
          <span className="shape-lib-card__pinned">
            <Star size={10} aria-hidden="true" /> Pinned
          </span>
        )}
      </div>
      <p className="shape-lib-card__hint">{entry.hint}</p>
      {aliases.length > 0 && <p className="shape-lib-card__aliases">Also {aliases.join(', ')}</p>}
    </div>,
    document.body
  );
};
