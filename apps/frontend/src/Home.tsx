import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { nanoid } from 'nanoid';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Compass, Download, LayoutGrid, Layers, Link2, LogOut, Plus,
  Rows3, Trash2,
  Search, Sparkles, Undo2,
  UploadCloud, X,
} from 'lucide-react';
import { parseDocumentExport } from './engine/export/DocumentImport';
import {
  looksLikeLibrary, mergeLibrary, parseLibrary, serializeLibrary,
} from './engine/room/libraryIndex';
import { looksLikeRoomCode, roomIdFromCode } from './engine/room/roomCode';
import { notices$ } from './engine/ui/notices';
import { stashPendingRestore, stashPendingTemplate } from './engine/export/pendingRestore';
import {
  CATEGORIES, TEMPLATES, templatePreview,
  type Template, type TemplateCategory,
} from './engine/templates/templates';
import { WorkspaceCover } from './components/WorkspaceCover';
import { BoardTile, type BoardLayout } from './components/home/BoardTile';
import { QuickStart } from './components/home/QuickStart';
import {
  BOARD_SORTS,
  groupBoards,
  sortBoards,
  whenOpened,
  type BoardSort,
} from './engine/room/boardShelf';
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

/**
 * A ceiling, not a working limit.
 *
 * This was 24, described as "enough to cover a tidying session", and entries
 * beyond it fell off the end silently. That put a hole in the shelf at exactly
 * the point it exists to cover: removing a twenty-fifth board *permanently
 * discarded* the oldest removal's address, with no notice and no way back —
 * the unrecoverable loss this whole area is built around, caused by the
 * mechanism built to prevent it.
 *
 * Worse, the entry that fell off was the one removed *longest ago*, which is
 * precisely the one least likely to still be reachable from a link in
 * somebody's chat history.
 *
 * An entry is about 120 bytes, so 24 of them saved roughly two kilobytes of a
 * five-megabyte budget. Nothing was being bought.
 *
 * The number is high enough now that reaching it is a genuinely exceptional
 * event rather than a Tuesday, and `writeRemoved` says so out loud if it ever
 * happens instead of quietly trimming. The shelf's real exit is **Forget
 * permanently**: deliberate, per-board and confirmed. A limit is not a way to
 * delete things, and using one as though it were is what made the silent trim
 * look reasonable.
 */
const REMOVED_LIMIT = 500;
const VIEW_KEY = 'vega_home_view';
/** How the library is laid out and ordered. A preference, so it is remembered. */
const LAYOUT_KEY = 'vega_home_layout';
const SORT_KEY = 'vega_home_sort';

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
  // An explicit `?view=templates` wins: the install shortcut and shared links use it.
  const asked = new URLSearchParams(window.location.search).get('view');
  if (asked === 'boards' || asked === 'templates') return asked;
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
  /**
   * How the boards are shown, and in what order.
   *
   * Two real answers to two different questions. A grid answers "which one was
   * that" — you recognise a board by its shape long before its name — and a
   * list answers "where is the one called X" once there are more boards than
   * pictures anyone can scan. Both are remembered, because it is a way of
   * working rather than a thing you choose per visit.
   */
  const [layout, setLayout] = useState<BoardLayout>(
    () => (localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid')
  );
  const [sort, setSort] = useState<BoardSort>(
    () => (localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'recent')
  );
  const [sortOpen, setSortOpen] = useState(false);
  /** Which board card has its menu open, so only one ever does. */
  const [boardMenu, setBoardMenu] = useState<string | null>(null);
  /** The board whose link was just copied, for the two seconds it says so. */
  const [copiedBoard, setCopiedBoard] = useState<string | null>(null);
  const [removedRooms, setRemovedRooms] = useState<RemovedWorkspace[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [joinLink, setJoinLink] = useState('');
  /** Said when a code does not check out, rather than opening a phantom board. */
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [recentRooms, setRecentRooms] = useState<RecentWorkspace[]>([]);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  /** The account menu: identity and the session, and nothing else. */
  const [meOpen, setMeOpen] = useState(false);
  /**
   * The menu behind the `+`.
   *
   * ## Why the four openings are one control
   *
   * There are four ways to get a board on screen — blank, from a template,
   * from a backup file, from somebody's link — and they used to sit at three
   * different levels of prominence: the `+` at the top of the rail, Templates
   * as a nav destination, and the other two behind the avatar. The empty state
   * has always offered three of them together, in one list, in the order they
   * are worth trying, which is the app already saying they are one family.
   *
   * Behind the avatar was the wrong drawer, not merely a quiet one. An avatar
   * means *things about me* — who I am, this session, signing out. A backup
   * file is about a **board**. Filing a board action under a heading that
   * describes a person is why no amount of use ever made it findable: there
   * was nothing to learn, because the label did not predict the contents.
   *
   * So they are all here, behind the one thing on this page a hand already
   * goes to. Four scattered entrances is four things to remember; one entrance
   * with a menu is one, which is what muscle memory can actually hold.
   *
   * The `+` itself is unchanged: a plain click still opens a blank board with
   * no menu in the way. That is the whole point of splitting the control
   * rather than turning it into a menu button — the common case must not pay
   * for the rare ones.
   */
  const [newOpen, setNewOpen] = useState(false);
  /**
   * A backup file is being dragged over the page.
   *
   * Held as state rather than a class toggled imperatively because the drop
   * surface is the whole stage and the cue is a full-bleed overlay: React
   * already owns that subtree, and a second writer to the same DOM is how the
   * canvas ended up with two cursors.
   */
  const [dropping, setDropping] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const meRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const joinRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  /**
   * How many dragenters are outstanding.
   *
   * `dragleave` fires when the pointer crosses into a *child* of the drop
   * surface, so clearing the cue on it makes the overlay flicker off and on
   * over every card in the grid. Counting enters against leaves is the only
   * thing that survives a surface with children in it.
   */
  const dragDepth = useRef(0);

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
  useEffect(() => { localStorage.setItem(LAYOUT_KEY, layout); }, [layout]);
  useEffect(() => { localStorage.setItem(SORT_KEY, sort); }, [sort]);

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
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** A menu that outlives a click elsewhere is a menu you have to dismiss. */
  /**
   * Both rail popovers dismiss the same way, so they dismiss in one place.
   *
   * Written once over a list rather than twice over a ref: two copies of this
   * is two chances for one of them to keep a listener after its menu closed,
   * and the second menu was added by copying the first.
   */
  useEffect(() => {
    if (!meOpen && !newOpen && !sortOpen && !boardMenu) return;
    const closeAll = () => { setMeOpen(false); setNewOpen(false); setSortOpen(false); setBoardMenu(null); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (meOpen && !meRef.current?.contains(t)) setMeOpen(false);
      if (newOpen && !newRef.current?.contains(t)) setNewOpen(false);
      if (sortOpen && !sortRef.current?.contains(t)) setSortOpen(false);
      // A card's menu lives inside the card, so anything outside *that card*
      // closes it — including a click on the next card, which then opens its own.
      if (boardMenu && !(t instanceof Element && t.closest(`.bcard[href$="/${boardMenu}"]`))) setBoardMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [meOpen, newOpen, sortOpen, boardMenu]);

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
      // Name, blurb, what it teaches, and the name of the section it sits in.
      // Searching the name alone means "physics" finds nothing, which is the
      // obvious thing to type — and so is "architecture", which is a category
      // rather than a word on any card.
      list = list.filter((t) => {
        const section = CATEGORIES.find((c) => c.id === t.category)?.label ?? '';
        return `${t.name} ${t.blurb} ${t.teaches.join(' ')} ${section}`.toLowerCase().includes(q);
      });
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

  /**
   * Four templates to show at the end of the boards.
   *
   * Picked once and kept for the session rather than rotated per render: a row
   * that reshuffles while you look at it is a row you cannot point at. The
   * showcase boards lead, because they are the ones that answer "what can this
   * thing actually do" in one picture.
   */
  const suggestedTemplates = useMemo(() => {
    const featuredFirst = [...TEMPLATES].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
    // Five, not four: the seam now shares the board grid's column basis, and a
    // wide window lays that out as five tracks. Four cards left the last track
    // of the row empty, which reads as a missing card rather than as a choice.
    // Narrower windows drop to four or three tracks and simply wrap.
    return featuredFirst.slice(0, 5);
  }, []);

  const matchedRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ordered = sortBoards(recentRooms, sort);
    return q ? ordered.filter((r) => r.name.toLowerCase().includes(q)) : ordered;
  }, [recentRooms, query, sort]);

  /**
   * The boards under headings of when they were last open.
   *
   * Only where a heading earns its place: ordered by name, or filtered by a
   * search, the grouping would be arbitrary, so the grid is flat and the
   * answer to "why is it in this order" is the control that says so.
   */
  const boardGroups = useMemo(
    () => (sort === 'recent' && !query.trim() ? groupBoards(matchedRooms) : [{ id: 'today' as const, label: '', boards: matchedRooms }]),
    [matchedRooms, sort, query]
  );

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
  /**
   * Whether a drag carries something we could actually restore.
   *
   * Checked on `dragover` as well as on drop, because the cue has to be honest
   * *before* the release: an overlay that says "drop to restore" for a dragged
   * image is a promise the drop cannot keep. During a drag the browser exposes
   * only the item's `kind` and `type` — never its name or contents — so this is
   * as much as can be known, and a `.json` dragged from a file manager
   * sometimes arrives typed as `''`. A single file with no type is allowed
   * through and rejected properly on drop, where the content can be read.
   */
  const dragHasFile = (dt: DataTransfer | null) =>
    !!dt && Array.from(dt.items).some((i) => i.kind === 'file');

  const handleRestoreFile = async (file: File) => {
    setRestoreError(null);
    const text = await file.text();

    // One picker and one drop target for both kinds of file, because a person
    // holding a .json from this app should not have to know which of two
    // things it is. The discriminator is checked first so a malformed board
    // list reports a board-list problem rather than being handed to the
    // document reader and coming back as "that file does not contain a
    // document" — an error about the wrong thing, which is worse than none.
    if (looksLikeLibrary(text)) { loadLibrary(text); return; }

    const result = parseDocumentExport(text);
    if (!result.ok) { setRestoreError(result.error); return; }
    stashPendingRestore(text);
    openBoard();
  };

  /**
   * Open the join field with something already in it.
   *
   * Used by the paste shortcut and by the menu alike, so the field is filled
   * and focused by one path rather than by two that can drift.
   */
  const openJoin = (prefill = '') => {
    setJoinError(null);
    setJoinOpen(true);
    if (prefill) setJoinLink(prefill);
    window.setTimeout(() => joinRef.current?.focus(), 0);
  };

  /**
   * Paste a board link anywhere on this page.
   *
   * This is how people arrive from a link: somebody sent it, it is already on
   * the clipboard, and the current path is *find the control, click it, click
   * the field, paste*. Four steps to consume a thing the browser already has.
   *
   * Two guards, and both matter:
   *
   * - **Only when nothing is focused.** A paste into the search field or the
   *   join field itself must behave like a paste, so this stands down for any
   *   input, textarea or `contenteditable`. Without that check the shortcut
   *   would eat the very field it opens.
   * - **Only for text that is actually a board.** A link containing `/room/`
   *   or a string shaped like a room code opens the field pre-filled;
   *   everything else is left alone, because a page that reacts to *any*
   *   clipboard content is a page you stop pasting near.
   *
   * It fills the field rather than navigating. A paste is not a decision — the
   * clipboard can hold something stale — so the last step stays deliberate.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const text = (e.clipboardData?.getData('text') || '').trim();
      if (!text || text.length > 400) return;
      if (!text.includes('/room/') && !looksLikeRoomCode(text)) return;
      e.preventDefault();
      setView('boards');
      openJoin(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

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
    if (capped.length < next.length) {
      // Never silently. Losing an address is the one consequence on this page
      // that cannot be undone, so if the ceiling ever does discard one it is
      // said plainly rather than discovered later by somebody looking for a
      // board that is no longer listed anywhere.
      notices$.notify({
        message: `The removed list is full at ${REMOVED_LIMIT}, so the oldest entry has been dropped. Save your board list to keep a copy.`,
        tone: 'warning',
        duration: 14000,
      });
    }
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
  const removeRoom = (room: RecentWorkspace) => {
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

  /**
   * Drop a removal for good.
   *
   * ## Why there has to be one
   *
   * There was no way to delete. The shelf only grew, and the only thing that
   * ever shortened it was the silent cap — so the way to tidy the shelf was to
   * remove more boards until the old ones fell off the end. The route to a
   * clean list ran straight through the data loss the list exists to prevent,
   * which is what a missing exit does to a design: people find one anyway, and
   * it is the worst available.
   *
   * ## Why it is confirmed, when removing a board is not
   *
   * They are opposite actions and the asymmetry is the point. Removing a board
   * is *recoverable* — that is what the notice and this shelf are for — so it
   * can be a single click on a card. This one is where recovery stops, so it
   * is the one thing on this page that asks. It names the board, because
   * "forget this?" over a list of twelve is not a question anybody can answer.
   */
  const forgetRemoved = (room: RemovedWorkspace) => {
    const ok = window.confirm(
      `Forget “${room.name}” permanently?

` +
      'The board itself is not deleted — but this device will no longer have its ' +
      'address, and there is no way to get it back from here. If you have the link ' +
      'somewhere else, this is safe.'
    );
    if (!ok) return;
    const next = removedRooms.filter((r) => r.id !== room.id);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(next));
    setRemovedRooms(next);
  };

  /**
   * Put a removed board's address on the clipboard.
   *
   * The shelf could only ever put a board *back*, which is one of the two
   * things somebody wants from it. The other is to hand the link to a
   * colleague, or paste it somewhere that will outlive this browser — and for
   * that, restoring it to the grid first is a detour through a state you did
   * not want.
   */
  const copyBoardLink = (room: RecentWorkspace) => {
    void copyAddress(room).then(() => {
      setCopiedBoard(room.id);
      window.setTimeout(() => setCopiedBoard((id) => (id === room.id ? null : id)), 1800);
    });
  };

  const copyAddress = async (room: RecentWorkspace) => {
    const url = `${window.location.origin}/room/${room.id}`;
    try {
      await navigator.clipboard.writeText(url);
      notices$.notify({ message: `Copied the link to “${room.name}”.`, tone: 'success' });
    } catch {
      // A denied clipboard is a permission decision, not a failure to report
      // as one — so the address is offered instead of announced as lost.
      notices$.notify({ message: url, tone: 'info', duration: 20000 });
    }
  };

  /**
   * Save the board list as a file.
   *
   * Every other safeguard here protects the list *in place* and assumes the
   * `localStorage` entry still exists. None of them survives clearing site
   * data or moving to another machine, and neither of those is an accident
   * anybody gets to undo. A second record is the only answer to "this list is
   * the only record", so: the index, as a file.
   *
   * The removed shelf goes in it too, and is arguably the more valuable half —
   * those are the addresses this device has already stopped keeping.
   */
  const saveLibrary = () => {
    const text = serializeLibrary(recentRooms, removedRooms);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vega-board-list-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // Revoked on the next turn rather than immediately: the click is
    // asynchronous, and revoking in the same tick races the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notices$.notify({
      message: `Saved ${recentRooms.length + removedRooms.length} board addresses. Keep it somewhere this browser cannot reach.`,
      tone: 'success',
    });
  };

  /**
   * Fold a saved list back in.
   *
   * A **union**, never a replacement — see `mergeLibrary`. Loading a file saved
   * before three boards were opened must not take those three addresses away,
   * and doing it as a side effect of an action taken to be safer would be the
   * worst version of the loss this page is built to avoid.
   */
  const loadLibrary = (text: string) => {
    const parsed = parseLibrary(text);
    if (!parsed.ok) { setRestoreError(parsed.error); return; }

    const merged = mergeLibrary(recentRooms, parsed.file.boards);
    writeRecents(merged.boards);

    // The shelf merges on the same terms, and a board restored to the grid by
    // this load leaves the shelf: it is no longer removed.
    const live = new Set(merged.boards.map((b) => b.id));
    const shelf = new Map(removedRooms.map((r) => [r.id, r]));
    for (const r of parsed.file.removed) if (!shelf.has(r.id)) shelf.set(r.id, r);
    writeRemoved([...shelf.values()].filter((r) => !live.has(r.id)).sort((a, b) => b.removedAt - a.removedAt));

    setView('boards');
    notices$.notify({
      message: merged.added === 0
        ? 'That list held nothing this device did not already have.'
        : `Added ${merged.added} board${merged.added === 1 ? '' : 's'} from that list. Nothing was removed.`,
      tone: 'success',
    });
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
      ) : showFeatured ? (
        /*
         * The whole gallery, in sections.
         *
         * ## Why this stopped being one grid
         *
         * It was a single flat grid, which was the right answer at thirteen
         * boards and stopped being one somewhere around thirty. Forty-odd
         * cards in one run is a wall: there is no first thing to look at, no
         * way to skim for the kind of board you want, and no signal that a
         * board about a data pipeline and a board of hand-drawn shapes are
         * different sorts of thing. People scroll to the bottom, see nothing
         * they recognise, and leave.
         *
         * Sections fix that with the structure that was already there and
         * only being used as a filter. Each category gets a heading, a line
         * saying what it is for, and its own grid — so the page can be
         * *read* rather than scanned, and the categories teach what is here
         * instead of merely narrowing it.
         *
         * The chips above still filter, and a filtered or searched view still
         * renders as one flat grid, because somebody who has narrowed the
         * gallery has already said what they want and does not need it
         * re-grouped underneath them.
         */
        <>
          {featured.length > 0 && (
            <>
              {/* Named rather than labelled "Featured", which is a marketing
                  word. These are here for one reason and it is checkable by
                  opening them: the number is the claim, so the number is the
                  heading. */}
              <h3 className="stage__subhead">Built at scale</h3>
              <div className="tgrid tgrid--featured">{featured.map(templateCard)}</div>
            </>
          )}

          {CATEGORIES.map((c) => {
            const inCategory = rest.filter((t) => t.category === c.id);
            if (inCategory.length === 0) return null;
            return (
              <section key={c.id} className="tsection">
                <header className="tsection__head">
                  <div>
                    <h3 className="tsection__title">{c.label}</h3>
                    <p className="tsection__blurb">{c.blurb}</p>
                  </div>
                  {/* Only past the point where the section is long enough that
                      seeing it alone is worth a click. Below that the button
                      would just re-render what is already on screen. */}
                  {inCategory.length > 4 && (
                    <button type="button" className="lbtn" onClick={() => goTemplates(c.id)}>
                      {inCategory.length}
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  )}
                </header>
                <div className="tgrid">{inCategory.map(templateCard)}</div>
              </section>
            );
          })}
        </>
      ) : (
        <div className="tgrid">{rest.map(templateCard)}</div>
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
   * The four are the four real openings, in the order they are worth trying: a
   * template is the fastest way to something that looks like work, a blank
   * board is the honest default, a link is why most people arrive at all, and
   * a backup is why somebody is looking at an empty library on a machine they
   * have used before. That last one was missing while it was the only one this
   * screen could be certain about — a person restoring a backup necessarily
   * has no boards yet, so this is the screen they land on.
   */
  /**
   * The library itself: how to start one, and the ones you have.
   *
   * ## The four openings lead, always
   *
   * They used to appear only on the empty state — the screen a person sees
   * once — and to sit, the rest of the time, behind a `+` menu, a nav icon and
   * an account menu. So the page that opens every session began with a dashed
   * "Browse templates" tile in the first card slot: a hole where a board
   * should be, and the first thing the eye landed on. The openings are a strip
   * above the grid now, the same four in the same order, quiet enough to skim
   * past and impossible to hunt for.
   *
   * ## And the boards are grouped by when you last had them open
   *
   * Which is the order a library is actually kept in. A flat grid makes the
   * four boards you touched this morning look exactly like the one from March.
   * See `boardShelf.ts` for when a heading earns its place.
   */
  const boardsBody = !hasRooms ? (
    <QuickStart
      templateCount={TEMPLATES.length}
      onBlank={openBoard}
      onTemplates={() => goTemplates(null)}
      onJoin={() => openJoin()}
      onRestore={() => restoreInputRef.current?.click()}
    />
  ) : (
    <>
      {/*
        The openings strip that used to sit here is gone.

        It was four equal tiles — icon, name, one line of explanation — in a row
        above the boards, and it was the first thing the eye landed on every
        session. Three things were wrong with it. It is the shape this project's
        own craft floor names first among the layouts to refuse: same-size cards
        of icon plus heading plus text, used as page structure. It put chrome
        above the work on a page whose only job is to show the work. And it
        stated four actions at equal weight, three of which are rare, while the
        common one already had a button.

        All four openings still exist and none of them moved further away: the
        blank board and the two homeless ones are the split control in the
        header, and templates is a destination on the rail. The strip was the
        fourth copy of a thing that only ever needed one.
      */}

      {matchedRooms.length === 0 ? (
        // A filter matching nothing is a different screen from having no
        // boards, and saying so is the difference between "there is nothing
        // here" and "nothing here *matches*".
        <div className="stage__empty">
          <Search size={22} aria-hidden="true" />
          <h3>No boards match “{query.trim()}”</h3>
          <p>Try a different name, or clear the search.</p>
          <button type="button" className="stage__ghost" onClick={() => setQuery('')}>
            Clear search
          </button>
        </div>
      ) : (
        boardGroups.map((group) => (
          <section key={group.id} className="lgroup">
            {group.label && (
              <h2 className="lgroup__head">
                {group.label}
                <span className="lgroup__count">{group.boards.length}</span>
              </h2>
            )}
            <div className={group.boards.length && layout === 'list' ? 'blist' : 'tgrid'}>
              {group.boards.map((room) => (
                <BoardTile
                  key={room.id}
                  board={room}
                  layout={layout}
                  openMenu={boardMenu}
                  onMenu={setBoardMenu}
                  copied={copiedBoard === room.id}
                  onCopyLink={copyBoardLink}
                  onRemove={(board) => removeRoom(board)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </>
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

        {/*
          The rail navigates and nothing else.

          It used to carry the accent-filled `+` as well, which put two orange
          things in one viewport — the button and the mark against the current
          destination — and the One Front Door Rule says a screen gets exactly
          one accent-filled control. When two things are the accent, neither is
          primary and the colour has become theming.

          The front door moved to the stage header, beside the grid it fills,
          where a "New board" button is both a wider target and a named one.
          That leaves this column as what its own heading already claimed it
          was: the page's *edge*. Brand, two destinations, and you.
        */}

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

        {/* Identity and the session, and nothing else.
            Opening a link and restoring a backup lived here for a while and
            have moved to the `+`. They are about a *board*, and an avatar
            means "things about me" — filing them under a heading that
            describes a person is why they were never found. */}
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
              {/*
                The board *list*, not a board.

                A backup of a board is about a board, and lives with the other
                ways into one. This is the index — every address this browser
                holds — and it is the thing the line above it already calls
                "Kept on this device". It is also the only safeguard here that
                survives clearing site data or moving to another machine, which
                is what makes it worth a permanent place rather than a note in
                the shelf.
              */}
              <button
                type="button"
                className="ctx-menu-item"
                role="menuitem"
                onClick={() => { setMeOpen(false); saveLibrary(); }}
              >
                <Download size={15} /> Save board list
              </button>
              <button
                type="button"
                className="ctx-menu-item"
                role="menuitem"
                onClick={() => { setMeOpen(false); restoreInputRef.current?.click(); }}
              >
                <UploadCloud size={15} /> Load a board list
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

      {/*
        The whole stage restores a backup, not just a menu item.
        ---------------------------------------------------------------------
        "I have a file and I want it open" is a gesture before it is a command,
        and every other place a file goes in this product takes a drop. Routing
        it through the same `handleRestoreFile` the picker uses means the two
        cannot validate differently — the file is parsed and *refused here*
        before anything navigates, so a bad drop leaves you on this page with a
        message rather than in a new empty room.
      */}
      <main
        className="lstage"
        ref={stageRef}
        onDragEnter={(e) => {
          if (!dragHasFile(e.dataTransfer)) return;
          dragDepth.current += 1;
          setDropping(true);
        }}
        onDragOver={(e) => {
          if (!dragHasFile(e.dataTransfer)) return;
          // Without this the browser navigates to the file, which unloads the
          // app — the default action for a drop that nobody claimed.
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDropping(false);
        }}
        onDrop={(e) => {
          if (!dragHasFile(e.dataTransfer)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDropping(false);
          const file = e.dataTransfer.files[0];
          if (file) handleRestoreFile(file);
        }}
      >
        {dropping && (
          <div className="lstage__drop" aria-hidden="true">
            <div className="lstage__drop-card">
              <UploadCloud size={22} aria-hidden="true" />
              <span className="lstage__drop-title">Drop to restore</span>
              <span className="lstage__drop-sub">A board backup opens as a new board</span>
            </div>
          </div>
        )}
        <div className="lstage__inner">
          {restoreError && <div className="stage__error" role="alert">{restoreError}</div>}

          {joinOpen && (
            // Inline rather than a dialog: pasting a link needs neither
            // interruption nor protected focus.
            <form className="lstage__join" onSubmit={handleJoin}>
              <Link2 size={16} aria-hidden="true" />
              <input
                ref={joinRef}
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

          {/*
            No header at all on an empty library.

            It used to render regardless, so the first screen carried "Your
            boards" at 30px over a lede explaining where boards collect, above
            an empty state that then said the same thing again in its own
            heading — the page titled a collection that did not exist, and said
            it twice. With nothing to search, sort or lay out, the whole band is
            three controls acting on nothing plus a second copy of the button
            already at the centre of the screen.
          */}
          {(view === 'templates' || hasRooms) && (
          <header className="lstage__head">
            <div className="lstage__titles">
              <h1 className="lstage__title">
                {view === 'boards' ? 'Your boards' : category ? categoryLabel : 'Templates'}
              </h1>
              <p className="lstage__lede">
                {view === 'boards'
                  ? `${recentRooms.length} on this device, kept in your browser rather than in an account.`
                  : category
                    ? `${matchedTemplates.length} board${matchedTemplates.length === 1 ? '' : 's'}, each one editable the moment it opens.`
                    : 'Working boards, already filled in. Open one and change anything in it.'}
              </p>
            </div>

            {/*
              The controls for what is under them, in one row.

              Search was behind a magnifier on the rail, and order and layout
              were not offered at all — so a library of thirty boards had one
              order, no way to say otherwise, and a filter you had to know was
              there. All three live here now, beside the grid they act on, in
              the order they are reached for: find one, then change how they
              are arranged. `/` still puts the caret in the field.
            */}
            <div className="lstage__tools">
              <label className="lstage__search">
                <Search size={15} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={view === 'boards' ? 'Search your boards' : 'Search templates'}
                  aria-label="Search boards and templates"
                />
                {query ? (
                  <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label="Clear search">
                    <X size={14} />
                  </button>
                ) : (
                  <kbd aria-hidden="true">/</kbd>
                )}
              </label>

              {view === 'boards' && hasRooms && (
                <>
                  <div className="lstage__sort" ref={sortRef}>
                    <button
                      type="button"
                      className="lbtn"
                      aria-haspopup="menu"
                      aria-expanded={sortOpen}
                      onClick={() => { setSortOpen((o) => !o); setBoardMenu(null); }}
                    >
                      {BOARD_SORTS.find((s) => s.id === sort)?.label}
                      <ChevronDown size={13} aria-hidden="true" />
                    </button>
                    {sortOpen && (
                      <div className="lrail__menu ctx-popover" role="menu">
                        {BOARD_SORTS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className="ctx-menu-item"
                            role="menuitemradio"
                            aria-checked={sort === option.id}
                            onClick={() => { setSort(option.id); setSortOpen(false); }}
                          >
                            {sort === option.id ? <Check size={15} /> : <span className="ctx-menu-item__gap" />}
                            {option.label}
                            <span className="ctx-menu-item__hint">{option.hint}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Two layouts, one control. Pressed says which you are in. */}
                  <div className="lstage__layout" role="group" aria-label="How boards are shown">
                    <button
                      type="button"
                      className="lbtn lbtn--icon"
                      aria-pressed={layout === 'grid'}
                      onClick={() => setLayout('grid')}
                      data-tooltip="Grid"
                      aria-label="Show boards as a grid"
                    >
                      <LayoutGrid size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="lbtn lbtn--icon"
                      aria-pressed={layout === 'list'}
                      onClick={() => setLayout('list')}
                      data-tooltip="List"
                      aria-label="Show boards as a list"
                    >
                      <Rows3 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}

              {/*
                The page's one front door, at the end of the row.

                ## Why it is here and not on the rail

                It was a 38px accent square at the top of the rail, which made
                the most common action on the page an unlabelled icon in the
                furniture, and put the accent on the rail twice over — see the
                note there. Here it is named, it is the widest target in the
                header, and it sits at the end of the controls in the order
                they are reached for: find what exists, arrange it, or make a
                new one.

                ## Still a split control, for the same reason as before

                A plain click opens a blank board with no menu in the way. The
                caret is a separate target for the two openings that have no
                home of their own — a file you already have, and a link
                somebody sent. Templates is not in the list: it is a permanent
                destination on the rail, and a menu that repeats what sits one
                click away teaches people it is a grab-bag.
              */}
              <div className="lstage__new" ref={newRef}>
                <button
                  type="button"
                  className="lstage__new-go"
                  onClick={openBoard}
                  onContextMenu={(e) => { e.preventDefault(); setNewOpen((o) => !o); }}
                >
                  <Plus size={16} aria-hidden="true" />
                  <span className="lstage__new-label">New board</span>
                </button>

                <button
                  type="button"
                  className="lstage__new-more"
                  onClick={() => { setMeOpen(false); setNewOpen((o) => !o); }}
                  aria-haspopup="menu"
                  aria-expanded={newOpen}
                  aria-label="More ways to start a board"
                >
                  <ChevronDown size={13} aria-hidden="true" />
                </button>

                {newOpen && (
                  <div className="lrail__menu lstage__new-menu ctx-popover" role="menu">
                    <button
                      type="button"
                      className="ctx-menu-item"
                      role="menuitem"
                      onClick={() => { setNewOpen(false); restoreInputRef.current?.click(); }}
                    >
                      <UploadCloud size={15} /> From a backup file
                    </button>
                    <button
                      type="button"
                      className="ctx-menu-item"
                      role="menuitem"
                      onClick={() => { setNewOpen(false); setView('boards'); openJoin(); }}
                    >
                      <Link2 size={15} /> Open a link
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          )}

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
                    this device simply stopped keeping the address. Copy a link to take
                    it with you, or save your whole board list from the account menu.
                  </p>
                  <ul className="shelf__list">
                    {removedRooms.map((room) => (
                      <li key={room.id} className="shelf__row">
                        <span className="shelf__name">{room.name}</span>
                        <span className="shelf__when">Removed {whenOpened(room.removedAt)}</span>
                        {/*
                          Three things a person wants from a row here, in the
                          order they are worth offering: put it back, take the
                          address away with them, or let it go.

                          Forget is last and quiet — a text button rather than
                          a filled one — because it is the only step on this
                          page that cannot be undone. It asks before it acts,
                          which removal itself does not: removal is
                          recoverable, and that asymmetry is exactly what makes
                          one a single click on a card and the other a
                          confirmation.
                        */}
                        <button
                          type="button"
                          className="shelf__act"
                          onClick={() => copyAddress(room)}
                          data-tooltip="Copy this board's link"
                        >
                          <Link2 size={14} aria-hidden="true" /> Copy link
                        </button>
                        <button type="button" className="shelf__put" onClick={() => putBack(room.id)}>
                          <Undo2 size={14} aria-hidden="true" /> Put back
                        </button>
                        <button
                          type="button"
                          className="shelf__act shelf__act--let-go"
                          onClick={() => forgetRemoved(room)}
                          data-tooltip="Drop this address for good"
                        >
                          <Trash2 size={14} aria-hidden="true" /> Forget
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {/*
            The way into the gallery, at the end of the boards.

            A library of six boards leaves most of a 1440px screen empty, and
            what filled it before was nothing — the page simply stopped. Four
            real templates, drawn by the same component as everything else on
            this page, are both the answer to "what else is here" and a better
            use of the space than air. They appear only when there are boards
            and nothing is being searched: on an empty library the openings
            above already lead here, and during a search this is noise.
          */}
          {view === 'boards' && hasRooms && !query.trim() && (
            <section className="lseam">
              <header className="lseam__head">
                <h2 className="lseam__title">Start from a template</h2>
                <button type="button" className="lbtn" onClick={() => goTemplates(null)}>
                  All {TEMPLATES.length}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </header>
              <div className="tgrid tgrid--seam">{suggestedTemplates.map(templateCard)}</div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
