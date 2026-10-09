import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRoomState, useSyncMeta } from '../../hooks/useSync';
import { CollaborationLayer } from './CollaborationLayer';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  Download,
  EyeOff,
  Grid3x3,
  Headphones,
  History,
  Keyboard,
  LayoutPanelTop,
  Link2,
  Magnet,
  MessageSquare,
  Moon,
  MousePointerClick,
  PanelLeft,
  PanelRight,
  PencilLine,
  Redo2,
  Ruler,
  Search,
  Share2,
  Sparkles,
  Undo2,
  Wind,
} from 'lucide-react';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { railVeil } from '../../engine/interaction/railVeil';
import { textEditing } from '../../engine/interaction/textEditing';
import { Logo } from '../ui/Logo';
import { RoleBadge } from './RoleBadge';
import { Menu } from '../menu/Menu';
import { tidy, type MenuEntry } from '../menu/menuModel';
import { SHORTCUTS, withShortcut } from '../menu/shortcuts';
import { useUndoAvailability } from '../../hooks/useUndoAvailability';
import { notify } from '../../engine/ui/notices';
import { tourState } from '../../engine/learn/tourState';
import { ZoomControl } from './ZoomControl';
import { musicSlot } from './musicSlot';
import MusicHeaderSlot from './MusicHeaderSlot';
import { contrastMenuItem } from '../ui/contrastMenu';
import { useContrast } from '../../engine/ui/contrast';
import { toggleBoardSketch, useBoardSketch } from '../../engine/model/roughBoard';
import { canEditObjects } from '../../engine/model/permissions';
import { SketchLookGlyph } from '../panel/sketchIcons';
import { BottomSheet } from '../ui/BottomSheet';
import type { SnapName } from '../ui/bottomSheetModel';
import { usePhone } from './usePhone';
import './shell.css';

/**
 * The board's two headers, in the Figma UI3 arrangement.
 *
 * There is no bar across the top. The left panel opens with *which board is
 * this and is it safe* — the mark, the name with its menu, the save state —
 * and the right panel opens with *who is here and how does work leave* —
 * people, comments, undo and history, zoom, and Share, the one accent fill on
 * the screen. When a panel is collapsed, or the window is narrow, its header
 * shrinks to a pill in that top corner and the board runs edge to edge
 * underneath.
 *
 * Everything else is one level down on the board menu, hung from the name:
 * Export (also Mod+Shift+E, and a tab in Share), View (Alt+Shift+V), Music,
 * Help and shortcuts (also ?), the tour, and the way home.
 */

/** One glyph size for both headers; 16 lands Lucide on whole pixels. */
const ICON = 16;


/** What a board created a moment ago is called until someone names it. */
export const UNTITLED_BOARD = 'Untitled board';

/** Whether the header is a panel's top or a pill floating in its corner. */
export type HeaderVariant = 'panel' | 'pill';

/**
 * Whether the headers are standing back while something is being dragged, from
 * the same veil the floating rail reads. Its release is settled here because
 * these headers are always mounted while a board is.
 */
function useReceded(): boolean {
  const receded = useSyncExternalStore(railVeil.subscribe, railVeil.getSnapshot, railVeil.getSnapshot);
  useEffect(() => {
    const settle = () => { railVeil.settle(textEditing.getSnapshot()); };
    window.addEventListener('pointerup', settle, true);
    window.addEventListener('pointercancel', settle, true);
    return () => {
      window.removeEventListener('pointerup', settle, true);
      window.removeEventListener('pointercancel', settle, true);
    };
  }, []);
  return receded;
}

/* ===================================================================== left */

interface LeftProps {
  variant: HeaderVariant;
  localTitle: string;
  setLocalTitle: (title: string) => void;
  onTitleSave: (title: string) => void;
  isDarkTheme: boolean;
  setIsDarkTheme: (dark: boolean) => void;
  onShareClick: () => void;
  onExportClick?: () => void;
  onHelpClick?: () => void;
  onHideUi: () => void;
  onToggleTimeline: () => void;
  /** Opens search and commands, the palette behind Ctrl+K. */
  onOpenCommands?: () => void;
  /** Whether history replay is running, so its menu row can say so. */
  timelineOpen?: boolean;
  /** Open the left panel from its pill, when there is no `toggle`. */
  onExpand?: () => void;
  /** The pill's way back into the panel, from `BoardColumn`: click to pin, rest on it to peek. */
  toggle?: ColumnToggle;
}

type OpenMenu = { which: 'board' | 'view'; rect: DOMRect; keyboard: boolean } | null;

const BoardHeaderLeftInner: React.FC<LeftProps> = ({
  variant,
  localTitle,
  setLocalTitle,
  onTitleSave,
  isDarkTheme,
  setIsDarkTheme,
  onShareClick,
  onExportClick,
  onHelpClick,
  onHideUi,
  onToggleTimeline,
  onOpenCommands,
  timelineOpen = false,
  onExpand,
  toggle,
}) => {
  const { status, synced } = useRoomState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  /** What the title was when editing started, so Escape can put it back. */
  const titleBeforeEditRef = useRef(localTitle);
  const physicsEnabled = useStore((state) => state.physicsEnabled);
  const setPhysicsEnabled = useStore((state) => state.setPhysicsEnabled);
  const snapToGrid = useStore((state) => state.snapToGrid);
  const setSnapToGrid = useStore((state) => state.setSnapToGrid);
  const showContextToolbar = useStore((state) => state.showContextToolbar);
  const setShowContextToolbar = useStore((state) => state.setShowContextToolbar);
  const boardSketch = useBoardSketch();
  const showRulers = useStore((state) => state.showRulers);
  const setShowRulers = useStore((state) => state.setShowRulers);
  const showGrid = useStore((state) => state.showGrid);
  const setShowGrid = useStore((state) => state.setShowGrid);
  const contrast = useContrast();
  const receded = useReceded();
  const [menu, setMenu] = useState<OpenMenu>(null);

  /**
   * Saved, saving, offline — and only the last two always speak. The resting
   * state is a tick; the word appears for a few seconds each time a save lands.
   */
  const { queued, lastSyncedAt } = useSyncMeta();
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const [settledAt, setSettledAt] = useState(0);
  const [hadQueue, setHadQueue] = useState(false);
  const lastSyncedText = lastSyncedAt
    ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : 'Not synced yet.';
  const queuedText = queued > 0 ? ` ${queued} change${queued === 1 ? '' : 's'} queued.` : '';
  const syncStatus =
    status !== 'connected'
      ? browserOnline && status === 'disconnected' && lastSyncedAt !== null
        ? {
            label: queued > 0 ? `Reconnecting · ${queued}` : 'Reconnecting',
            text: `Reconnecting.${queuedText} Edits are saved on this device and will merge when you are back online. ${lastSyncedText}`,
            tone: 'syncing' as const,
          }
        : {
            label: queued > 0 ? `Offline · ${queued}` : 'Offline',
            text: `Offline.${queuedText} Edits are saved on this device and will merge when you are back online. ${lastSyncedText}`,
            tone: 'offline' as const,
          }
      : !synced
        ? { label: 'Saving', text: `Sending your latest changes. ${lastSyncedText}`, tone: 'syncing' as const }
        : {
            label: hadQueue ? 'All changes synced' : 'Saved',
            text: `${hadQueue ? 'All changes synced.' : 'Saved.'} Everyone on this board has your latest changes. ${lastSyncedText}`,
            tone: 'idle' as const,
          };

  const [justSaved, setJustSaved] = useState(true);
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (queued > 0) setHadQueue(true);
  }, [queued]);
  useEffect(() => {
    const settled = status === 'connected' && synced;
    if (settled && wasSyncing.current) {
      setJustSaved(true);
      setSettledAt(Date.now());
    }
    wasSyncing.current = !settled;
  }, [status, synced]);
  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => {
      setJustSaved(false);
      setHadQueue(false);
    }, 3200);
    return () => window.clearTimeout(t);
  }, [justSaved, settledAt]);
  /**
   * In the panel the word comes and goes; in the pill only Offline keeps it,
   * a state that must not be missed. Saving comes and goes too often to be
   * worth the pill's width changing under the name.
   */
  const showLabel = variant === 'panel' ? syncStatus.tone !== 'idle' || justSaved : syncStatus.tone === 'offline' || (syncStatus.tone === 'syncing' && status !== 'connected');

  const startRename = () => {
    titleBeforeEditRef.current = localTitle;
    setIsEditingTitle(true);
  };

  /**
   * A board made a moment ago opens with its name ready to type over.
   *
   * The dashboard adds `?new=1` when it creates a board. This reads it, takes
   * it off the address (keeping the rest of it) so a reload or a copied link
   * does not reopen the rename, and opens the name with "Untitled board"
   * selected. Escape puts back exactly that.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') !== '1') return;
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    const current = localTitle.trim();
    const start = !current || /^untitled/i.test(current) ? UNTITLED_BOARD : localTitle;
    setLocalTitle(start);
    titleBeforeEditRef.current = start;
    setIsEditingTitle(true);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The board's name and chevron, which both of its menus hang from. */
  const docRef = useRef<HTMLDivElement>(null);
  /** Alt+Shift+V (see `useRoomShortcuts`) opens View under the board's name. */
  useEffect(() => {
    const open = () => {
      const from = docRef.current;
      if (from) setMenu({ which: 'view', rect: from.getBoundingClientRect(), keyboard: true });
    };
    window.addEventListener('vega:open-view-menu', open);
    return () => window.removeEventListener('vega:open-view-menu', open);
  }, []);

  /**
   * The chevron. Both menus hang from the whole name, but only this opens the
   * board's: a press on it while that menu is up closes it and eats the click
   * (the menu's `trigger`), so it never reopens what it just closed.
   */
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const openMenu = (which: 'board' | 'view') => (e: React.MouseEvent<HTMLButtonElement>) => {
    // Hung from the whole name, so it reads as the board's menu rather than a
    // 20px chevron's.
    const from = docRef.current ?? e.currentTarget;
    setMenu({ which, rect: from.getBoundingClientRect(), keyboard: e.detail === 0 });
  };

  /** The switches, as rows. Each keeps the menu open: a visit is often for two changes. */
  const viewEntries = (): MenuEntry[] =>
    tidy([
      { kind: 'heading', id: 'h-touch', label: 'When you touch it' },
      { kind: 'item', id: 'snap', label: 'Snap to grid', icon: <Magnet size={15} />, checked: snapToGrid, keepOpen: true, detail: 'Hold Ctrl while dragging to do the opposite', onSelect: () => setSnapToGrid(!snapToGrid) },
      // Whether a fast drag launches the object or drops it where it is let
      // go. Physics itself is a mode (All tools, or Shift+P).
      { kind: 'item', id: 'throw', label: 'Flick to throw', icon: <Wind size={15} />, checked: physicsEnabled, keepOpen: true, detail: 'A fast drag launches what you let go of', onSelect: () => setPhysicsEnabled(!physicsEnabled) },
      { kind: 'item', id: 'rail', label: 'Selection toolbar', icon: <MousePointerClick size={15} />, checked: showContextToolbar, keepOpen: true, onSelect: () => setShowContextToolbar(!showContextToolbar) },
      { kind: 'separator', id: 's1' },
      { kind: 'heading', id: 'h-drawn', label: 'What it is drawn on' },
      { kind: 'item', id: 'rulers', label: 'Rulers', icon: <Ruler size={15} />, checked: showRulers, keepOpen: true, onSelect: () => setShowRulers(!showRulers) },
      { kind: 'item', id: 'grid', label: 'Dot grid', icon: <Grid3x3 size={15} />, checked: showGrid, keepOpen: true, onSelect: () => setShowGrid(!showGrid) },
      // A document write, so editors only.
      canEditObjects() && { kind: 'item', id: 'sketch', label: 'Sketch', icon: <SketchLookGlyph size={15} />, shortcut: 'Shift+S', checked: boardSketch !== null, keepOpen: true, detail: 'Draw the whole board by hand', onSelect: toggleBoardSketch },
      { kind: 'separator', id: 's2' },
      { kind: 'heading', id: 'h-look', label: 'How you are looking at it' },
      { kind: 'item', id: 'dark', label: 'Dark theme', icon: <Moon size={15} />, checked: isDarkTheme, keepOpen: true, onSelect: () => setIsDarkTheme(!isDarkTheme) },
      // Its advertised Mod+Alt+C is Copy style while something is selected, so
      // the row shows no key until the contrast toggle has one of its own.
      { ...contrastMenuItem(contrast.enhanced), shortcut: undefined },
      { kind: 'item', id: 'focus', label: 'Focus mode', icon: <EyeOff size={15} />, shortcut: '\\', detail: 'Hide everything but the board', onSelect: onHideUi },
    ]);

  const boardEntries = (): MenuEntry[] =>
    tidy([
      { kind: 'item', id: 'rename', label: 'Rename', icon: <PencilLine size={15} />, onSelect: startRename },
      {
        kind: 'item',
        id: 'link',
        label: 'Copy link',
        icon: <Link2 size={15} />,
        onSelect: () => {
          void navigator.clipboard
            ?.writeText(window.location.href)
            .then(() => notify('Link to this board copied'))
            .catch(() => notify({ message: 'The clipboard refused the link. Use Share instead.', tone: 'warning' }));
        },
      },
      { kind: 'item', id: 'share', label: 'Share…', icon: <Share2 size={15} />, onSelect: onShareClick },
      { kind: 'item', id: 'export', label: 'Export…', icon: <Download size={15} />, shortcut: SHORTCUTS.export, onSelect: () => onExportClick?.() },
      { kind: 'separator', id: 's1' },
      { kind: 'submenu', id: 'view', label: 'View', icon: <LayoutPanelTop size={15} />, entries: viewEntries() },
      { kind: 'item', id: 'history', label: 'Replay history', icon: <History size={15} />, checked: timelineOpen ? true : undefined, onSelect: onToggleTimeline },
      { kind: 'item', id: 'music', label: 'Music…', icon: <Headphones size={15} />, detail: 'Stations or Spotify while you work', onSelect: () => musicSlot.request() },
      { kind: 'separator', id: 's2' },
      onOpenCommands && { kind: 'item', id: 'commands', label: 'Search and commands…', icon: <Search size={15} />, shortcut: 'Mod+K', onSelect: onOpenCommands },
      { kind: 'item', id: 'shortcuts', label: 'Help and shortcuts', icon: <Keyboard size={15} />, shortcut: '?', onSelect: () => onHelpClick?.() },
      { kind: 'item', id: 'tour', label: 'Take the tour', icon: <Sparkles size={15} />, onSelect: () => tourState.start() },
      { kind: 'separator', id: 's3' },
      { kind: 'item', id: 'home', label: 'Back to your boards', icon: <ArrowLeft size={15} />, onSelect: () => { window.location.href = '/'; } },
    ]);

  return (
    <div className={`board-head board-head--left board-head--${variant}`} data-receded={receded || undefined}>
      {/* The mark is the door home: identity at rest, "back" under the
          pointer. An anchor, so middle-click and Cmd-click work. */}
      <a href="/" className="hdr-home" data-tooltip="Your boards" data-tooltip-pos="bottom" aria-label="Your boards">
        <span className="hdr-home__face hdr-home__face--mark" aria-hidden>
          <Logo size={22} />
        </span>
        <span className="hdr-home__face hdr-home__face--back" aria-hidden>
          <ArrowLeft size={17} strokeWidth={2.25} />
        </span>
      </a>

      {/* The name and its menu, one control with two targets: the words
          rename, the chevron opens the board's menu. */}
      <div ref={docRef} className={`hdr-doc${menu ? ' is-open' : ''}`}>
        {isEditingTitle ? (
          <input
            autoFocus
            value={localTitle}
            maxLength={60}
            aria-label="Board name"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={() => { setIsEditingTitle(false); onTitleSave(localTitle); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setIsEditingTitle(false);
                onTitleSave(localTitle);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setLocalTitle(titleBeforeEditRef.current);
                setIsEditingTitle(false);
              }
            }}
            className="hdr-title hdr-title--editing"
          />
        ) : (
          <button type="button" className="hdr-title hdr-title--button" onClick={startRename} data-tooltip="Rename this board" data-tooltip-pos="bottom">
            {localTitle}
          </button>
        )}
        <button
          type="button"
          ref={menuButtonRef}
          className="hdr-doc__menu"
          aria-label="Board menu: share, export, view, music and help"
          aria-haspopup="menu"
          aria-expanded={menu?.which === 'board'}
          data-tour="help"
          data-tooltip={menu ? undefined : 'Board menu'}
          data-tooltip-pos="bottom"
          onClick={openMenu('board')}
        >
          <ChevronDown size={14} strokeWidth={2.25} aria-hidden />
        </button>
      </div>

      <span
        className={`sync-pip sync-pip--${syncStatus.tone}`}
        data-said={showLabel || undefined}
        data-tooltip={syncStatus.text}
        data-tooltip-pos="bottom"
        role="status"
        aria-live="polite"
        aria-label={syncStatus.text}
      >
        <span className="sync-pip__mark" aria-hidden>
          {syncStatus.tone === 'idle' ? (
            <Check size={13} strokeWidth={2.75} />
          ) : syncStatus.tone === 'offline' ? (
            <CloudOff size={13} />
          ) : (
            <span className="sync-pip__dot" />
          )}
        </span>
        {showLabel && <span className="sync-pip__label">{syncStatus.label}</span>}
      </span>

      {variant === 'panel' && <span className="board-head__fill" />}

      {variant === 'panel' && onOpenCommands && (
        <button
          type="button"
          className="btn-icon"
          onClick={onOpenCommands}
          aria-label="Search and commands"
          aria-keyshortcuts="Control+K Meta+K"
          data-tooltip={withShortcut('Search and commands', 'Mod+K')}
          data-tooltip-pos="bottom"
        >
          <Search size={ICON} />
        </button>
      )}

      {variant === 'pill' && (toggle || onExpand) && (
        <>
          <span className="board-pill__rule" aria-hidden="true" />
          <PillToggle label="Show the layers panel" toggle={toggle} onExpand={onExpand} icon={<PanelLeft size={ICON} />} />
        </>
      )}

      {menu && (
        <Menu
          key={menu.which}
          label={menu.which === 'board' ? 'Board menu' : 'View settings'}
          entries={menu.which === 'board' ? boardEntries() : viewEntries()}
          anchor={{ kind: 'rect', rect: menu.rect, prefer: 'below', align: 'start' }}
          focusFirst={menu.keyboard}
          trigger={menu.which === 'board' ? menuButtonRef : null}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
};

export const BoardHeaderLeft = React.memo(BoardHeaderLeftInner);

/* ==================================================================== right */

interface RightProps {
  variant: HeaderVariant;
  onShareClick: () => void;
  onToggleTimeline: () => void;
  onToggleComments: () => void;
  /** Unresolved threads with something you have not read. */
  commentUnread: number;
  /** Whether any of them names you, the one case the count takes the accent. */
  commentMentioned?: boolean;
  /** Whether the comments inbox is open, so its button can say so. */
  commentsOpen?: boolean;
  /** Whether history replay is running, so its button can say so. */
  timelineOpen?: boolean;
  /** Open the right panel from its pill, when there is no `toggle`. Absent when there is no panel to open. */
  onExpand?: () => void;
  /** The pill's way back into the panel, from `BoardColumn`. */
  toggle?: ColumnToggle;
}

const BoardHeaderRightInner: React.FC<RightProps> = ({
  variant,
  onShareClick,
  onToggleTimeline,
  onToggleComments,
  commentUnread,
  commentMentioned = false,
  commentsOpen = false,
  timelineOpen = false,
  onExpand,
  toggle,
}) => {
  const { canUndo, canRedo } = useUndoAvailability();
  const receded = useReceded();
  const phone = usePhone();

  const share = (
    <button className="hdr-btn hdr-btn--primary" onClick={onShareClick} aria-label="Share this board" data-tour="share">
      <Share2 size={ICON} aria-hidden /> <span className="hdr-share-text">Share</span>
    </button>
  );

  const comments = (
    <button
      className={`btn-icon hdr-comments${commentsOpen ? ' is-on' : ''}`}
      onClick={onToggleComments}
      aria-pressed={commentsOpen}
      data-tooltip={commentUnread > 0 ? `${commentUnread} unread ${commentUnread === 1 ? 'comment' : 'comments'}` : 'Comments'}
      data-tooltip-pos="bottom"
      aria-label={
        commentUnread > 0 ? `Comments, ${commentUnread} unread${commentMentioned ? ', you are mentioned' : ''}` : 'Comments'
      }
    >
      <MessageSquare size={ICON} />
      {commentUnread > 0 && (
        <span className="hdr-badge" data-mention={commentMentioned || undefined} aria-hidden="true">
          {commentUnread > 9 ? '9+' : commentUnread}
        </span>
      )}
    </button>
  );

  /** The record sits right beside your own face, in both header forms. The player itself loads on first open. */
  const music = <MusicHeaderSlot />;

  /**
   * The pill mirrors the left one: its way back into the panel faces the
   * board, then the people (and your record), then zoom, and Share in the
   * corner. Comments show only while there is something unread, or while
   * the inbox is open so it can be closed from here; the panel's header keeps
   * the way in otherwise. With no panel to open (a commenter or a viewer),
   * the pill is the only way in, so they always show.
   */
  /**
   * The phone's header: who is here, comments and Share, nothing else. The
   * properties open from the selection bar's Edit, zoom is a pinch, and the
   * record stays mounted (hidden) so the board menu's Music can open it.
   */
  if (phone) {
    return (
      <div className="board-head board-head--right board-head--pill board-head--phone" data-receded={receded || undefined}>
        <RoleBadge />
        <CollaborationLayer />
        {music}
        {comments}
        {share}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div className="board-head board-head--right board-head--pill" data-receded={receded || undefined}>
        {(toggle || onExpand) && (
          <>
            <PillToggle label="Show the properties panel" toggle={toggle} onExpand={onExpand} icon={<PanelRight size={ICON} />} />
            <span className="board-pill__rule" aria-hidden="true" />
          </>
        )}
        <RoleBadge />
        <CollaborationLayer />
        {music}
        {(commentUnread > 0 || commentsOpen || !(toggle || onExpand)) && comments}
        <span className="board-pill__rule" aria-hidden="true" />
        <ZoomControl compact />
        {share}
      </div>
    );
  }

  return (
    <div className="board-head board-head--right board-head--panel" data-receded={receded || undefined}>
      <div className="board-head__row">
        <RoleBadge />
        <CollaborationLayer />
        {music}
        <span className="board-head__fill" />
        {comments}
        {share}
      </div>
      <div className="board-head__row board-head__row--tools">
        <div className="hdr-cluster" role="group" aria-label="History">
          <button className="btn-icon" onClick={() => editor.undo()} disabled={!canUndo} data-tooltip={withShortcut('Undo', 'Mod+Z')} data-tooltip-pos="bottom" aria-label="Undo">
            <Undo2 size={ICON} />
          </button>
          <button className="btn-icon" onClick={() => editor.redo()} disabled={!canRedo} data-tooltip={withShortcut('Redo', 'Mod+Shift+Z')} data-tooltip-pos="bottom" aria-label="Redo">
            <Redo2 size={ICON} />
          </button>
          <button
            className={`btn-icon hdr-history${timelineOpen ? ' is-on' : ''}`}
            onClick={onToggleTimeline}
            aria-pressed={timelineOpen}
            data-tooltip={timelineOpen ? 'Close replay' : 'Replay everything that happened in this room'}
            data-tooltip-pos="bottom"
            aria-label="History. Replay this session"
          >
            <History size={ICON} />
          </button>
        </div>
        <span className="board-head__fill" />
        <ZoomControl compact />
      </div>
    </div>
  );
};

export const BoardHeaderRight = React.memo(BoardHeaderRightInner);

/* ================================================================== columns */

/**
 * A pill's way back into its panel, as `BoardColumn` hands it to the header:
 * a click pins the panel open, and resting the pointer on it peeks.
 */
export interface ColumnToggle {
  ref: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
}

/**
 * The panel glyph at a pill's inner end. With a `toggle` it carries no
 * tooltip: resting on it peeks the panel, which says what it opens better
 * than a label would, and a tip that painted just before the peek replaced it
 * would only flash.
 */
const PillToggle: React.FC<{
  label: string;
  toggle?: ColumnToggle;
  onExpand?: () => void;
  icon: React.ReactNode;
}> = ({ label, toggle, onExpand, icon }) => (
  <button
    ref={toggle?.ref}
    type="button"
    className="btn-icon board-pill__toggle"
    aria-label={label}
    aria-expanded={false}
    aria-keyshortcuts="Control+\ Meta+\"
    data-tooltip={toggle ? undefined : withShortcut(label, 'Mod+\\')}
    data-tooltip-pos={toggle ? undefined : 'bottom'}
    onClick={toggle?.onClick ?? onExpand}
    onPointerEnter={toggle?.onPointerEnter}
    onPointerLeave={toggle?.onPointerLeave}
  >
    {icon}
  </button>
);

/** How long the pointer rests on a pill's toggle before the panel peeks. */
export const PEEK_DELAY_MS = 600;
/** How long a peek outlives the pointer leaving it. */
export const PEEK_LINGER_MS = 280;
/** The pill growing into its panel, and back. */
const MORPH_MS = 160;
const MORPH_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const PILL_RADIUS = 10;

const COLUMN_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export interface BoardColumnProps {
  side: 'left' | 'right';
  /** Pinned open. */
  open: boolean;
  /** Whether there is a panel to open at all. A viewer's right column is only ever its pill. */
  canOpen?: boolean;
  /** Pin the column open: the toggle's click, or any press inside a peek. */
  onPin: () => void;
  /** The landmark's name while it is the panel, and while it is the pill. */
  panelLabel: string;
  pillLabel: string;
  /** Its stop in the F6 cycle (`data-region`) and its tour anchor. */
  region: number;
  tour?: string;
  /** The panel's own classes: `hierarchy-panel panel-surface`, `context-inspector panel-surface`. */
  panelClassName: string;
  /** Extra `data-*` attributes for the panel. */
  panelData?: Record<`data-${string}`, string | boolean | undefined>;
  /** The pill's contents, given the toggle (absent when there is no panel). */
  pill: (toggle: ColumnToggle | undefined) => React.ReactNode;
  /** The panel's contents. */
  children: React.ReactNode;
  /** On a phone the panel is a bottom sheet; this puts it away. */
  onClose?: () => void;
  /** The sheet's title on a phone. Defaults to `panelLabel`. */
  sheetLabel?: string;
  /** The sheet's snaps on a phone, and where it opens. Full height by default. */
  sheetSnaps?: readonly SnapName[];
  sheetInitialSnap?: SnapName;
}

/**
 * One side of the board's frame: an open panel, or its pill in that corner.
 *
 * - **Pin.** The pill's toggle (or Mod+\ in the room) opens the panel, which
 *   grows out of the pill: revealed from the pill's own box to its full width
 *   and height, its opacity coming up, over 160ms. Collapsing narrows the pill
 *   in from the panel's width. Under reduced motion the two simply swap.
 * - **Peek.** Resting the pointer on the toggle for 600ms shows the panel as
 *   an overlay. It takes nothing from the board's insets, so nothing placed
 *   against the frame moves, the dock least of all. It goes when the pointer
 *   has been off it for 280ms, on Escape, or on a press elsewhere; a press
 *   inside it pins it.
 * - **Focus.** Collapsing while focus was in the panel hands focus to the
 *   pill's toggle; pinning from the toggle hands it to the panel's first
 *   control. Panel and pill are one landmark under two names.
 *
 * In `Room`:
 *
 *     <BoardColumn side="left" open={leftOpen} onPin={expandLeft}
 *       panelLabel="Board and layers" pillLabel="Board" region={0} tour="layers"
 *       panelClassName="hierarchy-panel panel-surface"
 *       panelData={{ 'data-radar-collapsed': !radarOpen }}
 *       pill={(toggle) => <BoardHeaderLeft variant="pill" toggle={toggle} … />}>
 *       <BoardHeaderLeft variant="panel" … /> <LayersPanel … /> <PanelWidthHandle />
 *     </BoardColumn>
 */
export const BoardColumn: React.FC<BoardColumnProps> = ({
  side,
  open,
  canOpen = true,
  onPin,
  panelLabel,
  pillLabel,
  region,
  tour,
  panelClassName,
  panelData,
  pill,
  children,
  onClose,
  sheetLabel,
  sheetSnaps = ['full'],
  sheetInitialSnap,
}) => {
  const phone = usePhone();
  const [peek, setPeek] = useState(false);
  const shown = open || (peek && canOpen);
  const Tag = side === 'left' ? 'nav' : 'aside';

  const panelRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  /** The last size of each form, for the other to grow from or narrow to. */
  const pillRect = useRef<DOMRect | null>(null);
  const panelRect = useRef<DOMRect | null>(null);
  /** Whether focus was inside the panel, for handing it to the pill on collapse. */
  const focusInside = useRef(false);
  /** Whether the toggle had focus when it pinned the panel. */
  const pinnedFromToggle = useRef(false);
  /** The latest `onPin`, so the toggle can stay one object and the memoised headers stay put. */
  const onPinRef = useRef(onPin);
  useEffect(() => {
    onPinRef.current = onPin;
  }, [onPin]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    },
    []
  );

  // A pinned column is not peeking, and neither is one that cannot open.
  useEffect(() => {
    if (!open && canOpen) return;
    window.clearTimeout(openTimer.current);
    setPeek(false);
  }, [open, canOpen]);

  const toggle = useMemo<ColumnToggle>(
    () => ({
      ref: toggleRef,
      onClick: () => {
        window.clearTimeout(openTimer.current);
        pinnedFromToggle.current = document.activeElement === toggleRef.current;
        setPeek(false);
        onPinRef.current();
      },
      onPointerEnter: (e) => {
        // A touch or a pen has no resting pointer to read as intent.
        if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
        window.clearTimeout(openTimer.current);
        openTimer.current = window.setTimeout(() => setPeek(true), PEEK_DELAY_MS);
      },
      onPointerLeave: () => window.clearTimeout(openTimer.current),
    }),
    []
  );

  // While peeking: a pointer away from it closes it after a beat, a press
  // inside pins it, a press elsewhere or Escape closes it.
  useEffect(() => {
    if (!peek || open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(panelRef.current?.contains(target) || toggleRef.current?.contains(target));
    const cancelClose = () => {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (inside(e.target)) cancelClose();
      else if (!closeTimer.current) {
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = 0;
          setPeek(false);
        }, PEEK_LINGER_MS);
      }
    };
    const onDown = (e: PointerEvent) => {
      cancelClose();
      if (panelRef.current?.contains(e.target as Node)) onPinRef.current();
      else setPeek(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPeek(false);
    };
    const onBlur = () => setPeek(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      cancelClose();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [peek, open]);

  // Keep each form's last size, for the other to grow from or narrow to.
  useLayoutEffect(() => {
    const el = shown ? panelRef.current : pillRef.current;
    if (!el) return;
    const store = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) (shown ? panelRect : pillRect).current = r;
    };
    store();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(store);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);

  // The morph, and where focus goes, when one form replaces the other.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const reduced = prefersReducedMotion();
    if (shown) {
      const el = panelRef.current;
      const from = pillRect.current;
      if (el && from && !reduced && typeof el.animate === 'function') {
        const to = el.getBoundingClientRect();
        const top = Math.max(0, from.top - to.top);
        const left = Math.max(0, from.left - to.left);
        const right = Math.max(0, to.right - from.right);
        const bottom = Math.max(0, to.bottom - from.bottom);
        el.animate(
          [
            { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${PILL_RADIUS}px)`, opacity: 0.6 },
            { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 },
          ],
          { duration: MORPH_MS, easing: MORPH_EASE }
        );
      }
      if (open && pinnedFromToggle.current) {
        el?.querySelector<HTMLElement>(COLUMN_FOCUSABLE)?.focus({ preventScroll: true });
      }
      pinnedFromToggle.current = false;
    } else {
      const el = pillRef.current;
      const from = panelRect.current;
      if (el && from && !reduced && typeof el.animate === 'function') {
        const natural = el.getBoundingClientRect().width;
        el.dataset.morphing = '';
        const anim = el.animate(
          [
            { width: `${Math.round(from.width)}px`, opacity: 0.6 },
            { width: `${Math.round(natural)}px`, opacity: 1 },
          ],
          { duration: MORPH_MS, easing: MORPH_EASE }
        );
        const done = () => {
          delete el.dataset.morphing;
        };
        anim.onfinish = done;
        anim.oncancel = done;
      }
      const lost = !document.activeElement || document.activeElement === document.body;
      if (focusInside.current && lost) {
        (toggleRef.current ?? el?.querySelector<HTMLElement>(COLUMN_FOCUSABLE))?.focus({ preventScroll: true });
      }
      focusInside.current = false;
    }
  }, [shown, open]);

  /**
   * On a phone the column is always its pill, and the open panel is a sheet
   * over the board: a phone has no width to give a column.
   */
  if (phone) {
    return (
      <>
        <Tag ref={pillRef} className={`board-pill board-pill--${side}`} aria-label={pillLabel} data-region={region} data-tour={tour}>
          {pill(canOpen ? toggle : undefined)}
        </Tag>
        <BottomSheet
          open={open && canOpen}
          onClose={() => onClose?.()}
          label={sheetLabel ?? panelLabel}
          snaps={sheetSnaps}
          initialSnap={sheetInitialSnap}
          className={`phone-panel-sheet phone-panel-sheet--${side}`}
        >
          <div className="phone-panel">{children}</div>
        </BottomSheet>
      </>
    );
  }

  if (shown) {
    return (
      <Tag
        ref={panelRef}
        className={panelClassName}
        aria-label={panelLabel}
        data-region={region}
        data-tour={tour}
        data-peek={!open || undefined}
        onFocus={() => {
          focusInside.current = true;
        }}
        onBlur={(e: React.FocusEvent<HTMLElement>) => {
          const next = e.relatedTarget as Node | null;
          if (next && !e.currentTarget.contains(next)) focusInside.current = false;
        }}
        {...panelData}
      >
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      ref={pillRef}
      className={`board-pill board-pill--${side}`}
      aria-label={pillLabel}
      data-region={region}
      data-tour={tour}
    >
      {pill(canOpen ? toggle : undefined)}
    </Tag>
  );
};
