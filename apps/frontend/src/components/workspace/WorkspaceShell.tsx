import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRoomState } from '../../hooks/useSync';
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
  /** Open the left panel from its pill. */
  onExpand?: () => void;
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
  const syncStatus =
    status !== 'connected'
      ? {
          label: 'Offline',
          text: 'Offline. Your work is safe on this device and will reach everyone else when you reconnect.',
          tone: 'offline' as const,
        }
      : !synced
        ? { label: 'Saving', text: 'Sending your latest changes.', tone: 'syncing' as const }
        : { label: 'Saved', text: 'Saved. Everyone on this board has your latest changes.', tone: 'idle' as const };

  const [justSaved, setJustSaved] = useState(true);
  const wasSyncing = useRef(false);
  useEffect(() => {
    const settled = status === 'connected' && synced;
    if (settled && wasSyncing.current) setJustSaved(true);
    wasSyncing.current = !settled;
  }, [status, synced]);
  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(false), 2600);
    return () => window.clearTimeout(t);
  }, [justSaved]);
  const showLabel = syncStatus.tone !== 'idle' || justSaved;

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
   * The menu closes itself on any outside press, in the capture phase, which
   * includes a press on the button that opened it. Remembering which menu that
   * press closed lets the button close its own menu instead of reopening it.
   */
  const justClosed = useRef<{ which: 'board' | 'view'; at: number } | null>(null);

  const openMenu = (which: 'board' | 'view') => (e: React.MouseEvent<HTMLButtonElement>) => {
    const recent = justClosed.current;
    if (recent && recent.which === which && performance.now() - recent.at < 300) {
      justClosed.current = null;
      return;
    }
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
      { kind: 'item', id: 'throw', label: 'Throw on flick', icon: <Wind size={15} />, checked: physicsEnabled, keepOpen: true, onSelect: () => setPhysicsEnabled(!physicsEnabled) },
      { kind: 'item', id: 'rail', label: 'Selection toolbar', icon: <MousePointerClick size={15} />, checked: showContextToolbar, keepOpen: true, onSelect: () => setShowContextToolbar(!showContextToolbar) },
      { kind: 'separator', id: 's1' },
      { kind: 'heading', id: 'h-drawn', label: 'What it is drawn on' },
      { kind: 'item', id: 'rulers', label: 'Rulers', icon: <Ruler size={15} />, checked: showRulers, keepOpen: true, onSelect: () => setShowRulers(!showRulers) },
      { kind: 'item', id: 'grid', label: 'Dot grid', icon: <Grid3x3 size={15} />, checked: showGrid, keepOpen: true, onSelect: () => setShowGrid(!showGrid) },
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
        data-said={(showLabel && variant === 'panel') || undefined}
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
        {showLabel && variant === 'panel' && <span className="sync-pip__label">{syncStatus.label}</span>}
      </span>

      <span className="board-head__fill" />

      {onOpenCommands && (
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

      {variant === 'pill' && onExpand && (
        <button
          type="button"
          className="btn-icon"
          onClick={onExpand}
          aria-label="Show layers"
          data-tooltip={withShortcut('Show panels', 'Mod+\\')}
          data-tooltip-pos="bottom"
        >
          <PanelLeft size={ICON} />
        </button>
      )}

      {menu && (
        <Menu
          key={menu.which}
          label={menu.which === 'board' ? 'Board menu' : 'View settings'}
          entries={menu.which === 'board' ? boardEntries() : viewEntries()}
          anchor={{ kind: 'rect', rect: menu.rect, prefer: 'below', align: 'start' }}
          focusFirst={menu.keyboard}
          onClose={() => {
            justClosed.current = { which: menu.which, at: performance.now() };
            setMenu(null);
          }}
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
  /** Open the right panel from its pill. Absent when there is no panel to open. */
  onExpand?: () => void;
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
}) => {
  const { canUndo, canRedo } = useUndoAvailability();
  const receded = useReceded();

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

  if (variant === 'pill') {
    return (
      <div className="board-head board-head--right board-head--pill" data-receded={receded || undefined}>
        <RoleBadge />
        <CollaborationLayer />
        {music}
        {comments}
        <ZoomControl compact />
        {share}
        {onExpand && (
          <button
            type="button"
            className="btn-icon"
            onClick={onExpand}
            aria-label="Show properties"
            data-tooltip={withShortcut('Show panels', 'Mod+\\')}
            data-tooltip-pos="bottom"
          >
            <PanelRight size={ICON} />
          </button>
        )}
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
