import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { nanoid } from 'nanoid';
import {
  AlertTriangle, ArrowRight, ChevronRight, Compass, FileText, Layers, Link2, LogOut, Plus,
  Search, Sparkles, Undo2,
  SquarePen, UploadCloud, X,
} from 'lucide-react';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { looksLikeRoomCode, roomIdFromCode } from './engine/room/roomCode';
import { notices$ } from './engine/ui/notices';
import { stashPendingRestore, stashPendingTemplate } from './engine/export/pendingRestore';
import {
  CATEGORIES, TEMPLATES, templatePreview,
  type Template, type TemplateCategory,
} from './engine/templates/templates';
import { WorkspaceCover } from './components/WorkspaceCover';
import { AuthModal } from './components/AuthModal';
import { Logo } from './components/ui/Logo';
import { Avatar } from './components/ui/Avatar';

interface RecentWorkspace {
  id: string;
  name: string;
  lastAccessed: number;
}

interface RemovedWorkspace extends RecentWorkspace {
  removedAt: number;
}

const STORAGE_KEY = 'recentWorkspaces';

/**
 * Boards taken off this device, kept so they can be put back.
 *
 * ## Why removing one is the most dangerous click on this screen
 *
 * It is not a delete. The board is untouched, it is still on the server, and
 * the link still opens it -- which is exactly what makes it dangerous, because
 * it *reads* as the harmless one of the two. There are no accounts here, so
 * this list is, for almost every board, the only record of its address. Losing
 * the address is losing the work: the objects are all still there and nobody
 * can ever reach them again.
 *
 * That was a single unconfirmed click on a small X that sits on a card people
 * are aiming at with a pointer. So: an undo on the notice, for the moment it
 * happens, and this list for afterwards, because a toast is gone in ten
 * seconds and the realisation usually is not.
 */
const REMOVED_KEY = 'vega_removed_workspaces';

/** Enough to cover a tidying session. Older ones fall off the end. */
const REMOVED_LIMIT = 24;
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
  /**
   * Your boards, unless you last chose otherwise.
   *
   * A first visit used to land on the gallery, on the reasoning that the boards
   * view would be empty and the gallery is the only half with anything in it.
   * That was true when the empty state was an icon and a paragraph. It now
   * offers the three real openings, the first of which is the gallery, so
   * landing on the boards costs a newcomer nothing and gains them the thing a
   * library is for: this is where your work is.
   *
   * It also stops the front door moving between the first visit and the second,
   * which is the sort of thing nobody can name and everybody feels.
   */
  const remembered = localStorage.getItem(VIEW_KEY);
  if (remembered === 'boards' || remembered === 'templates') return remembered;
  return 'boards';
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
  const [removedRooms, setRemovedRooms] = useState<RemovedWorkspace[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [joinLink, setJoinLink] = useState('');
  /** Said when a code does not check out, rather than opening a phantom board. */
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentWorkspace[]>([]);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  /**
   * Whether the search field is showing.
   *
   * Revealed rather than permanent. The field is the second thing on this page
   * and a permanent one sat above the first: a library is a wall of pictures,
   * and the answer to "which of these" is usually to look rather than to type.
   * It stays out while there is a query, so a filtered grid never loses the
   * control that filtered it.
   */
  const [seeking, setSeeking] = useState(false);
  /** The account menu, which also holds the two rare actions. */
  const [meOpen, setMeOpen] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const meRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) setRecentRooms(saved);
    } catch { /* corrupt localStorage entry — not worth surfacing */ }
    try {
      const gone = JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]');
      if (Array.isArray(gone)) setRemovedRooms(gone);
    } catch { /* same */ }
  }, []);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  /**
   * `/` puts the caret in the search field.
   *
   * The one convention every library screen shares, and the reason it is worth
   * having here rather than being a nicety: this page is a grid of twenty-one
   * pictures, and the fastest way through it is to type. The field is centred
   * in the bar where it can be reached, but reaching for it is still a journey
   * across the screen with a pointer.
   *
   * Ignored while a field already has focus, so typing a slash into the search
   * or the join box types a slash.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      e.preventDefault();
      setSeeking(true);
      // After the field exists. `setSeeking` renders it; focusing in the same
      // tick would aim at an element that is not there yet.
      window.setTimeout(() => searchRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** A menu that outlives a click elsewhere is a menu you have to dismiss. */
  useEffect(() => {
    if (!meOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!meRef.current?.contains(e.target as Node)) setMeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMeOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [meOpen]);

  // Switching views starts a new screen, so it starts at the top of one.
  useEffect(() => { stageRef.current?.scrollTo({ top: 0 }); }, [view]);

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

  /**
   * A link, or a code.
   *
   * ## Why this refuses things now
   *
   * It used to take whatever it was given and navigate. That is right for a
   * link -- there is nothing to check, and an id we do not recognise may still
   * be somebody's board -- and it was quietly wrong for everything else,
   * because *every* string is a valid room id. A code typed with one symbol
   * wrong did not fail; it opened a different board, which did not exist,
   * which meant an empty canvas and a person reasonably certain their
   * colleague's work had been lost.
   *
   * A room code carries a check symbol precisely so that this case can be
   * caught. See `engine/room/roomCode.ts`. So: anything shaped like a code is
   * verified and refused if it does not hold, and anything else is treated as
   * a link and passed through as before.
   */
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    // Trimmed before extracting, not after: a pasted link with trailing
    // whitespace — routine when copying out of chat — used to carry that into
    // the room id and land on a different, brand-new empty room.
    const trimmed = joinLink.trim();
    if (!trimmed) return;

    if (trimmed.includes('/room/')) {
      const roomId = (trimmed.split('/room/')[1] || '').split(/[/?#]/)[0].trim();
      if (!roomId) {
        setJoinError('That link has no board in it. Copy the whole thing, up to and past /room/.');
        return;
      }
      window.location.href = `/room/${roomId}`;
      return;
    }

    if (looksLikeRoomCode(trimmed)) {
      const roomId = roomIdFromCode(trimmed);
      if (!roomId) {
        setJoinError('That code is not quite right. Check it against the one you were sent.');
        return;
      }
      window.location.href = `/room/${roomId}`;
      return;
    }

    // Neither shape. Most likely a bare id out of somebody's address bar,
    // which is still a legitimate way in and cannot be checked.
    const roomId = trimmed.split(/[/?#]/)[0].trim();
    if (!roomId) return;
    window.location.href = `/room/${roomId}`;
  };

  const writeRecents = (next: RecentWorkspace[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setRecentRooms(next);
  };

  const writeRemoved = (next: RemovedWorkspace[]) => {
    const capped = next.slice(0, REMOVED_LIMIT);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(capped));
    setRemovedRooms(capped);
  };

  /**
   * Take a board off this device, recoverably.
   *
   * Nothing is deleted -- see the note on `REMOVED_KEY` for why that is the
   * problem rather than the reassurance. The board keeps existing and this
   * list is the only thing that knew how to reach it, so the removal is
   * undoable twice over: from the notice, and afterwards from the shelf under
   * the grid.
   *
   * Restored to its old position rather than to the front. Putting it back
   * where it was makes undo look like nothing happened, which is the whole
   * point of an undo; putting it at the top makes the list reorder itself as a
   * consequence of a mistake being corrected.
   */
  const removeRoom = (e: React.MouseEvent, room: RecentWorkspace) => {
    e.preventDefault();
    e.stopPropagation();

    const index = recentRooms.findIndex((r) => r.id === room.id);
    if (index < 0) return;

    writeRecents(recentRooms.filter((r) => r.id !== room.id));
    writeRemoved([{ ...room, removedAt: Date.now() }, ...removedRooms.filter((r) => r.id !== room.id)]);

    notices$.notify({
      message: `Removed “${room.name}” from this device. The board itself is untouched.`,
      tone: 'info',
      // Longer than a confirmation, because this is the one action here whose
      // consequence is not visible in what is left on screen.
      duration: 12000,
      action: { label: 'Undo', run: () => putBack(room.id, index) },
    });
  };

  /** Return a removed board to the list, at `index` when we still know it. */
  const putBack = (id: string, index?: number) => {
    setRemovedRooms((removed) => {
      const entry = removed.find((r) => r.id === id);
      if (!entry) return removed;

      setRecentRooms((current) => {
        if (current.some((r) => r.id === id)) return current;
        const { removedAt: _removedAt, ...room } = entry;
        const next = [...current];
        next.splice(Math.min(index ?? next.length, next.length), 0, room);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      const nextRemoved = removed.filter((r) => r.id !== id);
      localStorage.setItem(REMOVED_KEY, JSON.stringify(nextRemoved));
      return nextRemoved;
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
        {/* One fact, and only where there is one. The three word-chips that
            used to sit here named what a board *teaches*, which was never why
            anybody picked one, and eleven small boxes a row is a lot of
            furniture on a page whose job is to show pictures. */}
        {template.objectCount && (
          <span className="tcard__meta">
            <span className="tcard__count">{template.objectCount.toLocaleString()} objects</span>
          </span>
        )}
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
              <h3 className="stage__subhead">Built at scale</h3>
              <div className="tgrid tgrid--featured">{featured.map(templateCard)}</div>
              <h3 className="stage__subhead stage__subhead--spaced">Start your work here</h3>
            </>
          )}
          <div className="tgrid">{rest.map(templateCard)}</div>
        </>
      )}
    </>
  );

  /**
   * Nothing here yet, and three things to do about it.
   *
   * It was an icon, a heading and a paragraph that *described* three actions --
   * start from a template, create a blank board, open a link -- while offering
   * none of them. An empty state that names the way out and then makes you go
   * and find it is the least useful screen in a product, because it is the one
   * shown to somebody who does not yet know where anything is.
   *
   * The three are the three real openings, in the order they are worth trying:
   * a template is the fastest way to something that looks like work, a blank
   * board is the honest default, and a link is why most people arrive at all.
   */
  const boardsBody = !hasRooms ? (
    <div className="stage__empty stage__empty--start">
      <h3>Nothing here yet</h3>
      <p>Boards you open on this device collect here. Three ways to get the first one.</p>
      <div className="starts">
        <button type="button" className="start" onClick={() => goTemplates(null)}>
          <span className="start__icon"><FileText size={18} aria-hidden="true" /></span>
          <span className="start__text">
            <span className="start__name">Start from a template</span>
            <span className="start__sub">{TEMPLATES.length} boards that open already filled in</span>
          </span>
          <ArrowRight size={15} className="start__go" aria-hidden="true" />
        </button>
        <button type="button" className="start" onClick={openBoard}>
          <span className="start__icon"><SquarePen size={18} aria-hidden="true" /></span>
          <span className="start__text">
            <span className="start__name">Open a blank board</span>
            <span className="start__sub">An empty canvas with no edges</span>
          </span>
          <ArrowRight size={15} className="start__go" aria-hidden="true" />
        </button>
        <button type="button" className="start" onClick={() => setJoinOpen(true)}>
          <span className="start__icon"><Link2 size={18} aria-hidden="true" /></span>
          <span className="start__text">
            <span className="start__name">Open a link</span>
            <span className="start__sub">Somebody has shared a board with you</span>
          </span>
          <ArrowRight size={15} className="start__go" aria-hidden="true" />
        </button>
      </div>
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
      {/**
        * The way into the other half, as a tile in the grid rather than a band
        * beneath it.
        *
        * It was a full-width button under the boards: a horizontal bar the
        * width of the page, carrying a heading, a sentence and an arrow, for a
        * link. That is a lot of furniture to cross a room, and it read as a
        * banner, which is the one thing on a page people have trained
        * themselves not to look at.
        *
        * As a tile it is the same size and shape as the things beside it, it
        * sits where the eye is already travelling, and it needs two words
        * because its neighbours have explained the context. The dashed edge is
        * the only difference, and it says the one thing that matters: this one
        * is not a board.
        */}
      {/* Built like a board card, because it stands in a row of them: a 16:10
          picture area, then the name and the line under it on the page. It was
          one block with its words inside the picture, so its title sat where
          the other cards' pictures were and the row had two baselines. */}
      <button type="button" className="xtile" onClick={() => goTemplates(null)}>
        <span className="xtile__art" aria-hidden="true">
          <Compass size={23} />
        </span>
        <span className="xtile__body">
          <span className="xtile__name">Browse templates</span>
          <span className="xtile__sub">{TEMPLATES.length} boards, already filled in</span>
        </span>
      </button>

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
            onClick={(e) => removeRoom(e, room)}
            aria-label={`Remove ${room.name} from this device`}
            data-tooltip="Remove from this device"
          >
            <X size={15} />
          </button>
        </a>
      ))}
    </div>
  );

  return (
    /**
     * A rail and a stage, and nothing above them.
     *
     * ## Why the top bar went
     *
     * It held four things -- a wordmark, a search field, a name and a sign-out
     * button -- across the full width of the window, and none of them was worth
     * a band of its own. A 52px strip spanning 1400px to carry a logo and an
     * avatar is the layout of an admin console: it is what you build when the
     * navigation has nowhere else to go.
     *
     * The navigation *did* have somewhere else to go. The rail was already
     * down the left, already permanent, and already the thing people aim at.
     * Folding the four into its head and foot costs nothing, returns the whole
     * height of the window to the work, and puts identity, navigation and
     * account in one column instead of an L.
     *
     * ## Why the rail is icons only
     *
     * It carried labels and counts as full rows, which is right when the rail
     * is the page's主 furniture and wrong now that it is the page's *edge*.
     * Two destinations do not need two hundred pixels; they need to be
     * unmistakable and out of the way. The names are in tooltips and in the
     * stage's own heading, which is where somebody actually reads them.
     *
     * The categories moved out with the labels. They belong beside the grid
     * they filter, which is the stage, and as a row rather than a column --
     * five short words across the top of a wall of pictures reads as a filter,
     * where five rows down the side read as more navigation.
     */
    <div className="lib">
      <nav className="lrail" aria-label="Library">
        <a className="lrail__brand" href="/" aria-label="Vega Studio home">
          <Logo piece="mark" size={24} />
        </a>

        {/* The one front door, and the only accent on the rail. */}
        <button
          type="button"
          className="lrail__new"
          onClick={openBoard}
          data-tooltip="New board"
          data-tooltip-pos="right"
          aria-label="New board"
        >
          <Plus size={19} aria-hidden="true" />
        </button>

        <div className="lrail__nav">
          <button
            type="button"
            className={`lrail__item${view === 'boards' ? ' is-on' : ''}`}
            aria-current={view === 'boards' ? 'page' : undefined}
            onClick={() => setView('boards')}
            data-tooltip="Your boards"
            data-tooltip-pos="right"
            aria-label="Your boards"
          >
            <Layers size={19} aria-hidden="true" />
            {recentRooms.length > 0 && <span className="lrail__dot" aria-hidden="true" />}
          </button>

          <button
            type="button"
            className={`lrail__item${view === 'templates' ? ' is-on' : ''}`}
            aria-current={view === 'templates' ? 'page' : undefined}
            onClick={() => goTemplates(null)}
            data-tooltip="Templates"
            data-tooltip-pos="right"
            aria-label="Templates"
          >
            {/* A compass, sized down a point.
                It is drawn as a circle filling its whole viewbox, where the
                layers glyph beside it is a flatter shape with air above and
                below, so at a matched nominal size the compass carries more
                ink and sits heavier on the rail. 18 against 19 evens the two
                optically, which is the actual fix -- the glyph was never off
                centre, its bounding box is a centred circle. */}
            <Compass size={18} aria-hidden="true" />
          </button>
        </div>

        <span className="lrail__spacer" />

        <button
          type="button"
          className={`lrail__item${seeking || query ? ' is-on' : ''}`}
          onClick={() => { setSeeking(true); window.setTimeout(() => searchRef.current?.focus(), 0); }}
          data-tooltip="Search  /"
          data-tooltip-pos="right"
          aria-label="Search boards and templates"
        >
          <Search size={18} aria-hidden="true" />
        </button>

        {/* Identity and the two rare actions, in one place.
            Opening a link and restoring a backup are both real and both
            uncommon, and they used to sit mid-rail at the weight of the
            gallery. Behind the avatar they are where anybody looks for the
            things that are about *you* rather than about the board. */}
        <div className="lrail__me" ref={meRef}>
          <button
            type="button"
            className="lrail__avatar"
            onClick={() => setMeOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={meOpen}
            aria-label={`${user.name}. Account and more`}
          >
            <Avatar name={user.name} color={user.color} size={30} />
          </button>

          {meOpen && (
            <div className="lrail__menu ctx-popover" role="menu">
              <p className="lrail__who">
                <span className="lrail__who-name">{user.name}</span>
                <span className="lrail__who-sub">{user.isGuest ? 'Guest session' : 'Kept on this device'}</span>
              </p>
              <div className="ctx-popover__rule" role="separator" />
              <button
                type="button"
                className="ctx-menu-item"
                role="menuitem"
                onClick={() => { setMeOpen(false); setJoinOpen(true); }}
              >
                <Link2 size={15} /> Open a link
              </button>
              <button
                type="button"
                className="ctx-menu-item"
                role="menuitem"
                onClick={() => { setMeOpen(false); restoreInputRef.current?.click(); }}
              >
                <UploadCloud size={15} /> Restore a backup
              </button>
              <div className="ctx-popover__rule" role="separator" />
              <button type="button" className="ctx-menu-item" role="menuitem" onClick={logout}>
                <LogOut size={15} /> {user.isGuest ? 'End guest session' : 'Sign out'}
              </button>
            </div>
          )}
        </div>

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
      </nav>

      <main className="lstage" ref={stageRef}>
        <div className="lstage__inner">
          {restoreError && <div className="stage__error" role="alert">{restoreError}</div>}

          {joinOpen && (
            // Inline rather than a dialog: pasting a link needs neither
            // interruption nor protected focus.
            <form className="lstage__join" onSubmit={handleJoin}>
              <Link2 size={16} aria-hidden="true" />
              <input
                type="text"
                value={joinLink}
                onChange={(e) => { setJoinLink(e.target.value); setJoinError(null); }}
                placeholder="Paste a board link, or type a code"
                aria-label="Paste a board link, or type a room code, to join"
                aria-invalid={joinError ? true : undefined}
                aria-describedby={joinError ? 'join-error' : undefined}
                autoFocus
              />
              <button type="submit" disabled={!joinLink.trim()}>Open</button>
              <button type="button" className="lstage__join-x" onClick={() => { setJoinOpen(false); setJoinError(null); }} aria-label="Cancel">
                <X size={15} />
              </button>
            </form>
          )}

          {joinOpen && joinError && (
            <p className="lstage__join-error" id="join-error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              {joinError}
            </p>
          )}

          <header className="lstage__head">
            <div className="lstage__titles">
              <h1 className="lstage__title">
                {view === 'boards' ? 'Your boards' : category ? categoryLabel : 'Templates'}
              </h1>
              <p className="lstage__lede">
                {view === 'boards'
                  ? hasRooms
                    ? `${recentRooms.length} on this device, kept in your browser rather than in an account.`
                    : 'Boards you open on this device collect here.'
                  : category
                    ? `${matchedTemplates.length} board${matchedTemplates.length === 1 ? '' : 's'}, each one editable the moment it opens.`
                    : 'Working boards, already filled in. Open one and change anything in it.'}
              </p>
            </div>

            {/* Revealed rather than always there. The field is the second thing
                on this page and it should not sit above the first. */}
            {(seeking || query) && (
              <label className="lstage__search">
                <Search size={15} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => { if (!query) setSeeking(false); }}
                  placeholder="Search boards and templates"
                  aria-label="Search boards and templates"
                />
                {query && (
                  <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </label>
            )}
          </header>

          {/* The categories, beside the grid they filter. A row across the top
              of a wall of pictures reads as a filter; the same five as a column
              down the side read as more navigation. */}
          {view === 'templates' && (
            <div className="lchips" role="group" aria-label="Template categories">
              <button
                type="button"
                className={`lchip${!category ? ' is-on' : ''}`}
                aria-pressed={!category}
                onClick={() => goTemplates(null)}
              >
                All <span>{TEMPLATES.length}</span>
              </button>
              {CATEGORIES.map((c) => {
                const count = TEMPLATES.filter((x) => x.category === c.id).length;
                if (count === 0) return null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`lchip${category === c.id ? ' is-on' : ''}`}
                    aria-pressed={category === c.id}
                    onClick={() => goTemplates(c.id)}
                  >
                    {c.label} <span>{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'boards' ? boardsBody : templatesBody}

          {/**
            * The shelf: boards taken off this device, and the way back.
            *
            * Quiet, and under everything, because on almost every visit it is
            * empty and irrelevant. It exists for the visit where it is not --
            * where somebody tidied a list, closed the notice, and then wanted
            * one of them back. Without this the address is gone and the board
            * is unreachable forever, which is a lot of consequence for a small
            * X on a card people are already aiming at.
            */}
          {view === 'boards' && removedRooms.length > 0 && (
            <section className="shelf">
              <button
                type="button"
                className="shelf__toggle"
                aria-expanded={shelfOpen}
                onClick={() => setShelfOpen((o) => !o)}
              >
                <ChevronRight size={14} aria-hidden="true" className="shelf__chev" />
                {removedRooms.length === 1
                  ? '1 board removed from this device'
                  : `${removedRooms.length} boards removed from this device`}
              </button>

              {shelfOpen && (
                <>
                  <p className="shelf__note">
                    None of these was deleted. Each one still exists and still opens;
                    this device simply stopped keeping the address.
                  </p>
                  <ul className="shelf__list">
                    {removedRooms.map((room) => (
                      <li key={room.id} className="shelf__row">
                        <span className="shelf__name">{room.name}</span>
                        <span className="shelf__when">Removed {formatDate(room.removedAt)}</span>
                        <button type="button" className="shelf__put" onClick={() => putBack(room.id)}>
                          <Undo2 size={14} aria-hidden="true" /> Put back
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
