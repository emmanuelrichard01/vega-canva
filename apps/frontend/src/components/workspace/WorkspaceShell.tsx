import React, { useState, useRef } from 'react';
import { useRoomState } from '../../hooks/useSync';
import { CollaborationLayer } from './CollaborationLayer';
import { Moon, Sun, Undo2, Redo2, Share2, Download, EyeOff, History, PanelLeft, MessageSquare } from 'lucide-react';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { Switch } from '../ui/Switch';

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
  const { status, synced, awarenessUsers } = useRoomState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  // What the title was when editing started, so Escape can revert to it
  // instead of just leaving the input stuck in edit mode with no way to
  // back out other than blurring (which commits, not cancels).
  const titleBeforeEditRef = useRef(localTitle);
  const physicsEnabled = useStore(state => state.physicsEnabled);
  const setPhysicsEnabled = useStore(state => state.setPhysicsEnabled);
  const snapToGrid = useStore(state => state.snapToGrid);
  const setSnapToGrid = useStore(state => state.setSnapToGrid);
  
  const usersCount = Array.from(awarenessUsers.entries()).filter(([_, u]) => u.user).length;

  const getSyncStatus = () => {
    if (status !== 'connected') return { text: 'Offline', color: '#EF4444' };
    if (!synced) return { text: 'Syncing...', color: '#F59E0B' };
    return { text: 'Saved', color: 'var(--text-secondary)' };
  };

  const syncStatus = getSyncStatus();

  return (
    <div className="workspace-header panel-surface">
      {/* Left: Navigation & Room Name */}
      <div className="hdr-group" style={{ gap: 16, flex: '0 1 auto' }}>
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
        <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <img src="/favicon.svg" alt="Vega Canva Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>

        <div className="hdr-group" style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
          <span className="hdr-breadcrumb" style={{ whiteSpace: 'nowrap' }}>
            Workspace <span style={{ margin: '0 12px' }}>/</span>
          </span>

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
              style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, fontSize: 14, maxWidth: 240, display: 'inline-block' }}
              onClick={() => { titleBeforeEditRef.current = localTitle; setIsEditingTitle(true); }}
              data-tooltip="Click to rename"
              data-tooltip-pos="bottom"
            >
              {localTitle}
            </span>
          )}
        </div>
      </div>

      {/* Right: Collaboration & Utilities */}
      <div className="hdr-group" style={{ gap: 16, flex: '0 1 auto', justifyContent: 'flex-end' }}>
        {/* Sync Status */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', flexShrink: 0 }}
          data-tooltip={syncStatus.text}
          data-tooltip-pos="bottom"
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: syncStatus.color, flexShrink: 0 }} />
          <span className="hdr-sync-text" style={{ whiteSpace: 'nowrap' }}>{syncStatus.text}</span>
        </div>

        <div className="hdr-divider" style={{ width: 1, height: 24, background: 'var(--border-divider)' }} />

        {/* Undo / Redo */}
        <div className="hdr-history" style={{ display: 'flex', gap: 4 }}>
          <button className="btn-icon" style={{ padding: '6px 8px' }} onClick={() => editor.undo()} data-tooltip="Undo (Ctrl+Z)" data-tooltip-pos="bottom">
            <Undo2 size={18} />
          </button>
          <button className="btn-icon" style={{ padding: '6px 8px' }} onClick={() => editor.redo()} data-tooltip="Redo (Ctrl+Shift+Z)" data-tooltip-pos="bottom">
            <Redo2 size={18} />
          </button>
        </div>

        <div className="hdr-divider" style={{ width: 1, height: 24, background: 'var(--border-divider)' }} />

        {/* Throw on flick. Narrowed from a general "Physics" switch, which also
            silently disabled the force tools — so one control governed both the
            meaning of every drag and the availability of a whole tool group.
            The force tools are self-enabling now; this only decides whether
            letting go of a fast drag launches the object or just drops it. */}
        <Switch
          checked={physicsEnabled}
          onChange={setPhysicsEnabled}
          label="Throw"
          tooltip={physicsEnabled ? "Flick an object and it keeps moving. Turn off to place objects exactly where you drop them." : "Objects stop exactly where you drop them. Turn on to throw them with a flick."}
        />

        {/* Grid snapping. Previously hardcoded on with no control at all. */}
        <Switch
          checked={snapToGrid}
          onChange={setSnapToGrid}
          label="Snap"
          tooltip={snapToGrid ? 'Snapping to the grid — hold Ctrl while dragging for free placement' : 'Free placement — hold Ctrl while dragging to snap to the grid'}
        />

        <div className="hdr-divider" style={{ width: 1, height: 24, background: 'var(--border-divider)' }} />

        {/* Collaborators Count */}
        <div className="hdr-collab-count" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {usersCount} {usersCount === 1 ? 'Collaborator' : 'Collaborators'}
        </div>

        {/* Presence Avatars */}
        <CollaborationLayer />

        <div className="hdr-divider" style={{ width: 1, height: 24, background: 'var(--border-divider)' }} />

        {/* Comments. The count is the whole point of putting this in the
            header: on an infinite canvas a comment you have not scrolled to
            does not exist, so the only place a "something needs you" signal
            can live is chrome that is always on screen. */}
        <button
          className="btn-icon"
          style={{ padding: '8px 10px', position: 'relative', flexShrink: 0 }}
          onClick={onToggleComments}
          data-tooltip={commentUnread > 0 ? `${commentUnread} unread` : 'Comments'}
          data-tooltip-pos="bottom"
          aria-label={
            commentUnread > 0 ? `Comments, ${commentUnread} unread` : 'Comments'
          }
        >
          <MessageSquare size={17} />
          {commentUnread > 0 && (
            <span className="hdr-badge" aria-hidden="true">
              {commentUnread > 9 ? '9+' : commentUnread}
            </span>
          )}
        </button>

        <div className="hdr-divider" style={{ width: 1, height: 24, background: 'var(--border-divider)' }} />

        {/* Time Travel.
            This read "Play" behind a play triangle, which any first-time user
            takes for presentation mode — it is the one control in the header
            whose label described none of what it does. It opens the session
            replay, so it says so, and borrows that feature's own icon and
            accent so the button and the bar it opens are recognisably the
            same thing. */}
        <button
          className="btn-icon"
          style={{ padding: '8px 10px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--history-accent)', flexShrink: 0 }}
          onClick={onToggleTimeline}
          data-tooltip="Replay everything that happened in this room"
          data-tooltip-pos="bottom"
          aria-label="History — replay this session"
        >
          <History size={16} /> <span className="hdr-play-text">History</span>
        </button>

        <div className="hdr-divider" style={{ width: 1, height: 24, background: 'var(--border-divider)' }} />

        {/* Action Buttons */}
        <button
          style={{ padding: '8px 14px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'var(--text-primary)', color: 'var(--surface-primary)', border: '1px solid var(--border-focus)', borderRadius: 6, transition: 'all 0.1s', boxShadow: 'var(--shadow-sm)', flexShrink: 0 }}
          className="hover-fade"
          onClick={onShareClick}
          aria-label="Share workspace"
        >
          <Share2 size={16} /> <span className="hdr-share-text">Share</span>
        </button>

        <button 
          className="btn-icon" 
          style={{ padding: '8px 10px', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={onExportClick}
          data-tooltip="Export Canvas"
          data-tooltip-pos="bottom"
        >
          <Download size={18} />
        </button>

        {/* Utilities */}
        <button className="btn-icon" style={{ padding: '8px 10px' }} onClick={onHideUi} data-tooltip="Hide UI (\)" data-tooltip-pos="bottom">
          <EyeOff size={18} />
        </button>
        <button className="btn-icon" style={{ padding: '8px 10px' }} onClick={() => setIsDarkTheme(!isDarkTheme)} data-tooltip="Toggle Theme" data-tooltip-pos="bottom">
          {isDarkTheme ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </div>
  );
};
