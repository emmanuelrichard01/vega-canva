import React, { useEffect, useState, useRef } from 'react';
import { useRoomState } from '../../hooks/useSync';
import { CollaborationLayer } from './CollaborationLayer';
import { Moon, Sun, Undo2, Redo2, Share2, Download, EyeOff, History, PanelLeft, MessageSquare, MoreHorizontal } from 'lucide-react';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { Switch } from '../ui/Switch';
import { Logo } from '../ui/Logo';

interface Props {
  localTitle: string;
  setLocalTitle: (title: string) => void;
  onTitleSave: (title: string) => void;
  isDarkTheme: boolean;
  setIsDarkTheme: (dark: boolean) => void;
  onShareClick: () => void;
  onExportClick?: () => void;
  onHideUi: () => void;
  onToggleTimeline: () => void;
  onToggleComments: () => void;
  /** Unresolved threads with something you have not read. */
  commentUnread: number;
  /** Shown only once the side panels become overlays (below the compact breakpoint). */
  onTogglePanels?: () => void;
}

export const WorkspaceShell: React.FC<Props> = ({ localTitle, setLocalTitle, onTitleSave, isDarkTheme, setIsDarkTheme, onShareClick, onExportClick, onHideUi, onToggleTimeline, onToggleComments, commentUnread, onTogglePanels }) => {
  const { status, synced } = useRoomState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // What the title was when editing started, so Escape can revert to it
  // instead of just leaving the input stuck in edit mode with no way to
  // back out other than blurring (which commits, not cancels).
  const titleBeforeEditRef = useRef(localTitle);
  const physicsEnabled = useStore(state => state.physicsEnabled);
  const setPhysicsEnabled = useStore(state => state.setPhysicsEnabled);
  const snapToGrid = useStore(state => state.snapToGrid);
  const setSnapToGrid = useStore(state => state.setSnapToGrid);
  
  const getSyncStatus = () => {
    if (status !== 'connected') return { text: 'Offline', color: '#EF4444' };
    if (!synced) return { text: 'Syncing...', color: '#F59E0B' };
    return { text: 'Saved', color: 'var(--text-secondary)' };
  };

  const syncStatus = getSyncStatus();

  // The overflow menu. Closes on Escape and on a press outside — a menu that
  // only closes by re-pressing its own button is one people leave open.
  /**
   * Whether the bar is currently standing back.
   *
   * Driven by the same `canvas-drag-start` / `canvas-drag-end` events the
   * floating rail already listens to, so "you are manipulating something" has
   * one definition in the app rather than two that can disagree. Nothing is
   * hidden or moved — only contrast changes — so a control remains clickable
   * throughout, which is the whole difference between this and hiding the bar.
   */
  const [receded, setReceded] = useState(false);
  useEffect(() => {
    const down = () => setReceded(true);
    const up = () => setReceded(false);
    window.addEventListener('canvas-drag-start', down);
    window.addEventListener('canvas-drag-end', up);
    return () => {
      window.removeEventListener('canvas-drag-start', down);
      window.removeEventListener('canvas-drag-end', up);
    };
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="workspace-header panel-surface" style={{ opacity: receded ? 0.6 : 1 }}>
      {/* ------------------------------------------------- the document */}
      <div className="hdr-zone hdr-zone--start">
        {onTogglePanels && (
          <button
            className="btn-icon panel-toggle"
            onClick={onTogglePanels}
            data-tooltip="Panels"
            data-tooltip-pos="bottom"
            aria-label="Toggle panels"
            style={{ padding: 6, flexShrink: 0 }}
          >
            <PanelLeft size={18} />
          </button>
        )}
        {/* The real mark. This was `/favicon.svg` — a 762KB file, shipped on
            every page load to draw a 26px glyph. */}
        <Logo size={24} />

        {isEditingTitle ? (
          <input
            autoFocus
            value={localTitle}
            maxLength={60}
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
            style={{ fontWeight: 600, fontSize: 13, border: '1px solid var(--border-focus)', borderRadius: 4, padding: '2px 6px', outline: 'none', background: 'transparent', color: 'var(--text-primary)', width: 200 }}
          />
        ) : (
          <span
            className="hover-surface hdr-title"
            style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, fontSize: 14, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => { titleBeforeEditRef.current = localTitle; setIsEditingTitle(true); }}
            data-tooltip="Click to rename"
            data-tooltip-pos="bottom"
          >
            {localTitle}
          </span>
        )}

        {/* Sync state is a property of this document, so it sits with its
            name. It is a dot with a tooltip rather than a dot plus a word:
            "Saved" is the state 99% of the time, and a label that is almost
            always the same word is a label nobody reads. */}
        <span
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingLeft: 2 }}
          data-tooltip={syncStatus.text}
          data-tooltip-pos="bottom"
          aria-label={syncStatus.text}
          role="status"
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncStatus.color }} />
        </span>
      </div>

      {/* --------------------------------------------------- the canvas */}
      {/* Throw and Snap are settings *for the surface*, not actions on the
          document — they used to sit in the right-hand run between "Redo" and
          a collaborator count, where nothing distinguished a mode you leave on
          from a button you press once. Grouping them in the middle, in one
          recessed container, is what stops "Snap" reading as a sibling of
          "Share". */}
      <div className="hdr-zone hdr-zone--center">
        <div className="hdr-modes">
          <Switch
            checked={physicsEnabled}
            onChange={setPhysicsEnabled}
            label="Throw"
            tooltip={physicsEnabled ? 'Flick an object and it keeps moving. Turn off to place objects exactly where you drop them.' : 'Objects stop exactly where you drop them. Turn on to throw them with a flick.'}
          />
          <span style={{ width: 1, height: 18, background: 'var(--border-divider)' }} />
          <Switch
            checked={snapToGrid}
            onChange={setSnapToGrid}
            label="Snap"
            tooltip={snapToGrid ? 'Snapping to the grid — hold Ctrl while dragging for free placement' : 'Free placement — hold Ctrl while dragging to snap to the grid'}
          />
        </div>
      </div>

      {/* --------------------------------------- the room, and what leaves it */}
      <div className="hdr-zone hdr-zone--end">
        {/* Working controls, always present. */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="btn-icon" style={{ padding: '6px 8px' }} onClick={() => editor.undo()} data-tooltip="Undo (Ctrl+Z)" data-tooltip-pos="bottom" aria-label="Undo">
            <Undo2 size={17} />
          </button>
          <button className="btn-icon" style={{ padding: '6px 8px' }} onClick={() => editor.redo()} data-tooltip="Redo (Ctrl+Shift+Z)" data-tooltip-pos="bottom" aria-label="Redo">
            <Redo2 size={17} />
          </button>
          <button
            className="btn-icon"
            style={{ padding: '6px 8px', color: 'var(--history-accent)' }}
            onClick={onToggleTimeline}
            data-tooltip="History — replay everything that happened in this room"
            data-tooltip-pos="bottom"
            aria-label="History — replay this session"
          >
            <History size={17} />
          </button>
        </div>

        {/* The people, and the one signal that needs them. The collaborator
            *count* is gone: the avatars already are the count, and rendering
            "3 Collaborators" beside three faces states in words what the
            screen has already said. */}
        <CollaborationLayer />

        <button
          className="btn-icon"
          style={{ padding: '7px 9px', position: 'relative', flexShrink: 0 }}
          onClick={onToggleComments}
          data-tooltip={commentUnread > 0 ? `${commentUnread} unread` : 'Comments'}
          data-tooltip-pos="bottom"
          aria-label={commentUnread > 0 ? `Comments, ${commentUnread} unread` : 'Comments'}
        >
          <MessageSquare size={17} />
          {commentUnread > 0 && (
            <span className="hdr-badge" aria-hidden="true">
              {commentUnread > 9 ? '9+' : commentUnread}
            </span>
          )}
        </button>

        <span className="hdr-divider" style={{ width: 1, height: 22, background: 'var(--border-divider)' }} />

        <button
          style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: 'var(--text-primary)', color: 'var(--surface-primary)', border: 'none', borderRadius: 7, boxShadow: 'var(--shadow-sm)', flexShrink: 0 }}
          className="hover-fade"
          onClick={onShareClick}
          aria-label="Share workspace"
        >
          <Share2 size={15} /> <span className="hdr-share-text">Share</span>
        </button>

        {/* Everything that is real but reached for once a session. Export, the
            theme and focus mode were three separate always-on buttons at the
            far end of the header, each competing with Share for the same
            corner of the eye. */}
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            className="btn-icon"
            style={{ padding: '7px 9px' }}
            onClick={() => setMenuOpen((v) => !v)}
            data-tooltip="More"
            data-tooltip-pos="bottom"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="ctx-popover" role="menu" style={{ top: 'calc(100% + 8px)', right: 0, minWidth: 210 }}>
              <button className="ctx-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onExportClick?.(); }}>
                <Download size={15} /> Export canvas
              </button>
              <button className="ctx-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onHideUi(); }}>
                <EyeOff size={15} /> Focus mode <span className="ctx-menu-item__key">\</span>
              </button>
              <button className="ctx-menu-item" role="menuitem" onClick={() => setIsDarkTheme(!isDarkTheme)}>
                {isDarkTheme ? <Sun size={15} /> : <Moon size={15} />} {isDarkTheme ? 'Light theme' : 'Dark theme'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
