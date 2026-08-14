import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/AuthContext';
import { nanoid } from 'nanoid';
import { ChevronDown, LayoutGrid, LayoutList, LayoutTemplate, LogOut, Plus, Search, UploadCloud, X } from 'lucide-react';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { stashPendingRestore, stashPendingTemplate } from './engine/export/pendingRestore';
import { CATEGORIES, TEMPLATES, templatePreview, type TemplateCategory } from './engine/templates/templates';
import { WorkspaceCover } from './components/WorkspaceCover';
import { AuthModal } from './components/AuthModal';
import { Logo } from './components/ui/Logo';

interface RecentWorkspace {
  id: string;
  name: string;
  lastAccessed: number;
}

const STORAGE_KEY = 'recentWorkspaces';

/**
 * The rooms page — everything before the canvas.
 *
 * ## What this rebuild fixes
 *
 * The page worked and read as an afterthought, which is the one thing
 * `PRODUCT.md` says it may not be: the surfaces outside the canvas are held to
 * the same bar as the canvas.
 *
 * Four of the problems were structural rather than visual:
 *
 * 1. **The primary action was not a link.** Every workspace was a `div` with an
 *    `onClick`, so the main thing you come to this page to do could not be
 *    tabbed to, could not show a focus ring, and could not be middle-clicked or
 *    opened in a new tab. They are anchors now, which restores all four for
 *    free and costs nothing.
 * 2. **Nothing could be removed.** The list is read from `localStorage` and
 *    never verified against the server, so a room that no longer exists sat
 *    there permanently as a card that leads nowhere. The action is worded
 *    *Remove from this list*, not *Delete*, because removing the local
 *    reference is honestly all it does — there is no server-side deletion, and
 *    a button promising one would be lying.
 * 3. **Finding a workspace had no affordance beyond reading.** A search field
 *    appears once there is a list to search.
 * 4. **The masthead held five unrelated things** — title, view toggle, join
 *    form and create button on one line. Ways of *finding* a workspace now sit
 *    with the list; the title keeps the create action, which is the only thing
 *    on the page that makes a new one.
 */
export const Home: React.FC = () => {
  const { user, logout } = useAuth();
  const [joinLink, setJoinLink] = useState('');
  const [query, setQuery] = useState('');
  const [recentRooms, setRecentRooms] = useState<RecentWorkspace[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(
    () => (localStorage.getItem('vega_rooms_view') === 'list' ? 'list' : 'grid')
  );

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) setRecentRooms(saved);
    } catch { /* corrupt localStorage entry — not worth surfacing */ }
  }, []);

  useEffect(() => {
    localStorage.setItem('vega_rooms_view', viewMode);
  }, [viewMode]);

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleCreate = () => {
    window.location.href = `/room/${nanoid(10)}`;
  };

  /**
   * Rebuild a board from a JSON backup, as a **new** room.
   *
   * Deliberately not the same operation as the Restore inside the export
   * dialog, which replaces the board you are standing in. That one is
   * unreachable in the case this exists for: someone who cleared their browser,
   * or who is on a new machine, arrives here with no boards at all — so the
   * in-room restore has no room to be in.
   *
   * Validated before navigating. Sending someone to a fresh empty room and
   * *then* discovering the file was unreadable leaves them somewhere new with
   * nothing in it and no obvious way back.
   */
  const handleRestoreFile = async (file: File) => {
    setRestoreError(null);
    const text = await file.text();
    const result = parseDocumentExport(text);
    if (!result.ok) {
      setRestoreError(result.error);
      return;
    }
    stashPendingRestore(text);
    window.location.href = `/room/${nanoid(10)}`;
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    // Trim before extracting, not after: a pasted link with trailing whitespace
    // or a newline — routine when copying out of chat or email — used to carry
    // that into the room id and land on a different, brand-new empty room.
    const trimmed = joinLink.trim();
    if (!trimmed) return;

    let roomId = trimmed;
    if (trimmed.includes('/room/')) roomId = trimmed.split('/room/')[1] || '';
    roomId = roomId.split(/[/?#]/)[0].trim();
    if (!roomId) return;

    window.location.href = `/room/${roomId}`;
  };

  /**
   * Forget a workspace.
   *
   * Local only, and said so in the label. `preventDefault` because this button
   * lives inside the card's anchor — without it, removing a workspace would
   * also navigate into the one you just removed.
   */
  const removeRoom = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setRecentRooms((prev) => {
      const next = prev.filter((r) => r.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const age = Date.now() - ts;
    if (age < 86400000) return `today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (age < 172800000) return 'yesterday';
    if (age < 604800000) return `${Math.floor(age / 86400000)} days ago`;
    return d.toLocaleDateString();
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...recentRooms].sort((a, b) => b.lastAccessed - a.lastAccessed);
    return q ? sorted.filter((r) => r.name.toLowerCase().includes(q)) : sorted;
  }, [recentRooms, query]);

  // The same honest onboarding screen everywhere, rather than a second
  // "enter your name" screen that slowly drifts from the first.
  if (!user) return <AuthModal />;

  const hasRooms = recentRooms.length > 0;

  /**
   * Templates, as an element rather than inline, because it appears in two
   * places and must be the same thing in both.
   *
   * It leads the page, the way the start screen of Photoshop or Illustrator
   * leads with what you can *make* rather than with what you made last week.
   * A gallery below the fold is a gallery nobody scrolls to, and on this
   * product the templates are the clearest statement of what the canvas is
   * capable of — several of them exist precisely to be a claim you can check
   * by opening them.
   */
  /**
   * Thumbnails for the gallery, built once.
   *
   * `build()` allocates ids and lays out up to thirty nodes, so doing it per
   * render — which is per keystroke in the search box — would be wasteful for
   * a picture that never changes.
   */
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  /**
   * Whether the gallery is open, remembered.
   *
   * It leads the page, which is right for a first visit and wrong on the
   * hundredth — someone who knows what they are doing wants their own boards
   * without scrolling past a gallery every time. Collapsing is that answer,
   * and it has to persist or it is not one.
   */
  const [templatesOpen, setTemplatesOpen] = useState(
    () => localStorage.getItem('vega_templates_collapsed') !== '1'
  );
  useEffect(() => {
    localStorage.setItem('vega_templates_collapsed', templatesOpen ? '0' : '1');
  }, [templatesOpen]);
  const visibleTemplates = useMemo(
    () => (category ? TEMPLATES.filter((t) => t.category === category) : TEMPLATES),
    [category]
  );

  const templatePreviews = useMemo(() => {
    const out: Record<string, ReturnType<typeof templatePreview>> = {};
    TEMPLATES.forEach((t) => { out[t.id] = templatePreview(t); });
    return out;
  }, []);

  const templateGallery = (
    <section className="templates" aria-labelledby="templates-heading">
              <div className="templates__head">
        <button
          type="button"
          className="templates__toggle"
          aria-expanded={templatesOpen}
          aria-controls="templates-body"
          onClick={() => setTemplatesOpen((open) => !open)}
        >
          <ChevronDown size={18} className="templates__chevron" aria-hidden="true" />
          <h2 id="templates-heading" className="templates__title">Explore Vega Studio templates</h2>
        </button>
        <p className="templates__lede">
          Editable boards covering diagrams, layouts and canvases built at scale.
          Open one and change anything in it.
        </p>
      </div>

      {/* Categories, as a filter rather than navigation. Switching keeps the
          page you are on — a tab that navigated would discard the scroll
          position and anything typed into the search below. */}
      <div id="templates-body" className="templates__body" hidden={!templatesOpen}>
        <div className="templates__tabs" role="tablist" aria-label="Template categories">
          <button
            type="button" role="tab" aria-selected={category === null}
            className={`templates__tab ${category === null ? 'is-on' : ''}`}
            onClick={() => setCategory(null)}
          >
            All<span className="templates__tab-count">{TEMPLATES.length}</span>
          </button>
          {CATEGORIES.map((c) => {
            const count = TEMPLATES.filter((t) => t.category === c.id).length;
            if (count === 0) return null;
            return (
              <button
                key={c.id} type="button" role="tab" aria-selected={category === c.id}
                className={`templates__tab ${category === c.id ? 'is-on' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}<span className="templates__tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="templates__grid">
          {visibleTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="template-card"
                    onClick={() => {
                      stashPendingTemplate(template.id);
                      window.location.href = `/room/${nanoid(10)}`;
                    }}
                  >
                    {/* The board itself, drawn through the same component the
                      workspace cards use — so a template's picture is the
                      board it produces, not an illustration that will drift
                      from it. */}
                  <span className="template-card__art">
                    <WorkspaceCover
                      workspaceId={template.id}
                      name={template.name}
                      preview={templatePreviews[template.id]}
                    />
                  </span>
                  <span className="template-card__name">{template.name}</span>
                    <span className="template-card__blurb">{template.blurb}</span>
                    {/* The object count leads the chips when there is one: it is
                      the claim the board exists to make, and it is checkable. */}
                  <span className="template-card__teaches">
                    {template.objectCount && (
                      <span className="template-card__chip template-card__chip--count">
                        {template.objectCount.toLocaleString()} objects
                      </span>
                    )}
                      {template.teaches.map((what) => (
                        <span key={what} className="template-card__chip">{what}</span>
                      ))}
                    </span>
                  </button>
          ))}
        </div>
      </div>
    </section>
  );

  return (
    <div className="rooms">
      <header className="rooms__bar">
        <span className="rooms__brand">
          <Logo size={26} />
          Vega Studio
        </span>

        <div className="rooms__me">
          <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {user.isGuest ? 'Guest session' : 'Signed in on this device'}
            </div>
          </div>
          <span
            className="rooms__avatar"
            style={{ background: user.color }}
            aria-hidden="true"
          >
            {user.name.charAt(0).toUpperCase()}
          </span>
          <button
            onClick={logout}
            className="btn-icon"
            data-tooltip={user.isGuest ? 'End guest session' : 'Sign out'}
            data-tooltip-pos="bottom"
            aria-label={user.isGuest ? 'End guest session' : 'Sign out'}
            style={{ padding: 7 }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="rooms__main">
        {/* The page-level actions only. "Your boards" is the heading for the
            recents list, and it now sits with it — a page whose title names
            one of its two sections is a page that mislabels itself. */}
        <div className="rooms__masthead rooms__masthead--bare">
          <div className="rooms__masthead-actions">
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRestoreFile(file);
                // Cleared so picking the same file twice still fires a change.
                e.target.value = '';
              }}
            />
            <button
              className="rooms__secondary"
              onClick={() => restoreInputRef.current?.click()}
              data-tooltip="Rebuild a board from a JSON backup"
            >
              <UploadCloud size={16} /> Restore backup
            </button>
            <button className="rooms__primary" onClick={handleCreate}>
              <Plus size={17} /> New board
            </button>
          </div>
        </div>

        {templateGallery}

        {restoreError && (
          <div className="rooms__restore-error" role="alert">
            {restoreError}
          </div>
        )}

        {hasRooms && (
          <div className="rooms__tools">
            <label className="rooms__search">
              <Search size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search boards"
                aria-label="Search boards"
              />
            </label>

            <form className="rooms__join" onSubmit={handleJoin}>
              <input
                type="text"
                value={joinLink}
                onChange={(e) => setJoinLink(e.target.value)}
                placeholder="Paste a board link"
                aria-label="Paste a board link to join"
              />
              <button type="submit" disabled={!joinLink.trim()}>Join</button>
            </form>

            <div className="rooms__views" role="group" aria-label="Layout">
              <button
                className="rooms__view"
                aria-pressed={viewMode === 'grid'}
                aria-label="Grid"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                className="rooms__view"
                aria-pressed={viewMode === 'list'}
                aria-label="List"
                onClick={() => setViewMode('list')}
              >
                <LayoutList size={15} />
              </button>
            </div>
          </div>
        )}

        <div className="rooms__section-head">
          <h2 className="rooms__title">Your boards</h2>
          <p className="rooms__subtitle">
            {hasRooms
              ? 'Boards you have opened on this device.'
              : 'Nothing here yet. Start from a template above, or open a link someone sent you.'}
          </p>
        </div>

        {!hasRooms ? (
          <div className="rooms__empty">
            <div className="rooms__empty-mark" aria-hidden="true">
              <LayoutTemplate size={24} />
            </div>
            <h2>An infinite canvas, shared</h2>
            <p>
              Sticky notes, drawings, images and voice notes on one unbounded
              surface, with everyone on it at the same time. There is no signup —
              whoever you send the link to is in.
            </p>
            <div className="rooms__empty-actions">
              <button className="rooms__primary" onClick={handleCreate}>
                <Plus size={17} /> New board
              </button>
            </div>
            {/* The join form lives here in the empty state rather than being
                focused by a `querySelector` reaching into the toolbar above —
                which is what the old "Join with a link" button did, and which
                broke the moment that input stopped rendering. */}
            <form className="rooms__join" onSubmit={handleJoin} style={{ margin: 'var(--space-5) auto 0', maxWidth: 320 }}>
              <input
                type="text"
                value={joinLink}
                onChange={(e) => setJoinLink(e.target.value)}
                placeholder="Or paste a board link"
                aria-label="Paste a board link to join"
              />
              <button type="submit" disabled={!joinLink.trim()}>Join</button>
            </form>
          </div>
        ) : visible.length === 0 ? (
          // A filter matching nothing is a different screen from having no
          // boards, and saying so is the difference between "there is nothing
          // here" and "there is nothing here *that matches*".
          <div className="rooms__empty">
            <h2>No boards match “{query.trim()}”</h2>
            <p>Try a different name, or clear the search.</p>
            <div className="rooms__empty-actions">
              <button className="rooms__ghost" onClick={() => setQuery('')}>Clear search</button>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="rooms__grid">
            {visible.map((room) => (
              <a key={room.id} className="room-card" href={`/room/${room.id}`}>
                <WorkspaceCover workspaceId={room.id} name={room.name} />
                <div className="room-card__body">
                  <div style={{ minWidth: 0 }}>
                    <h3 className="room-card__name">{room.name}</h3>
                    <p className="room-card__meta">Opened {formatDate(room.lastAccessed)}</p>
                  </div>
                  <button
                    className="room-card__remove"
                    onClick={(e) => removeRoom(e, room.id)}
                    aria-label={`Remove ${room.name} from this list`}
                    data-tooltip="Remove from this list"
                  >
                    <X size={15} />
                  </button>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="rooms__list">
            {visible.map((room) => (
              <a key={room.id} className="room-row" href={`/room/${room.id}`}>
                <span className="room-row__lead">
                  <span className="room-row__icon" aria-hidden="true">
                    <LayoutTemplate size={17} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <h3 className="room-card__name">{room.name}</h3>
                    <p className="room-card__meta">Opened {formatDate(room.lastAccessed)}</p>
                  </span>
                </span>
                <button
                  className="room-row__remove"
                  onClick={(e) => removeRoom(e, room.id)}
                  aria-label={`Remove ${room.name} from this list`}
                  data-tooltip="Remove from this list"
                >
                  <X size={15} />
                </button>
              </a>
            ))}
          </div>
        )}

      </main>
    </div>
  );
};
