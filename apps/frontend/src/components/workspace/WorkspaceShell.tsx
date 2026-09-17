import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRoomState } from '../../hooks/useSync';
import { CollaborationLayer } from './CollaborationLayer';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  Command,
  Download,
  EyeOff,
  Grid3x3,
  HelpCircle,
  History,
  Keyboard,
  LayoutPanelTop,
  Link2,
  Magnet,
  MessageSquare,
  Moon,
  MousePointerClick,
  PanelLeft,
  PencilLine,
  Redo2,
  Ruler,
  Search,
  Settings2,
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
import { SHORTCUTS, menuShortcut, withShortcut } from '../menu/shortcuts';
import { useUndoAvailability } from '../../hooks/useUndoAvailability';
import { notify } from '../../engine/ui/notices';
import { tourState } from '../../engine/learn/tourState';

/**
 * One glyph size for the whole bar. Mixed sizes in one row of icons make the
 * row appear to bow; 16 is the chrome's size and lands Lucide on whole pixels.
 */
const ICON = 16;

interface Props {
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
  onToggleComments: () => void;
  /** Unresolved threads with something you have not read. */
  commentUnread: number;
  /** Shown only once the side panels become overlays (below the compact breakpoint). */
  onTogglePanels?: () => void;
  /** Opens search and commands, the palette behind Ctrl+K. */
  onOpenCommands?: () => void;
  /** Whether the comments inbox is open, so its button can say so. */
  commentsOpen?: boolean;
  /** Whether history replay is running, so its button can say so. */
  timelineOpen?: boolean;
}

type OpenMenu = { which: 'board' | 'view'; rect: DOMRect; keyboard: boolean } | null;

/**
 * The board's header.
 *
 * ## What it is for
 *
 * Three questions, left to right: *which board is this and is it safe* (the
 * mark, the name, the save state), *what can I do across the whole board*
 * (history, search, view), and *who is here and how does work leave* (people,
 * comments, export, share). The middle stays empty on purpose — it is the most
 * valuable strip on the screen and it belongs to the board.
 *
 * ## What changed
 *
 * - **The board has a menu.** FigJam and Miro both hang one off the file name:
 *   rename, copy the link, share, export, view settings, help, and the way
 *   home, in one predictable place. Here none of that existed except as
 *   scattered buttons, and "copy a link to this board" existed nowhere.
 * - **View settings are a real menu**, built on the same engine as the
 *   right-click menu — arrow keys, type-ahead, checkmarks that say what is on —
 *   instead of a hand-rolled popover of switches with its own dismissal rules.
 *   Toggles keep it open, because a visit there is often for two changes.
 * - **Undo and Redo know when there is nothing to do.** They were always lit.
 * - **Search and commands has a door.** Ctrl+K opened a palette that nothing on
 *   screen mentioned — folklore, in the word this file already used once for
 *   Focus mode. A compact search field with its shortcut beside it is how
 *   Linear, FigJam and Miro all make theirs findable.
 * - **Buttons for panels say whether the panel is open.** Comments and History
 *   toggle something; a toggle that does not look pressed while its panel is
 *   up gives no hint that pressing it again closes it.
 */
export const WorkspaceShell: React.FC<Props> = ({
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
  onToggleComments,
  commentUnread,
  onTogglePanels,
  onOpenCommands,
  commentsOpen = false,
  timelineOpen = false,
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
  const { canUndo, canRedo } = useUndoAvailability();
  const [menu, setMenu] = useState<OpenMenu>(null);

  /**
   * Saved, saving, offline — and only the last two always speak.
   *
   * The resting state is a tick with the word folded away; the word appears
   * for a few seconds each time a save lands, which is the moment it is worth
   * reading and the moment somebody learns what the tick means.
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

  /**
   * Whether the bar is standing back while something is being manipulated,
   * from the same veil the floating rail reads — one definition of "you are
   * dragging something" in the app, with the same release floor.
   */
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

  const startRename = () => {
    titleBeforeEditRef.current = localTitle;
    setIsEditingTitle(true);
  };

  /**
   * The menu closes itself on any outside press, in the capture phase — which
   * includes a press on the button that opened it. Remembering which menu that
   * press just closed is what lets the button close its own menu instead of
   * reopening it on the click that follows.
   */
  const justClosed = useRef<{ which: 'board' | 'view'; at: number } | null>(null);

  const openMenu = (which: 'board' | 'view') => (e: React.MouseEvent<HTMLButtonElement>) => {
    const recent = justClosed.current;
    if (recent && recent.which === which && performance.now() - recent.at < 300) {
      justClosed.current = null;
      return;
    }
    // The board menu hangs from the whole name, start-aligned, so it reads as
    // belonging to the board rather than to a 20px chevron.
    const from = which === 'board' ? e.currentTarget.parentElement ?? e.currentTarget : e.currentTarget;
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
      { kind: 'separator', id: 's2' },
      onOpenCommands && { kind: 'item', id: 'commands', label: 'Search and commands…', icon: <Search size={15} />, shortcut: 'Mod+K', onSelect: onOpenCommands },
      { kind: 'item', id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={15} />, shortcut: '?', onSelect: () => onHelpClick?.() },
      { kind: 'item', id: 'tour', label: 'Take the tour', icon: <Sparkles size={15} />, onSelect: () => tourState.start() },
      { kind: 'separator', id: 's3' },
      { kind: 'item', id: 'home', label: 'Back to your boards', icon: <ArrowLeft size={15} />, onSelect: () => { window.location.href = '/'; } },
    ]);

  return (
    <header className="workspace-header" data-receded={receded || undefined} style={{ opacity: receded ? 0.6 : 1 }}>
      {/* ------------------------------------------------- the document */}
      <div className="hdr-zone hdr-zone--start">
        {onTogglePanels && (
          <button className="btn-icon panel-toggle" onClick={onTogglePanels} data-tooltip="Panels" data-tooltip-pos="bottom" aria-label="Toggle panels">
            <PanelLeft size={ICON} />
          </button>
        )}

        {/* The mark is the door home: identity at rest, "back" under the
            pointer. An anchor, so middle-click and Cmd-click work. */}
        <a href="/" className="hdr-home" data-tooltip="Your boards" data-tooltip-pos="bottom" aria-label="Your boards">
          <span className="hdr-home__face hdr-home__face--mark" aria-hidden>
            <Logo size={24} />
          </span>
          <span className="hdr-home__face hdr-home__face--back" aria-hidden>
            <ArrowLeft size={18} strokeWidth={2.25} />
          </span>
        </a>

        {/* The name and its menu, one control with two targets: the words
            rename, the chevron opens the board's menu. */}
        <div className={`hdr-doc${menu?.which === 'board' ? ' is-open' : ''}`}>
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
            aria-label="Board menu"
            aria-haspopup="menu"
            aria-expanded={menu?.which === 'board'}
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
      </div>

      {/* --------------------------------------- the room, and what leaves it */}
      <div className="hdr-zone hdr-zone--end">
        <RoleBadge />

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

        {onOpenCommands && (
          <button type="button" className="hdr-search" onClick={onOpenCommands} aria-label="Search and commands" aria-keyshortcuts="Control+K Meta+K">
            <Search size={14} aria-hidden />
            <span className="hdr-search__text">Search</span>
            <kbd className="hdr-search__key">
              {menuShortcut('Mod+K').includes('⌘') ? <Command size={11} aria-hidden /> : 'Ctrl'}
              <span>K</span>
            </kbd>
          </button>
        )}

        <button
          className={`btn-icon${menu?.which === 'view' ? ' is-on' : ''}`}
          onClick={openMenu('view')}
          data-tooltip={menu ? undefined : 'View and board settings'}
          data-tooltip-pos="bottom"
          aria-label="View settings"
          aria-haspopup="menu"
          aria-expanded={menu?.which === 'view'}
        >
          <Settings2 size={ICON} />
        </button>

        <CollaborationLayer />

        <button
          className={`btn-icon hdr-comments${commentsOpen ? ' is-on' : ''}`}
          onClick={onToggleComments}
          aria-pressed={commentsOpen}
          data-tooltip={commentUnread > 0 ? `${commentUnread} unread ${commentUnread === 1 ? 'comment' : 'comments'}` : 'Comments'}
          data-tooltip-pos="bottom"
          aria-label={commentUnread > 0 ? `Comments, ${commentUnread} unread` : 'Comments'}
        >
          <MessageSquare size={ICON} />
          {commentUnread > 0 && (
            <span className="hdr-badge" aria-hidden="true">
              {commentUnread > 9 ? '9+' : commentUnread}
            </span>
          )}
        </button>

        <button
          className="btn-icon"
          onClick={() => onHelpClick?.()}
          aria-label="Keyboard shortcuts and help"
          data-tour="help"
          data-tooltip="Shortcuts and help (?)"
          data-tooltip-pos="bottom"
        >
          <HelpCircle size={ICON} />
        </button>

        <span className="hdr-divider" role="separator" aria-orientation="vertical" />

        <button className="hdr-btn hdr-btn--quiet" onClick={() => onExportClick?.()} aria-label="Export">
          <Download size={ICON} aria-hidden /> <span className="hdr-share-text">Export</span>
        </button>

        <button className="hdr-btn hdr-btn--strong" onClick={onShareClick} aria-label="Share workspace" data-tour="share">
          <Share2 size={ICON} aria-hidden /> <span className="hdr-share-text">Share</span>
        </button>
      </div>

      {menu && (
        <Menu
          key={menu.which}
          label={menu.which === 'board' ? 'Board menu' : 'View settings'}
          entries={menu.which === 'board' ? boardEntries() : viewEntries()}
          anchor={{ kind: 'rect', rect: menu.rect, prefer: 'below', align: menu.which === 'board' ? 'start' : 'end' }}
          focusFirst={menu.keyboard}
          onClose={() => {
            justClosed.current = { which: menu.which, at: performance.now() };
            setMenu(null);
          }}
        />
      )}
    </header>
  );
};
