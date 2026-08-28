import React, { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useRoomState } from '../../hooks/useSync';
import { CollaborationLayer } from './CollaborationLayer';
import { Moon, Sun, Undo2, Redo2, Share2, Download, EyeOff, History, PanelLeft, MessageSquare, SlidersHorizontal, HelpCircle } from 'lucide-react';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { railVeil } from '../../engine/interaction/railVeil';
import { textEditing } from '../../engine/interaction/textEditing';
import { Switch } from '../ui/Switch';
import { Logo } from '../ui/Logo';

/**
 * One glyph size for the whole bar.
 *
 * There were three — 18, 17 and 15 — and mixed sizes in a single row of icons
 * is visible long before anyone can say why: the 15px glyphs read as slightly
 * further away than the 17px ones, so the row appears to bow. 16 is the size
 * the rest of the app's chrome already uses, and at a 2px stroke it is the
 * step where Lucide's geometry lands on whole pixels.
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
}

export const WorkspaceShell: React.FC<Props> = ({ localTitle, setLocalTitle, onTitleSave, isDarkTheme, setIsDarkTheme, onShareClick, onExportClick, onHelpClick, onHideUi, onToggleTimeline, onToggleComments, commentUnread, onTogglePanels }) => {
  const { status, synced } = useRoomState();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  // What the title was when editing started, so Escape can revert to it
  // instead of just leaving the input stuck in edit mode with no way to
  // back out other than blurring (which commits, not cancels).
  const titleBeforeEditRef = useRef(localTitle);
  const physicsEnabled = useStore(state => state.physicsEnabled);
  const setPhysicsEnabled = useStore(state => state.setPhysicsEnabled);
  const snapToGrid = useStore(state => state.snapToGrid);
  const showContextToolbar = useStore(state => state.showContextToolbar);
  const setShowContextToolbar = useStore(state => state.setShowContextToolbar);
  const setSnapToGrid = useStore(state => state.setSnapToGrid);
  const showRulers = useStore(state => state.showRulers);
  const setShowRulers = useStore(state => state.setShowRulers);
  const showGrid = useStore(state => state.showGrid);
  const setShowGrid = useStore(state => state.setShowGrid);
  
  /**
   * The three states this dot can be in, and what each one is worth saying.
   *
   * The colours were literal hex — `#EF4444` and `#F59E0B` — which is the one
   * thing the token header asks components never to do: they are primitives,
   * they bypass the status roles that exist for exactly this, and they do not
   * move when the theme does. `--status-offline` and `--status-syncing` are
   * the same two colours with a name and a dark-mode value.
   *
   * "Syncing..." also became "Saving", because the ellipsis was doing the work
   * a word should do and "sync" is the machine's word for it. What a person
   * wants to know is whether their work is safe.
   */
  const getSyncStatus = () => {
    if (status !== 'connected') {
      return {
        /** The word beside the dot. Absent for the state that needs no word. */
        label: 'Offline',
        text: 'Offline. Your changes are saved on this device and will sync when you reconnect',
        tone: 'offline' as const,
      };
    }
    if (!synced) return { label: 'Saving', text: 'Saving your changes', tone: 'syncing' as const };
    return { label: null, text: 'All changes saved', tone: 'idle' as const };
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
  const receded = useSyncExternalStore(railVeil.subscribe, railVeil.getSnapshot, railVeil.getSnapshot);

  /**
   * The floor under a gesture that never announced its end.
   *
   * This used to hold its own boolean fed by the same two events, which meant
   * it also inherited their failure: Konva does not fire `dragend` for a node
   * destroyed mid-drag, so one interrupted handle drag left the bar dimmed for
   * the life of the page. Reading `railVeil` puts both surfaces behind one
   * definition — which is what the paragraph above always claimed — and this
   * listener is the same release rule the rail applies, registered here too so
   * the recovery does not depend on the rail happening to be on screen.
   */
  useEffect(() => {
    const settle = () => { railVeil.settle(textEditing.getSnapshot()); };
    window.addEventListener('pointerup', settle, true);
    window.addEventListener('pointercancel', settle, true);
    return () => {
      window.removeEventListener('pointerup', settle, true);
      window.removeEventListener('pointercancel', settle, true);
    };
  }, []);

  const viewRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);

  /**
   * Dismissal, written once for both menus.
   *
   * There are two popovers in this bar now, and a second copy of "close on
   * Escape and on a press outside" is a second chance to get one of them
   * wrong — usually by forgetting that the *other* menu opening should close
   * this one.
   */
  useEffect(() => {
    if (!viewOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (viewRef.current && !viewRef.current.contains(t)) setViewOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [viewOpen]);

  return (
    <div className="workspace-header" style={{ opacity: receded ? 0.6 : 1 }}>
      {/* ------------------------------------------------- the document */}
      <div className="hdr-zone hdr-zone--start">
        {onTogglePanels && (
          <button
            className="btn-icon panel-toggle"
            onClick={onTogglePanels}
            data-tooltip="Panels"
            data-tooltip-pos="bottom"
            aria-label="Toggle panels"
          >
            <PanelLeft size={ICON} />
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
            className="hdr-title hdr-title--editing"
          />
        ) : (
          <button
            type="button"
            className="hdr-title hdr-title--button"
            onClick={() => { titleBeforeEditRef.current = localTitle; setIsEditingTitle(true); }}
            data-tooltip="Rename this board"
            data-tooltip-pos="bottom"
          >
            {localTitle}
          </button>
        )}

        {/**
          * The one place this application says whether your work is safe.
          *
          * Sync state is a property of this document, so it sits with its name.
          * It was a bare dot with a tooltip on the reasoning that "Saved" is
          * the state 99% of the time and a label that is almost always the same
          * word is a label nobody reads — which is right about *that* word, and
          * was being used to justify silence about the other two.
          *
          * So the dot **grows a word only when there is one worth reading**.
          * Saved stays a dot: it is the resting state, it is what you assume,
          * and a permanent "Saved" is chrome. Saving and Offline get the word,
          * because those are the moments the assumption is wrong.
          *
          * This also absorbed a separate offline banner that sat over the
          * canvas in fifteen inline style properties, saying the same thing in
          * different words four inches away. Two statements of one fact have to
          * be kept in step and one of them will not be — the radar section of
          * the handoff records this project making the identical call once
          * before, and deleting the second copy then too.
          *
          * `aria-live` is on the element rather than on a hidden twin: a
          * visually-hidden live region announcing the connection used to live
          * in `Room`, which meant the state was written down twice for two
          * audiences and could drift for one of them.
          */}
        <span
          className={`sync-pip sync-pip--${syncStatus.tone}`}
          data-tooltip={syncStatus.text}
          data-tooltip-pos="bottom"
          role="status"
          aria-live="polite"
          aria-label={syncStatus.text}
        >
          <span className="sync-pip__dot" aria-hidden />
          {syncStatus.label && <span className="sync-pip__label">{syncStatus.label}</span>}
        </span>
      </div>

      {/* The centre is deliberately empty.

          It held the Throw and Snap switches, which was already an
          improvement on having them loose in the right-hand run — but it
          spent the most valuable strip in the application on two settings
          most people choose once and never revisit, permanently lit. They are
          in the View menu now, where you would go looking for "how does the
          surface behave", and the board gets the space back. */}

      {/* --------------------------------------- the room, and what leaves it */}
      <div className="hdr-zone hdr-zone--end">
        {/* Working controls, always present. */}
        <div className="hdr-cluster">
          <button className="btn-icon" onClick={() => editor.undo()} data-tooltip="Undo (Ctrl+Z)" data-tooltip-pos="bottom" aria-label="Undo">
            <Undo2 size={ICON} />
          </button>
          <button className="btn-icon" onClick={() => editor.redo()} data-tooltip="Redo (Ctrl+Shift+Z)" data-tooltip-pos="bottom" aria-label="Redo">
            <Redo2 size={ICON} />
          </button>
          <button
            className="btn-icon"
            style={{ color: 'var(--history-accent)' }}
            onClick={onToggleTimeline}
            data-tooltip="Replay everything that happened in this room"
            data-tooltip-pos="bottom"
            aria-label="History. Replay this session"
          >
            <History size={ICON} />
          </button>
        </div>

        {/* How the surface behaves.

            One control instead of two permanently-lit switches. Snap and
            Throw are set once and rarely revisited, so they do not earn
            standing space — but they are also not "once a session" the way
            the theme is, and burying them in the overflow menu beside Export
            would have been the opposite mistake.

            Focus mode lives here too, and this is the point of the menu. It
            was reachable by pressing backslash or by finding it in an
            overflow menu behind an unlabelled "…" — which is to say it was
            folklore. It is a *view* state, so it belongs with the other
            answers to "how am I looking at this board". */}
        <div style={{ position: 'relative' }} ref={viewRef}>
          <button
            className={`btn-icon${viewOpen ? ' is-on' : ''}`}
            onClick={() => setViewOpen((v) => !v)}
            data-tooltip="Snapping, throwing and focus mode"
            data-tooltip-pos="bottom"
            aria-label="View settings"
            aria-haspopup="menu"
            aria-expanded={viewOpen}
          >
            <SlidersHorizontal size={ICON} />
          </button>
          {viewOpen && (
            <div className="ctx-popover" role="menu" style={{ top: 'calc(100% + 8px)', right: 0, minWidth: 248 }}>
              <div className="hdr-view-row">
                <Switch
                  block
                  checked={snapToGrid}
                  onChange={setSnapToGrid}
                  label="Snap to grid"
                  tooltip={snapToGrid ? 'Snapping to the grid. Hold Ctrl while dragging for free placement' : 'Free placement. Hold Ctrl while dragging to snap to the grid'}
                />
              </div>
              <div className="hdr-view-row">
                <Switch
                  block
                  checked={physicsEnabled}
                  onChange={setPhysicsEnabled}
                  label="Throw on flick"
                  tooltip={physicsEnabled ? 'Flick an object and it keeps moving. Turn off to place objects exactly where you drop them.' : 'Objects stop exactly where you drop them. Turn on to throw them with a flick.'}
                />
              </div>
              {/* What follows the selection. Grouped with Snap and Throw
                  because all three answer "what happens when I touch this",
                  rather than with the grid and rulers below, which are about
                  what the board is drawn on. */}
              <div className="hdr-view-row">
                <Switch
                  block
                  checked={showContextToolbar}
                  onChange={setShowContextToolbar}
                  label="Selection toolbar"
                  tooltip={showContextToolbar ? 'Hide the toolbar that follows the selection and work from the Properties panel instead' : 'Show a toolbar beside whatever is selected'}
                />
              </div>
              <div className="ctx-popover__rule" role="separator" />
              {/* What the board is drawn *on*. Separate from Snap and Throw
                  above, which are about how it behaves when you touch it. */}
              <div className="hdr-view-row">
                <Switch
                  block
                  checked={showRulers}
                  onChange={setShowRulers}
                  label="Rulers"
                  tooltip={showRulers ? 'Hide the rulers and give their 22px back to the board' : 'Show rulers along the top and left edges'}
                />
              </div>
              <div className="hdr-view-row">
                <Switch
                  block
                  checked={showGrid}
                  onChange={setShowGrid}
                  label="Dot grid"
                  tooltip={showGrid ? 'Hide the dot field' : 'Show the dot field the board is drawn on'}
                />
              </div>
              <div className="ctx-popover__rule" role="separator" />
              {/* The theme, up from the overflow menu.

                  It sat alone behind an unlabelled "…" on the reasoning that
                  it is a once-a-session choice -- true, and beside the point:
                  the question it answers is "how am I looking at this board",
                  which is the question this whole menu answers. Moving it here
                  left the overflow holding nothing, so that button is gone and
                  the header is one control lighter. */}
              <button className="ctx-menu-item" role="menuitem" onClick={() => setIsDarkTheme(!isDarkTheme)}>
                {isDarkTheme ? <Sun size={15} /> : <Moon size={15} />}
                {isDarkTheme ? 'Light theme' : 'Dark theme'}
              </button>
              <button className="ctx-menu-item" role="menuitem" onClick={() => { setViewOpen(false); onHideUi(); }}>
                <EyeOff size={15} /> Focus mode
                <span className="ctx-menu-item__key">\</span>
              </button>
            </div>
          )}
        </div>

        {/* The people, and the one signal that needs them. The collaborator
            *count* is gone: the avatars already are the count, and rendering
            "3 Collaborators" beside three faces states in words what the
            screen has already said. */}
        <CollaborationLayer />

        <button
          className="btn-icon"
          style={{ position: 'relative' }}
          onClick={onToggleComments}
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

        {/* Help, beside the other global actions rather than floating over the
            board.

            The two obvious homes were both wrong. Bottom-right is the
            convention, and it is where the Properties panel lives. Bottom-left
            already holds the Radar, and the one corner reserved for persistent
            canvas chrome should not gain a second meaning. The header is where
            everything that is about the *session* rather than the drawing
            already sits — Export, Share, history — and help belongs with those.

            Kept as an icon with no label: it is the one control here nobody
            needs to read to recognise. */}
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

        {/* The one rule in the bar, and it earns its place: it is the line
            between what you are doing to the board and what leaves the room.
            Sized and coloured in the stylesheet rather than here, so it
            matches the other hairlines instead of being its own grey. */}
        <span className="hdr-divider" role="separator" aria-orientation="vertical" />

        {/* Export, out of the drawer.

            It sat in the overflow menu under a comment calling it something
            "reached for once a session" — which was true when it wrote three
            formats. It writes six now, with a live preview, per-frame batch
            export and copy-to-clipboard, and getting work *out* of a design
            tool is not a footnote. Quieter than Share, because sharing a link
            is still the more common way work leaves this room. */}
        <button className="hdr-btn hdr-btn--quiet" onClick={() => onExportClick?.()} aria-label="Export">
          <Download size={ICON} aria-hidden /> <span className="hdr-share-text">Export</span>
        </button>

        {/* The room's front door. Inked rather than accent-filled, per the
            system's own reading: this is the primary action *in this bar*, but
            the board is the primary thing on the screen, and an orange control
            in permanent chrome stops being an accent by the second minute. */}
        <button className="hdr-btn hdr-btn--strong" onClick={onShareClick} aria-label="Share workspace" data-tour="share">
          <Share2 size={ICON} aria-hidden /> <span className="hdr-share-text">Share</span>
        </button>

      </div>
    </div>
  );
};
