import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  MonitorPlay,
  Palette,
  Play,
  Plus,
  StickyNote,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { notify } from '../../engine/ui/notices';
import { Menu } from '../menu/Menu';
import type { MenuEntry } from '../menu/menuModel';
import { Popover } from '../ui/Popover';
import { Emoji } from '../emoji/Emoji';
import type { DeckSlide } from '../../engine/slides/deck';
import { slideFields, TRANSITIONS, type SlideTransition } from '../../engine/slides/slideMeta';
import { DEFAULT_THEME, deckTheme, themeOfFrame, type DeckTheme } from '../../engine/slides/themes';
import type { LayoutId } from '../../engine/slides/layouts';
import {
  applyDeckTheme,
  deleteSlides,
  duplicateSlides,
  moveSlides,
  setSlideSection,
  setSlidesHidden,
  setSlideTransition,
} from '../../engine/slides/deckEdits';
import { insertLayoutSlide } from '../../engine/slides/insertSlide';
import { copySlidePng } from '../../engine/slides/slideRaster';
import { LayoutPicker, ThemeRow } from './LayoutPicker';
import { SlideThumb } from './SlideThumb';
import { goToSlide, startPresenting, useDarkTheme, useDeck } from './useSlides';
import { TransitionGlyph } from './TransitionGlyph';
import './slides.css';

/** The app's export dialog, loaded when the deck is exported. */
const ExportModal = lazy(() => import('../ui/ExportModal').then((m) => ({ default: m.ExportModal })));

/**
 * The slide view: the whole deck as a grid, as Figma Slides' grid view.
 *
 * Everything about the deck that is awkward on a canvas is easy here: the
 * order (drag a slide, or several, to a new place), sections (a named divider
 * the grid and the presenter view both show), skipping, duplicating, deleting,
 * a theme for the whole deck or a selection, the transition into each slide,
 * and a new slide from a layout. Double-click a slide, or press Enter on it, to
 * go to it on the board.
 *
 * Keyboard: arrows move between slides, Shift extends the selection, Space
 * toggles one, Alt+arrows move the selection through the deck, Mod+D
 * duplicates, H skips or shows, Delete deletes, Mod+A selects all.
 *
 * Viewers see the same grid read-only and can present from it; the edits are
 * editor-only and refuse at the write as well as being absent from the UI.
 */
export interface SlideViewProps {
  onClose: () => void;
  focusId?: string;
}

/** The theme new slides take when the deck has none yet; a per-person convenience. */
const ORIGIN_KEY = 'vega:slide-view-theme';

export default function SlideView({ onClose, focusId }: SlideViewProps) {
  const { deck, objects } = useDeck();
  const { canEdit, canExport } = useRoomPermissions();
  const dark = useDarkTheme();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(focusId ? [focusId] : []));
  const [cursor, setCursor] = useState<string | null>(focusId ?? deck[0]?.frame.id ?? null);
  const anchorRef = useRef<string | null>(focusId ?? null);
  const [dragging, setDragging] = useState<Set<string> | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ which: 'present' | 'transition'; rect: DOMRect } | null>(null);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const themeRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLOListElement>(null);

  const [theme, setTheme] = useState<DeckTheme>(() => {
    const last = deck[deck.length - 1]?.frame;
    return themeOfFrame(last) ?? readStoredTheme() ?? DEFAULT_THEME;
  });

  const trapRef = useFocusTrap(true);

  const ids = useMemo(() => deck.map((s) => s.frame.id), [deck]);
  // A slide deleted elsewhere leaves the selection.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)));
      return next.size === prev.size ? prev : next;
    });
    if (cursor && !ids.includes(cursor)) setCursor(ids[0] ?? null);
  }, [ids, cursor]);

  const focusCard = useCallback((id: string | null) => {
    if (!id) return;
    setCursor(id);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-slide="${CSS.escape(id)}"]`)?.focus());
  }, []);

  // Land on the requested slide, scrolled into view.
  useEffect(() => {
    focusCard(focusId ?? ids[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selection = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const target = selection.length > 0 ? selection : cursor ? [cursor] : [];
  const hiddenCount = deck.filter((s) => s.hidden).length;

  const select = (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey && anchorRef.current) {
      const a = ids.indexOf(anchorRef.current);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(ids.slice(lo, hi + 1)));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
    } else {
      setSelected(new Set([id]));
      anchorRef.current = id;
    }
    setCursor(id);
  };

  const go = (id: string) => {
    onClose();
    goToSlide(id);
  };

  // -- edits ---------------------------------------------------------------

  const duplicate = () => {
    const made = duplicateSlides(target);
    if (made.length) {
      setSelected(new Set(made));
      focusCard(made[made.length - 1]);
    }
  };

  const remove = () => {
    if (target.length === 0) return;
    const at = ids.indexOf(target[0]);
    deleteSlides(target);
    notify({ message: target.length === 1 ? 'Slide deleted. Undo with Mod+Z.' : `${target.length} slides deleted. Undo with Mod+Z.`, tone: 'info' });
    const remaining = ids.filter((id) => !target.includes(id));
    setSelected(new Set());
    focusCard(remaining[Math.min(at, remaining.length - 1)] ?? null);
  };

  const allHidden = target.length > 0 && target.every((id) => slideFields(objects[id] as FrameNode).slideHidden);
  const toggleSkip = () => setSlidesHidden(target, !allHidden);

  const nudge = (dir: -1 | 1) => {
    const moving = new Set(target);
    const positions = ids.map((id, i) => (moving.has(id) ? i : -1)).filter((i) => i >= 0);
    if (positions.length === 0) return;
    const to = dir < 0 ? positions[0] - 1 : positions[positions.length - 1] + 2;
    if (to < 0 || to > ids.length) return;
    moveSlides(moving, to);
    if (cursor) focusCard(cursor);
  };

  const addSlide = (layout: LayoutId) => {
    const after = cursor ?? ids[ids.length - 1] ?? null;
    const name = `Slide ${ids.length + 1}`;
    const id = insertLayoutSlide(layout, theme, after, name);
    setLayoutsOpen(false);
    if (id) {
      setSelected(new Set([id]));
      focusCard(id);
    }
  };

  const pickTheme = (next: DeckTheme) => {
    setTheme(next);
    storeTheme(next.id);
  };

  const applyTheme = (next: DeckTheme, scope: 'selection' | 'all') => {
    pickTheme(next);
    const frames = scope === 'all' ? ids : target;
    const n = applyDeckTheme(next, frames);
    if (n) notify({ message: `${next.label} applied to ${n === ids.length ? 'every slide' : n === 1 ? 'one slide' : `${n} slides`}.`, tone: 'success' });
    setThemesOpen(false);
  };

  /** The deck goes out through the app's one export dialog, which knows slides, progress and cancelling. */
  const [exportOpen, setExportOpen] = useState(false);

  const copyPng = async (id: string) => {
    const result = await copySlidePng(id);
    notify(result.ok ? { message: 'Slide copied as PNG.', tone: 'success' } : { message: result.message ?? 'Could not copy the slide.', tone: 'warning' });
  };

  // -- keyboard ------------------------------------------------------------

  const columns = () => {
    const grid = gridRef.current;
    if (!grid) return 1;
    const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, tracks);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selected.size > 1) setSelected(new Set(cursor ? [cursor] : []));
      else onClose();
      return;
    }
    if (!card) return;
    const id = card.dataset.slide!;
    const at = ids.indexOf(id);
    const step = (n: number) => {
      const next = ids[Math.max(0, Math.min(ids.length - 1, at + n))];
      if (!next) return;
      e.preventDefault();
      if (e.shiftKey) select(next, { shiftKey: true, metaKey: false, ctrlKey: false });
      focusCard(next);
    };
    if (e.altKey && canEdit && (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudge(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowRight') return step(1);
    if (e.key === 'ArrowLeft') return step(-1);
    if (e.key === 'ArrowDown') return step(columns());
    if (e.key === 'ArrowUp') return step(-columns());
    if (e.key === 'Home') return step(-at);
    if (e.key === 'End') return step(ids.length - 1 - at);
    if (e.key === 'Enter') {
      e.preventDefault();
      go(id);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      select(id, { shiftKey: false, metaKey: true, ctrlKey: false });
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(ids));
      return;
    }
    if (!canEdit) return;
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate();
    } else if (!mod && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      toggleSkip();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
    }
  };

  // -- drag ----------------------------------------------------------------

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    if (!canEdit) return;
    const moving = selected.has(id) ? new Set(selected) : new Set([id]);
    if (!selected.has(id)) {
      setSelected(moving);
      anchorRef.current = id;
    }
    setDragging(moving);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', [...moving].join(','));
  };

  const onDragOver = (index: number) => (e: React.DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientX > box.left + box.width / 2 ? index + 1 : index);
  };

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragging && dropAt !== null) moveSlides(dragging, dropAt);
    endDrag();
  };

  // -- menus ---------------------------------------------------------------

  const presentEntries: MenuEntry[] = [
    { kind: 'item', id: 'present', label: 'Present', icon: <Play size={15} />, detail: 'Full screen, from the selected slide', onSelect: () => present({}) },
    {
      kind: 'item',
      id: 'everyone',
      label: 'Present to everyone',
      icon: <Users size={15} />,
      detail: 'Invite the room to follow along',
      onSelect: () => present({ everyone: true }),
    },
    {
      kind: 'item',
      id: 'presenter',
      label: 'Presenter view',
      icon: <MonitorPlay size={15} />,
      detail: 'Notes, timer and next slide in a second window',
      onSelect: () => present({ presenterView: 'window' }),
    },
    {
      kind: 'item',
      id: 'rehearse',
      label: 'Rehearse on this screen',
      icon: <StickyNote size={15} />,
      detail: 'The presenter view over the slides',
      onSelect: () => present({ presenterView: 'split' }),
    },
  ];

  const present = (options: { everyone?: boolean; presenterView?: 'window' | 'split' }) => {
    const start = cursor ?? undefined;
    onClose();
    // After the view has gone, so the presenter measures the board, not the grid.
    requestAnimationFrame(() => startPresenting({ startId: start, ...options }));
  };

  const currentTransition = (() => {
    const values = new Set(target.map((id) => slideFields(objects[id] as FrameNode).transition ?? 'glide'));
    return values.size === 1 ? [...values][0] : null;
  })();

  const transitionEntries: MenuEntry[] = TRANSITIONS.map((t) => ({
    kind: 'item',
    id: t.id,
    label: t.label,
    detail: t.hint,
    radio: true,
    checked: currentTransition === t.id,
    icon: <TransitionGlyph kind={t.id} />,
    onSelect: () => setSlideTransition(target, t.id as SlideTransition | 'glide'),
  }));

  const playable = deck.length - hiddenCount;

  return ReactDOM.createPortal(
    <div
      ref={trapRef}
      className="slide-view"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-view-title"
      onKeyDown={onKeyDown}
    >
      <header className="slide-view__head">
        <div className="slide-view__titles">
          <h2 id="slide-view-title">Slides</h2>
          <span className="slide-view__meta">
            {deck.length === 0
              ? 'No slides yet'
              : `${deck.length} slide${deck.length === 1 ? '' : 's'}${hiddenCount ? ` · ${hiddenCount} skipped` : ''}`}
          </span>
        </div>
        <div className="slide-view__actions">
          {canEdit && (
            <>
              <button ref={newRef} type="button" className="sv-btn" aria-haspopup="dialog" aria-expanded={layoutsOpen} onClick={() => setLayoutsOpen((o) => !o)}>
                <Plus size={15} aria-hidden="true" />
                New slide
              </button>
              <button
                ref={themeRef}
                type="button"
                className="sv-btn"
                aria-haspopup="dialog"
                aria-expanded={themesOpen}
                disabled={deck.length === 0}
                onClick={() => setThemesOpen((o) => !o)}
              >
                <Palette size={15} aria-hidden="true" />
                Theme
              </button>
            </>
          )}
          {canExport && (
            <button type="button" className="sv-btn" onClick={() => setExportOpen(true)} disabled={playable === 0}>
              <Download size={15} aria-hidden="true" />
              Export PDF
            </button>
          )}
          <div className="sv-split">
            <button type="button" className="sv-btn sv-btn--primary" onClick={() => present({})} disabled={playable === 0}>
              <Play size={15} aria-hidden="true" />
              Present
            </button>
            <button
              type="button"
              className="sv-btn sv-btn--primary sv-btn--caret"
              aria-label="More ways to present"
              aria-haspopup="menu"
              disabled={playable === 0}
              onClick={(e) => setMenu({ which: 'present', rect: e.currentTarget.getBoundingClientRect() })}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="sv-icon" onClick={onClose} aria-label="Close the slide view">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {canEdit && selection.length > 0 && (
        <div className="slide-view__bar" role="toolbar" aria-label="Selected slides">
          <span className="slide-view__count">
            {selection.length === 1 ? '1 slide' : `${selection.length} slides`}
          </span>
          <button type="button" className="sv-chip" onClick={duplicate}>
            <Copy size={14} aria-hidden="true" />
            Duplicate
          </button>
          <button type="button" className="sv-chip" onClick={toggleSkip} aria-pressed={allHidden}>
            {allHidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            {allHidden ? 'Show' : 'Skip'}
          </button>
          {selection.length === 1 && (
            <button
              type="button"
              className="sv-chip"
              onClick={() => {
                const id = selection[0];
                if (!slideFields(objects[id] as FrameNode).slideSection) setSlideSection(id, 'New section');
                setEditingSection(id);
              }}
            >
              Section
            </button>
          )}
          <button
            type="button"
            className="sv-chip"
            aria-haspopup="menu"
            onClick={(e) => setMenu({ which: 'transition', rect: e.currentTarget.getBoundingClientRect() })}
          >
            <TransitionGlyph kind={currentTransition ?? 'glide'} />
            {currentTransition ? TRANSITIONS.find((t) => t.id === currentTransition)?.label : 'Mixed'}
          </button>
          {selection.length === 1 && (
            <button type="button" className="sv-chip" onClick={() => void copyPng(selection[0])}>
              <ImageIcon size={14} aria-hidden="true" />
              Copy as PNG
            </button>
          )}
          <span className="slide-view__spacer" />
          <button type="button" className="sv-chip sv-chip--danger" onClick={remove}>
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}

      <div className="slide-view__body" onDragOver={(e) => dragging && e.preventDefault()} onDrop={onDrop}>
        {deck.length === 0 ? (
          <div className="slide-view__empty">
            <h3>Frames are slides</h3>
            <p>
              Every frame on the board is a slide, in reading order. {canEdit ? 'Start the deck from a layout:' : 'An editor can start one.'}
            </p>
            {canEdit && <LayoutPicker theme={theme} onTheme={pickTheme} onPick={addSlide} />}
          </div>
        ) : (
          <ol ref={gridRef} className="slide-grid" aria-label="Slides" aria-multiselectable="true">
            {deck.map((slide) => (
              <React.Fragment key={slide.frame.id}>
                {slide.sectionStart && (
                  <SectionRow
                    slide={slide}
                    canEdit={canEdit}
                    editing={editingSection === slide.frame.id}
                    onEdit={(on) => setEditingSection(on ? slide.frame.id : null)}
                  />
                )}
                <SlideCard
                  slide={slide}
                  objects={objects}
                  dark={dark}
                  selected={selected.has(slide.frame.id)}
                  focused={cursor === slide.frame.id}
                  draggable={canEdit}
                  drop={dropAt === slide.index ? 'before' : dropAt === slide.index + 1 && slide.index === deck.length - 1 ? 'after' : undefined}
                  dimmed={!!dragging?.has(slide.frame.id)}
                  onSelect={(e) => select(slide.frame.id, e)}
                  onOpen={() => go(slide.frame.id)}
                  onDragStart={onDragStart(slide.frame.id)}
                  onDragOver={onDragOver(slide.index)}
                  onDragEnd={endDrag}
                />
              </React.Fragment>
            ))}
          </ol>
        )}
      </div>

      <footer className="slide-view__foot" aria-hidden="true">
        <span>
          <kbd>Enter</kbd> open on the board
        </span>
        {canEdit && (
          <>
            <span>
              <kbd>Alt</kbd> + arrows to move
            </span>
            <span>
              <kbd>H</kbd> skip
            </span>
          </>
        )}
        <span>
          <kbd>Esc</kbd> close
        </span>
      </footer>

      <Popover anchor={newRef} open={layoutsOpen} onClose={() => setLayoutsOpen(false)} label="New slide" align="end" className="slide-popover">
        <LayoutPicker theme={theme} onTheme={pickTheme} onPick={addSlide} />
      </Popover>
      <Popover anchor={themeRef} open={themesOpen} onClose={() => setThemesOpen(false)} label="Deck theme" align="end" className="slide-popover">
        <ThemePanel theme={theme} onPick={pickTheme} onApply={applyTheme} selectionCount={selection.length} />
      </Popover>

      {exportOpen && (
        <Suspense fallback={null}>
          <ExportModal onClose={() => setExportOpen(false)} title={document.title.replace(/\s*[·|–-].*$/, '') || 'Slides'} initialFormat="pdf" initialArea="slides" />
        </Suspense>
      )}

      {menu && (
        <Menu
          label={menu.which === 'present' ? 'Present' : 'Transition into the slide'}
          entries={menu.which === 'present' ? presentEntries : transitionEntries}
          anchor={{ kind: 'rect', rect: menu.rect, prefer: 'below', align: menu.which === 'present' ? 'end' : 'start' }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>,
    document.body
  );
}

const ThemePanel: React.FC<{
  theme: DeckTheme;
  onPick: (t: DeckTheme) => void;
  onApply: (t: DeckTheme, scope: 'selection' | 'all') => void;
  selectionCount: number;
}> = ({ theme, onPick, onApply, selectionCount }) => (
  <div className="slide-theme-panel">
    <ThemeRow value={theme} onChange={onPick} label="Deck theme" />
    <p className="slide-theme-panel__blurb">{theme.blurb}</p>
    <div className="slide-theme-panel__actions">
      {selectionCount > 0 && (
        <button type="button" className="sv-btn" onClick={() => onApply(theme, 'selection')}>
          Apply to {selectionCount === 1 ? 'this slide' : `${selectionCount} slides`}
        </button>
      )}
      <button type="button" className="sv-btn sv-btn--primary" onClick={() => onApply(theme, 'all')}>
        Apply to every slide
      </button>
    </div>
  </div>
);

const SectionRow: React.FC<{ slide: DeckSlide; canEdit: boolean; editing: boolean; onEdit: (on: boolean) => void }> = ({
  slide,
  canEdit,
  editing,
  onEdit,
}) => {
  const [draft, setDraft] = useState(slide.sectionStart ?? '');
  useEffect(() => setDraft(slide.sectionStart ?? ''), [slide.sectionStart]);
  const commit = () => {
    setSlideSection(slide.frame.id, draft);
    onEdit(false);
  };
  return (
    <li className="slide-section" aria-label={`Section: ${slide.sectionStart}`}>
      {editing && canEdit ? (
        <input
          autoFocus
          className="slide-section__input"
          aria-label="Section name. Empty removes the section."
          value={draft}
          maxLength={60}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onEdit(false);
          }}
        />
      ) : (
        <button type="button" className="slide-section__name" onClick={() => canEdit && onEdit(true)} disabled={!canEdit} title={canEdit ? 'Rename the section' : undefined}>
          {slide.sectionStart}
        </button>
      )}
      <span className="slide-section__rule" aria-hidden="true" />
    </li>
  );
};

const SlideCard: React.FC<{
  slide: DeckSlide;
  objects: Record<string, AnyNode>;
  dark: boolean;
  selected: boolean;
  focused: boolean;
  draggable: boolean;
  drop?: 'before' | 'after';
  dimmed: boolean;
  onSelect: (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}> = ({ slide, objects, dark, selected, focused, draggable, drop, dimmed, onSelect, onOpen, onDragStart, onDragOver, onDragEnd }) => {
  const frame = slide.frame;
  const meta = slideFields(frame);
  const name = frame.title || 'Untitled slide';
  return (
    <li
      className="slide-card"
      data-selected={selected || undefined}
      data-hidden={slide.hidden || undefined}
      data-drop={drop}
      data-dimmed={dimmed || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="slide-card__face"
        data-slide={frame.id}
        tabIndex={focused ? 0 : -1}
        aria-selected={selected}
        aria-label={`${slide.number ? `Slide ${slide.number}` : 'Skipped slide'}: ${name}${meta.notes ? ', has notes' : ''}`}
        onClick={(e) => onSelect(e)}
        onDoubleClick={onOpen}
      >
        <SlideThumb frame={frame} objects={objects} dark={dark} width={420} />
        {slide.hidden && (
          <span className="slide-card__skip" aria-hidden="true">
            <EyeOff size={14} />
            Skipped
          </span>
        )}
      </button>
      <span className="slide-card__meta">
        <span className="slide-card__num">{slide.number ?? '–'}</span>
        {frame.icon && <Emoji native={frame.icon} size={13} />}
        <span className="slide-card__name">{name}</span>
        {meta.notes && <StickyNote size={13} className="slide-card__flag" aria-hidden="true" />}
        {meta.transition && <TransitionGlyph kind={meta.transition} className="slide-card__flag" />}
      </span>
    </li>
  );
};

function readStoredTheme(): DeckTheme | undefined {
  try {
    return deckTheme(localStorage.getItem(ORIGIN_KEY) ?? undefined);
  } catch {
    return undefined;
  }
}

function storeTheme(id: string): void {
  try {
    localStorage.setItem(ORIGIN_KEY, id);
  } catch {
    /* private mode: the choice lasts the session */
  }
}
