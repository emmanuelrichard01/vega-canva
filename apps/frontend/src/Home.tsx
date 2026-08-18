import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/AuthContext';
import { nanoid } from 'nanoid';
import {
  ArrowRight, Compass, Layers, Link2, LogOut, Plus, Search, Sparkles, UploadCloud, X,
} from 'lucide-react';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { stashPendingRestore, stashPendingTemplate } from './engine/export/pendingRestore';
import {
  CATEGORIES, TEMPLATES, templatePreview,
  type Template, type TemplateCategory,
} from './engine/templates/templates';
import { WorkspaceCover } from './components/WorkspaceCover';
import { AuthModal } from './components/AuthModal';
import { Logo } from './components/ui/Logo';

interface RecentWorkspace {
  id: string;
  name: string;
  lastAccessed: number;
}

const STORAGE_KEY = 'recentWorkspaces';
const VIEW_KEY = 'vega_home_view';

/** Which half of the library the stage is showing. */
type View = 'boards' | 'templates';

/**
 * Where to land, read straight from storage rather than from state.
 *
 * `recentRooms` arrives in an effect, one render too late to choose an
 * initial view with — and a first-time visitor would see the empty boards
 * view flash before being moved to the gallery.
 */
function initialView(): View {
  const remembered = localStorage.getItem(VIEW_KEY);
  if (remembered === 'boards' || remembered === 'templates') return remembered;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) && saved.length > 0 ? 'boards' : 'templates';
  } catch {
    return 'templates';
  }
}

/**
 * The library — everything before the canvas.
 *
 * ## The shape, and why it is this one
 *
 * A rail and a stage. Navigation lives in the rail, so what is left in the
 * column is only content — which is what makes a section boundary obvious
 * instead of a judgement call. The previous version stacked a masthead, a
 * collapsible gallery, category pills, a featured strip, a grid, a second
 * heading, a search field, a join form and a layout toggle down one column,
 * and the result had no shape at all.
 *
 * ## Two views, and which one you land on
 *
 * The stage shows **one view at a time** — your boards, or the gallery. They
 * are not two sections of one scroll: stacking them means every visit begins
 * by scrolling past whichever one you did not come for, and it puts two
 * headings, two grids and two empty states in a single column where a section
 * boundary becomes a judgement call.
 *
 * You land on **your boards**, because anyone who has been here before came
 * back for something they made. The exception is a first visit, where the
 * boards view is an empty state and the gallery is the only thing with
 * anything in it — so that lands on the gallery instead. One condition, not a
 * mode, and the choice is remembered after that.
 *
 * The boards view ends with an invitation into the gallery. A tab someone
 * never presses is a tab that may as well not exist, and "there are thirteen
 * boards here already full" is worth saying once where it will be read.
 *
 * ## Two fixes here that were not cosmetic
 *
 * 1. **Seven hooks ran after an early return.** `if (!user) return <AuthModal/>`
 *    sat above `useState` for the category and four memos, so signing in
 *    changed the hook count between renders — a rules-of-hooks violation that
 *    blanked the page on the transition. Every hook is now above every return.
 * 2. **There were two search fields**, in unrelated places, neither beside
 *    what it filtered. There is one now, and it filters both sections.
 */
export const Home: React.FC = () => {
  const { user, logout } = useAuth();

  // ------------------------------------------------------------------ state
  // Every hook lives above every early return. See the note above.
  const [view, setView] = useState<View>(initialView);
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  const [query, setQuery] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentWorkspace[]>([]);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) setRecentRooms(saved);
    } catch { /* corrupt localStorage entry — not worth surfacing */ }
  }, []);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  // Switching views starts a new screen, so it starts at the top of one.
  useEffect(() => { stageRef.current?.scrollTo({ top: 0 }); }, [view]);

  /**
   * The bar earns its edge only once there is something underneath it.
   *
   * A permanent rule under a header is a line drawn whether or not it
   * separates anything. This one appears when the stage has scrolled, so at
   * rest the bar and the page read as one surface.
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 4);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * Thumbnails, built once.
   *
   * `build()` allocates ids and lays out up to a hundred and fifty nodes, so
   * doing this per render — which is per keystroke in the search field — is
   * real work for a picture that never changes.
   */
  const templatePreviews = useMemo(() => {
    const out: Record<string, ReturnType<typeof templatePreview>> = {};
    TEMPLATES.forEach((t) => { out[t.id] = templatePreview(t); });
    return out;
  }, []);

  const matchedTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = category ? TEMPLATES.filter((t) => t.category === category) : TEMPLATES;
    if (q) {
      // Name, blurb and what it teaches. Searching the name alone means
      // "physics" finds nothing, which is the obvious thing to type.
      list = list.filter((t) =>
        `${t.name} ${t.blurb} ${t.teaches.join(' ')}`.toLowerCase().includes(q)
      );
    }
    return list;
  }, [category, query]);

  /**
   * The showcase boards lead the gallery, but only when nothing is narrowing
   * it. Someone who picked a category or typed a query has said exactly what
   * they want; three unrelated boards above their answer is the page
   * overriding them.
   */
  const showFeatured = !category && !query.trim();
  const featured = useMemo(
    () => (showFeatured ? matchedTemplates.filter((t) => t.featured) : []),
    [showFeatured, matchedTemplates]
  );
  const rest = useMemo(
    () => (showFeatured ? matchedTemplates.filter((t) => !t.featured) : matchedTemplates),
    [showFeatured, matchedTemplates]
  );

  const matchedRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...recentRooms].sort((a, b) => b.lastAccessed - a.lastAccessed);
    return q ? sorted.filter((r) => r.name.toLowerCase().includes(q)) : sorted;
  }, [recentRooms, query]);

  // ---------------------------------------------------------------- actions
  const openBoard = () => { window.location.href = `/room/${nanoid(10)}`; };

  const openTemplate = (template: Template) => {
    stashPendingTemplate(template.id);
    openBoard();
  };

  /**
   * Rebuild a board from a JSON backup, as a **new** room.
   *
   * Deliberately not the same operation as the Restore inside the export
   * dialog, which replaces the board you are standing in. That one is
   * unreachable in the case this exists for: someone who cleared their browser
   * arrives here with no boards at all, so the in-room restore has no room to
   * be in.
   *
   * Validated before navigating. Sending someone to a fresh empty room and
   * *then* discovering the file was unreadable leaves them somewhere new with
   * nothing in it and no obvious way back.
   */
  const handleRestoreFile = async (file: File) => {
    setRestoreError(null);
    const text = await file.text();
    const result = parseDocumentExport(text);
    if (!result.ok) { setRestoreError(result.error); return; }
    stashPendingRestore(text);
    openBoard();
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    // Trimmed before extracting, not after: a pasted link with trailing
    // whitespace — routine when copying out of chat — used to carry that into
    // the room id and land on a different, brand-new empty room.
    const trimmed = joinLink.trim();
    if (!trimmed) return;
    let roomId = trimmed;
    if (trimmed.includes('/room/')) roomId = trimmed.split('/room/')[1] || '';
    roomId = roomId.split(/[/?#]/)[0].trim();
    if (!roomId) return;
    window.location.href = `/room/${roomId}`;
  };

  /** Local only, and the label says so — there is no server-side deletion. */
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

  // The same honest onboarding screen everywhere, rather than a second
  // "enter your name" screen that slowly drifts from the first.
  if (!user) return <AuthModal />;

  const hasRooms = recentRooms.length > 0;
  const categoryLabel = CATEGORIES.find((c) => c.id === category)?.label;

  const goTemplates = (c: TemplateCategory | null) => {
    setView('templates');
    setCategory(c);
  };

  // ----------------------------------------------------------------- pieces
  const templateCard = (template: Template) => (
    <button key={template.id} type="button" className="tcard" onClick={() => openTemplate(template)}>
      {/* Drawn through the same component the board cards use, from the same
          builder that makes the board — so a card's picture is the board it
          opens, not an illustration that will drift from it. */}
      <span className="tcard__art">
        <WorkspaceCover
          workspaceId={template.id}
          name={template.name}
          preview={templatePreviews[template.id]}
        />
      </span>
      <span className="tcard__body">
        <span className="tcard__name">{template.name}</span>
        <span className="tcard__blurb">{template.blurb}</span>
        <span className="tcard__meta">
          {template.objectCount && (
            <span className="tcard__count">{template.objectCount.toLocaleString()} objects</span>
          )}
          {/* Capped rather than wrapped. A fourth chip spills onto a second
              line for some cards and not others, which gives a row ragged
              feet — and it was never why anyone picked a template. */}
          {template.teaches.slice(0, template.objectCount ? 2 : 3).map((what) => (
            <span key={what} className="tcard__chip">{what}</span>
          ))}
        </span>
      </span>
    </button>
  );

  const templatesBody = (
    <>
      {matchedTemplates.length === 0 ? (
        <div className="stage__empty">
          <Sparkles size={22} aria-hidden="true" />
          <h3>No templates match “{query.trim()}”</h3>
          <p>Try a different word, or clear the search to see all {TEMPLATES.length}.</p>
          <button type="button" className="stage__ghost" onClick={() => setQuery('')}>
            Clear search
          </button>
        </div>
      ) : (
        <>
          {featured.length > 0 && (
            <>
              {/* Named rather than labelled "Featured", which is a marketing
                  word. These three are here for one reason and it is
                  checkable by opening them. */}
              {/* Says the actual claim rather than gesturing at it. "Built to be
                  opened at scale" is the kind of phrase that sounds like it
                  means something — scale of what, and opened by whom? The
                  number is the point, so the heading is the number. */}
              <h3 className="stage__subhead">Boards with hundreds of objects on them</h3>
              <div className="tgrid tgrid--featured">{featured.map(templateCard)}</div>
              <h3 className="stage__subhead stage__subhead--spaced">Boards to start real work in</h3>
            </>
          )}
          <div className="tgrid">{rest.map(templateCard)}</div>
        </>
      )}
    </>
  );

  const boardsBody = !hasRooms ? (
    <div className="stage__empty">
      <Layers size={22} aria-hidden="true" />
      <h3>Nothing here yet</h3>
      <p>
        Boards you open show up here. Start from a template, make a blank one,
        or open a link someone sent you.
      </p>
    </div>
  ) : matchedRooms.length === 0 ? (
    // A filter matching nothing is a different screen from having no boards,
    // and saying so is the difference between "there is nothing here" and
    // "nothing here *matches*".
    <div className="stage__empty">
      <Search size={22} aria-hidden="true" />
      <h3>No boards match “{query.trim()}”</h3>
      <p>Try a different name, or clear the search.</p>
      <button type="button" className="stage__ghost" onClick={() => setQuery('')}>
        Clear search
      </button>
    </div>
  ) : (
    <div className="tgrid">
      {matchedRooms.map((room) => (
        <a key={room.id} className="bcard" href={`/room/${room.id}`}>
          <span className="bcard__art">
            <WorkspaceCover workspaceId={room.id} name={room.name} />
          </span>
          <span className="bcard__body">
            <span className="bcard__name">{room.name}</span>
            <span className="bcard__meta">Opened {formatDate(room.lastAccessed)}</span>
          </span>
          <button
            className="bcard__remove"
            onClick={(e) => removeRoom(e, room.id)}
            aria-label={`Remove ${room.name} from this list`}
            data-tooltip="Remove from this list"
          >
            <X size={15} />
          </button>
        </a>
      ))}
    </div>
  );

  const boardsSection = (
    <section className="stage__section" aria-labelledby="boards-heading">
      <div className="stage__head">
        <h2 id="boards-heading" className="stage__title">Your boards</h2>
        <p className="stage__lede">
          {hasRooms
            ? 'Boards you have opened on this device. The list lives in this browser — it is not an account.'
            : 'Boards you open on this device collect here.'}
        </p>
      </div>
      {boardsBody}
    </section>
  );

  const templatesSection = (
    <section className="stage__section" aria-labelledby="templates-heading">
      <div className="stage__head">
        <h2 id="templates-heading" className="stage__title">
          {category ? categoryLabel : 'Templates'}
        </h2>
        <p className="stage__lede">
          {category
            ? `${matchedTemplates.length} board${matchedTemplates.length === 1 ? '' : 's'} here. Each opens as an ordinary board you can change.`
            : 'Real boards, already full — open one and change anything in it. Several are here to be checked rather than admired: a thousand objects is a claim, and you can count them.'}
        </p>
      </div>
      {templatesBody}
    </section>
  );

  return (
    <div className="home">
      {/* ------------------------------------------------------------ app bar */}
      <header className={`home__bar${scrolled ? ' is-scrolled' : ''}`}>
        <a className="home__brand" href="/" aria-label="Vega Studio home">
          <Logo size={26} />
          <span>Vega Studio</span>
        </a>

        {/* One field, filtering both sections. This page used to carry two
            inputs in unrelated places, neither beside what it acted on. */}
        <label className="home__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search boards and templates"
            aria-label="Search boards and templates"
          />
        </label>

        <div className="home__me">
          <span className="home__me-text">
            <span className="home__me-name">{user.name}</span>
            <span className="home__me-sub">{user.isGuest ? 'Guest session' : 'On this device'}</span>
          </span>
          <span className="home__avatar" style={{ background: user.color }} aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <button
            onClick={logout}
            className="home__signout"
            aria-label={user.isGuest ? 'End guest session' : 'Sign out'}
            data-tooltip={user.isGuest ? 'End guest session' : 'Sign out'}
            data-tooltip-pos="bottom"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="home__body">
        {/* --------------------------------------------------------------- rail */}
        <nav className="rail" aria-label="Library">
          {/* The one front door on the page, and the only accent-filled
              control. It sits above the navigation because making something
              new does not depend on where you are. */}
          <button type="button" className="rail__new" onClick={openBoard}>
            <Plus size={17} aria-hidden="true" /> New board
          </button>

          <div className="rail__group">
            <button
              type="button"
              className={`rail__item${view === 'boards' ? ' is-on' : ''}`}
              aria-current={view === 'boards' ? 'page' : undefined}
              onClick={() => setView('boards')}
            >
              <Layers size={16} aria-hidden="true" />
              <span className="rail__label">Your boards</span>
              <span className="rail__count">{recentRooms.length}</span>
            </button>
          </div>

          {/* Its own group. These are the two top-level destinations and they
              were separated by a single pixel, so "Your boards" read as the
              first of six sibling rows rather than as the peer of Templates —
              and the categories underneath looked like they belonged to both. */}
          <div className="rail__group">
            <button
              type="button"
              className={`rail__item${view === 'templates' && !category ? ' is-on' : ''}`}
              aria-current={view === 'templates' && !category ? 'page' : undefined}
              onClick={() => goTemplates(null)}
            >
              <Compass size={16} aria-hidden="true" />
              <span className="rail__label">Templates</span>
              <span className="rail__count">{TEMPLATES.length}</span>
            </button>

            {/* Categories sit under the section they filter, indented, so they
                read as part of it rather than as a second navigation. */}
            {CATEGORIES.map((c) => {
              const count = TEMPLATES.filter((t) => t.category === c.id).length;
              if (count === 0) return null;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`rail__item rail__item--sub${view === 'templates' && category === c.id ? ' is-on' : ''}`}
                  aria-current={view === 'templates' && category === c.id ? 'true' : undefined}
                  onClick={() => goTemplates(c.id)}
                >
                  <span className="rail__label">{c.label}</span>
                  <span className="rail__count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* The rare actions, at the bottom, quiet. Joining by link and
              restoring a backup are both real and both uncommon; they used to
              sit mid-column at the same weight as the gallery. */}
          <div className="rail__foot">
            <button
              type="button"
              className="rail__quiet"
              aria-expanded={joinOpen}
              onClick={() => setJoinOpen((o) => !o)}
            >
              <Link2 size={15} aria-hidden="true" /> Open a link
            </button>

            {joinOpen && (
              // Inline rather than a dialog: pasting a link needs neither
              // interruption nor protected focus.
              <form className="rail__join" onSubmit={handleJoin}>
                <input
                  type="text"
                  value={joinLink}
                  onChange={(e) => setJoinLink(e.target.value)}
                  placeholder="Paste a board link"
                  aria-label="Paste a board link to join"
                  autoFocus
                />
                <button type="submit" disabled={!joinLink.trim()}>Open</button>
              </form>
            )}

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
            <button type="button" className="rail__quiet" onClick={() => restoreInputRef.current?.click()}>
              <UploadCloud size={15} aria-hidden="true" /> Restore a backup
            </button>
          </div>
        </nav>

        {/* -------------------------------------------------------------- stage */}
        <main className="stage" ref={stageRef}>
          {restoreError && <div className="stage__error" role="alert">{restoreError}</div>}

          {view === 'boards' ? (
            <>
              {boardsSection}

              {/* The way into the other tab.

                  A tab nobody presses may as well not exist, and "thirteen
                  boards that arrive already full" is worth saying once, where
                  it will actually be read — at the end of the view someone is
                  already looking at.

                  It states what the templates *are* rather than asking
                  whether you need help: "not sure what to make?" makes an
                  offer out of an assumed problem and reads as sales copy on a
                  tool. It also never says "below", because it is not below —
                  it is a different view, and the arrow carries the rest. */}
              <button type="button" className="seam" onClick={() => goTemplates(null)}>
                <span className="seam__text">
                  <span className="seam__title">Every template is a real board</span>
                  <span className="seam__sub">
                    Open one and change anything in it.
                  </span>
                </span>
                <span className="seam__go" aria-hidden="true"><ArrowRight size={16} /></span>
              </button>
            </>
          ) : (
            templatesSection
          )}
        </main>
      </div>
    </div>
  );
};
