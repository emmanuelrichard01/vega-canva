import { armCover, goToBoard, isLeaving } from './components/home/boardNavigation';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { nanoid } from 'nanoid';
import {
  AlertTriangle, ChevronDown, ChevronRight, Command, Compass, Copy, CopyPlus, Download, ExternalLink, LayoutGrid,
  Layers, Link2, LogOut, Pencil, Pin, PinOff, Plus, Rows3, Search, Sparkles, SunMoon, Trash2, Undo2, UploadCloud, X,
} from 'lucide-react';
import { parseDocumentExport } from './engine/export/DocumentImport';
import { looksLikeLibrary, mergeLibrary, parseLibrary, serializeLibrary } from './engine/room/libraryIndex';
import { looksLikeRoomCode, roomIdFromCode } from './engine/room/roomCode';
import { notices$ } from './engine/ui/notices';
import { hasPendingRestore, stashPendingRestore, stashPendingTemplate, takePendingRestore, takePendingTemplate } from './engine/export/pendingRestore';
import { CATEGORIES, FIRST_BOARD, TEMPLATES, templateById, type Template, type TemplateCategory } from './engine/templates/templates';
import { loadPreview } from './engine/model/boardPreview';
import { slugify } from './engine/export/filenames';
import { BoardTile, type BoardLayout } from './components/home/BoardTile';
import { QuickStart } from './components/home/QuickStart';
import { TemplateCard } from './components/home/TemplateCard';
import { TemplateGallery } from './components/home/TemplateGallery';
import { TemplatePeek } from './components/home/TemplatePeek';
import { searchTemplates } from './components/home/templateSearch';
import { showcaseOf } from './components/home/templateFacts';
import { useBoardStatus } from './components/home/useBoardStatus';
import { useGridColumns } from './components/home/useGridColumns';
import { useRovingGrid } from './components/home/useRovingGrid';
import {
  LIBRARY_KEYS, REMOVED_LIMIT, canEditBoard, cleanBoardName, displayName, focusAfterRemoval, insertAt, inviteExpired, libraryGroups,
  mutateNames, mutatePins, mutateRecents, mutateRemoved, readNames, readPins, readRecents, readRemoved, reconcileName, togglePin,
  upsertRecent, type LibraryBoard, type NameMap, type PinMap, type RemovedBoard,
} from './components/home/library';
import { BOARD_SORTS, whenOpened, type BoardSort, type ShelfBoard } from './engine/room/boardShelf';
import { Menu, type MenuAnchor } from './components/menu/Menu';
import type { MenuEntry } from './components/menu/menuModel';
import { AuthModal } from './components/AuthModal';
import { Logo } from './components/ui/Logo';
import { Avatar } from './components/ui/Avatar';
import { storageGet, storageSet } from './utils/safeStorage';
import './components/home/home.css';

const HomePalette = lazy(() => import('./components/home/HomePalette').then((m) => ({ default: m.HomePalette })));
const AppearancePanel = lazy(() => import('./components/home/AppearancePanel').then((m) => ({ default: m.AppearancePanel })));
const loadRemote = () => import('./components/home/remoteBoard');

const VIEW_KEY = 'vega_home_view';
const LAYOUT_KEY = 'vega_home_layout';
const SORT_KEY = 'vega_home_sort';

type View = 'boards' | 'templates';

type OpenMenu =
  | { kind: 'board'; board: ShelfBoard; anchor: MenuAnchor; focusFirst: boolean }
  | { kind: 'sort' | 'new' | 'me'; anchor: MenuAnchor; focusFirst: boolean };

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

/** Read from storage, not state, so the first render already shows the right view. */
function initialView(): View {
  const asked = new URLSearchParams(window.location.search).get('view');
  if (asked === 'boards' || asked === 'templates') return asked;
  return storageGet(VIEW_KEY) === 'templates' ? 'templates' : 'boards';
}

const isTyping = (el: Element | null) =>
  !!el && (el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable);

const anchorOf = (el: Element | null, prefer: 'below' | 'above' = 'below', align: 'start' | 'end' = 'end'): MenuAnchor =>
  ({ kind: 'rect', rect: (el ?? document.body).getBoundingClientRect(), prefer, align });

/**
 * The library — everything before the canvas.
 *
 * A rail and a stage. The rail navigates between your boards and the template
 * gallery; the stage shows one of them at a time, with its own controls in its
 * header. One accent button makes a board. Every action on the page is
 * reachable from the keyboard: arrows move through the cards, ⌘K finds
 * anything, N starts a board, / searches.
 *
 * The board list, its shelf, pins and pending names are shared with every
 * other tab of this site, so each change is a read-merge-write against
 * storage, and changes from other tabs arrive through `storage` events.
 */
export const Home: React.FC = () => {
  const { user, logout } = useAuth();

  // Every hook lives above the early return for signed-out visitors.
  const [view, setView] = useState<View>(initialView);
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<BoardLayout>(() => (storageGet(LAYOUT_KEY) === 'list' ? 'list' : 'grid'));
  const [sort, setSort] = useState<BoardSort>(() => (storageGet(SORT_KEY) === 'name' ? 'name' : 'recent'));
  const [recentRooms, setRecentRooms] = useState<LibraryBoard[]>(readRecents);
  const [removedRooms, setRemovedRooms] = useState<RemovedBoard[]>(readRemoved);
  const [pins, setPins] = useState<PinMap>(readPins);
  const [names, setNames] = useState<NameMap>(readNames);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const [joinLink, setJoinLink] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const joinRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const newMoreRef = useRef<HTMLButtonElement>(null);
  const meRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  /** dragenter/leave fire for every child crossed, so they are counted. */
  const dragDepth = useRef(0);
  /** Renames already retried this visit, so a failing one is not hammered. */
  const retried = useRef(new Set<string>());

  useEffect(() => { storageSet(VIEW_KEY, view); }, [view]);
  useEffect(() => { storageSet(LAYOUT_KEY, layout); }, [layout]);
  useEffect(() => { storageSet(SORT_KEY, sort); }, [sort]);
  // Switching views starts a new screen, so it starts at the top of one.
  useEffect(() => { stageRef.current?.scrollTo({ top: 0 }); }, [view]);

  /** Another tab, or a board in this one, changed the library. */
  useEffect(() => {
    const reload = () => {
      setRecentRooms(readRecents());
      setRemovedRooms(readRemoved());
      setPins(readPins());
      setNames(readNames());
    };
    const onStorage = (e: StorageEvent) => { if (e.key === null || LIBRARY_KEYS.has(e.key)) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', reload);
    };
  }, []);

  const status = useBoardStatus(useMemo(() => recentRooms.map((r) => r.id), [recentRooms]));
  const statusOf = (id: string) => status.boards.get(id);
  const entryOf = useCallback((id: string) => recentRooms.find((r) => r.id === id), [recentRooms]);

  /**
   * The server's name for a board wins over the one this device remembers —
   * somebody may have renamed it since — except for a name typed here, which
   * is shown until the server reports the board under it, or under a name
   * somebody else gave it afterwards.
   */
  useEffect(() => {
    if (status.boards.size === 0) return;
    const settled: string[] = [];
    const renamed = new Map<string, string>();
    for (const room of recentRooms) {
      const title = status.boards.get(room.id)?.title;
      if (!title) continue;
      const pending = names[room.id];
      const outcome = pending ? reconcileName(pending, title) : null;
      if (outcome === 'settled' || outcome === 'superseded') settled.push(room.id);
      if ((outcome === null || outcome === 'superseded') && title !== room.name) renamed.set(room.id, title);
    }
    if (settled.length) {
      setNames(mutateNames((current) => {
        const next = { ...current };
        for (const id of settled) delete next[id];
        return next;
      }));
    }
    if (renamed.size) {
      setRecentRooms(mutateRecents((list) => list.map((r) => (renamed.has(r.id) ? { ...r, name: renamed.get(r.id)! } : r))));
    }
  }, [status, names, recentRooms]);

  /** A name typed while the board could not be reached goes out once it can. */
  useEffect(() => {
    for (const [id, pending] of Object.entries(names)) {
      if (pending.sent || retried.current.has(id) || !status.boards.get(id)?.exists) continue;
      retried.current.add(id);
      const entry = entryOf(id);
      void loadRemote()
        .then((m) => m.renameRemote(id, pending.name, { invite: entry?.invite }))
        .then((result) => {
          if (result === 'renamed') {
            setNames(mutateNames((n) => (n[id]?.name === pending.name ? { ...n, [id]: { ...n[id], sent: true } } : n)));
          } else if (result === 'refused') {
            setNames(mutateNames((n) => {
              const { [id]: _drop, ...rest } = n;
              return rest;
            }));
          }
        })
        .catch(() => {});
    }
  }, [names, status, entryOf]);

  // --------------------------------------------------------------- derived
  /** Ranked by where the words land when there is a query; catalogue order when not. */
  const matchedTemplates = useMemo(() => searchTemplates(TEMPLATES, query, category), [category, query]);

  /** The showcase leads the gallery, unless a filter has said what is wanted. */
  const showFeatured = !category && !query.trim();
  const showcase = useMemo(() => showcaseOf(TEMPLATES), []);
  const featured = useMemo(() => (showFeatured ? showcase : []), [showFeatured, showcase]);
  const rest = useMemo(
    () => (showFeatured ? matchedTemplates.filter((t) => !showcase.includes(t)) : matchedTemplates),
    [showFeatured, matchedTemplates, showcase]
  );

  /**
   * The first board offered first, then the showcase, then the rest of the
   * catalogue. The seam shows exactly one row of them, however many tracks that is.
   */
  const templatePool = useMemo(() => {
    const first = FIRST_BOARD ? templateById(FIRST_BOARD) : undefined;
    const lead = [...(first ? [first] : []), ...showcaseOf(TEMPLATES, 8)];
    const pool = [...new Set([...lead, ...TEMPLATES])];
    return pool.slice(0, 8);
  }, []);
  const [seamGrid, setSeamGrid] = useState<HTMLDivElement | null>(null);
  const seamColumns = useGridColumns(seamGrid, 5);
  const suggestedTemplates = useMemo(() => templatePool.slice(0, Math.max(1, seamColumns)), [templatePool, seamColumns]);
  const starters = useMemo(() => templatePool.slice(0, 3), [templatePool]);
  /** Browsing every category, each one is a single row; its button shows the rest. */
  const [shelfGrid, setShelfGrid] = useState<HTMLDivElement | null>(null);
  const shelfColumns = useGridColumns(shelfGrid, 5);

  const hasRooms = recentRooms.length > 0;

  /** The templates on screen, in the order they appear — what the peek steps through. */
  const visibleTemplates = useMemo<Template[]>(() => {
    if (view === 'templates') {
      if (!showFeatured) return rest;
      return [...featured, ...CATEGORIES.flatMap((c) => rest.filter((t) => t.category === c.id).slice(0, shelfColumns))];
    }
    if (!hasRooms) return starters;
    return query.trim() ? [] : suggestedTemplates;
  }, [view, showFeatured, rest, featured, shelfColumns, hasRooms, starters, query, suggestedTemplates]);

  const boardGroups = useMemo(
    () => libraryGroups(recentRooms, { pins, names, sort, query }),
    [recentRooms, pins, names, sort, query]
  );

  const peekTemplate = peekId ? TEMPLATES.find((t) => t.id === peekId) ?? null : null;
  const peekIndex = peekTemplate ? visibleTemplates.findIndex((t) => t.id === peekTemplate.id) : -1;
  // The peek belongs to the templates on screen; switching views or filtering one away closes it.
  const peeking = peekTemplate && peekIndex >= 0 ? peekTemplate : null;

  const roving = useRovingGrid(`${view}|${layout}|${sort}|${query}|${category}|${recentRooms.length}|${Object.keys(pins).length}|${renaming}`);

  // --------------------------------------------------------------- actions
  const openBoard = useCallback(() => goToBoard(`/room/${nanoid(10)}?new=1`), []);

  const openTemplate = useCallback((template: Template) => {
    if (isLeaving()) return;
    stashPendingTemplate(template.id);
    const id = CSS.escape(template.id);
    const cover = peekId === template.id
      ? document.querySelector<HTMLElement>('.tpeek__art')
      : document.querySelector<HTMLElement>(`.gcard[data-template="${id}"] .gcard__art`)
        ?? document.querySelector<HTMLElement>(`.gshow__stage[data-template="${id}"]`);
    goToBoard(`/room/${nanoid(10)}`, cover);
  }, [peekId]);

  /** A tab opened from this one inherits its session storage, so the stash goes with it. */
  const openTemplateInNewTab = useCallback((template: Template) => {
    stashPendingTemplate(template.id);
    const tab = window.open(`/room/${nanoid(10)}`, '_blank');
    if (tab) tab.opener = null;
    takePendingTemplate();
  }, []);

  const openJoin = useCallback((prefill = '') => {
    setJoinError(null);
    setJoinOpen(true);
    if (prefill) setJoinLink(prefill);
    window.setTimeout(() => joinRef.current?.focus(), 0);
  }, []);

  const goTemplates = useCallback((c: TemplateCategory | null) => {
    setView('templates');
    setCategory(c);
  }, []);

  const peek = useCallback((template: Template) => {
    setPeekId((current) => (current === template.id ? null : template.id));
  }, []);

  const stepPeek = (direction: -1 | 1) => {
    if (peekIndex < 0 || visibleTemplates.length === 0) return;
    const next = visibleTemplates[(peekIndex + direction + visibleTemplates.length) % visibleTemplates.length];
    setPeekId(next.id);
    stageRef.current?.querySelector<HTMLElement>(`[data-template="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const closePeek = useCallback(() => {
    const id = peekId;
    setPeekId(null);
    if (id) stageRef.current?.querySelector<HTMLElement>(`[data-template="${id}"]`)?.focus({ preventScroll: true });
  }, [peekId]);

  const focusCard = (id: string | null) => {
    window.setTimeout(() => {
      const el = id ? stageRef.current?.querySelector<HTMLElement>(`[data-roving="${CSS.escape(id)}"]`) : null;
      (el ?? searchRef.current)?.focus();
    }, 0);
  };

  const copyAddress = async (room: ShelfBoard) => {
    const url = `${window.location.origin}/room/${room.id}`;
    try {
      await navigator.clipboard.writeText(url);
      notices$.notify({ message: `Copied the link to “${room.name}”.`, tone: 'success' });
    } catch {
      // A denied clipboard is a permission decision, so offer the address instead.
      notices$.notify({ message: url, tone: 'info', duration: 20000 });
    }
  };

  /** Put a removed board back, at `index` in the list when it is still known. */
  const putBack = (id: string, index?: number) => {
    let entry: RemovedBoard | undefined;
    setRemovedRooms(mutateRemoved((list) => {
      entry = list.find((r) => r.id === id);
      return list.filter((r) => r.id !== id);
    }));
    if (!entry) return;
    const { removedAt: _removedAt, ...room } = entry;
    setRecentRooms(mutateRecents((list) => insertAt(list, room, index ?? list.length)));
  };

  /**
   * Remove recoverably, with an undo on the notice. Focus moves to the card
   * that takes this one's place, so the keyboard carries on.
   */
  const removeRoom = (board: ShelfBoard) => {
    const cells = Array.from(stageRef.current?.querySelectorAll<HTMLElement>('.lgroup [data-roving]') ?? []);
    const at = cells.findIndex((el) => el.dataset.roving === board.id);
    const after = focusAfterRemoval(at, cells.length);
    const nextId = after >= 0 ? cells.filter((el) => el.dataset.roving !== board.id)[after]?.dataset.roving ?? null : null;

    let index = -1;
    let entry: LibraryBoard | undefined;
    const next = mutateRecents((list) => {
      index = list.findIndex((r) => r.id === board.id);
      entry = list[index];
      return list.filter((r) => r.id !== board.id);
    });
    if (!entry) return;
    setRecentRooms(next);
    const before = readRemoved().length;
    const removed = mutateRemoved((list) => [{ ...entry!, removedAt: Date.now() }, ...list.filter((r) => r.id !== board.id)]);
    setRemovedRooms(removed);
    if (before + 1 > REMOVED_LIMIT) {
      notices$.notify({
        message: `The removed list is full at ${REMOVED_LIMIT}, so the oldest entry has been dropped. Save your board list to keep a copy.`,
        tone: 'warning',
        duration: 14000,
      });
    }
    notices$.notify({
      message: `Removed “${board.name}” from this device. The board itself is untouched.`,
      tone: 'info',
      duration: 12000,
      action: { label: 'Undo', run: () => putBack(board.id, index) },
    });
    focusCard(nextId);
  };

  /** The one step here that cannot be undone, so it asks — inline, in the row. */
  const forgetRemoved = (room: RemovedBoard) => {
    setRemovedRooms(mutateRemoved((list) => list.filter((r) => r.id !== room.id)));
    setConfirmForget(null);
    notices$.notify({ message: `Forgot “${room.name}”.`, tone: 'info' });
  };

  useEffect(() => {
    if (confirmForget) keepRef.current?.focus();
  }, [confirmForget]);

  const togglePinned = (board: ShelfBoard) => {
    const next = mutatePins((current) => togglePin(current, board.id));
    setPins(next);
    notices$.notify({ message: next[board.id] ? `Pinned “${board.name}”.` : `Unpinned “${board.name}”.`, tone: 'success' });
  };

  /**
   * Why this device cannot rename a board from here, or `null` when it can.
   * A view or comment link hides Rename altogether (`canEditBoard`); these
   * are the cases where the control is shown but cannot work right now.
   */
  const renameBlock = (board: ShelfBoard): string | null => {
    const entry = entryOf(board.id);
    if (entry?.invite && inviteExpired(entry)) return 'The invite this device has for this board has expired. Open the board from a current invite to rename it.';
    if (status.restricted && !entry?.invite) return 'This server only takes changes through an invite link, and this device has none for this board.';
    return null;
  };

  /** Why the server turned a rename down, as far as this device can tell. */
  const refusalReason = (board: ShelfBoard, previous: string): string => {
    const entry = entryOf(board.id);
    if (entry?.invite && inviteExpired(entry)) return `“${previous}” kept its name: the invite this device has for it has expired.`;
    if (status.restricted && !entry?.invite) return `“${previous}” kept its name: this server only takes changes through an invite link, and this device has none for it.`;
    if (entry?.invite) return `“${previous}” kept its name: the server did not accept a change through the invite this device has for it.`;
    return `“${previous}” kept its name: the server did not accept the change from this device.`;
  };

  const canRenameHere = (board: ShelfBoard) => {
    const entry = entryOf(board.id);
    return (!entry || canEditBoard(entry)) && renameBlock(board) === null;
  };

  const commitRename = (board: ShelfBoard, typed: string | null) => {
    setRenaming(null);
    focusCard(board.id);
    if (typed === null) return;
    const name = cleanBoardName(typed);
    const previous = entryOf(board.id)?.name ?? board.name;
    if (!name || name === displayName(board, names)) return;

    const was = statusOf(board.id)?.title ?? previous;
    setRecentRooms(mutateRecents((list) => list.map((r) => (r.id === board.id ? { ...r, name } : r))));
    setNames(mutateNames((n) => ({ ...n, [board.id]: { name, sent: false, was } })));
    retried.current.add(board.id);
    const invite = entryOf(board.id)?.invite;
    void loadRemote()
      .then((m) => m.renameRemote(board.id, name, { invite }))
      .then((result) => {
        if (result === 'renamed') {
          setNames(mutateNames((n) => (n[board.id]?.name === name ? { ...n, [board.id]: { ...n[board.id], sent: true } } : n)));
          return;
        }
        if (result === 'refused') {
          setNames(mutateNames((n) => {
            const { [board.id]: _drop, ...restNames } = n;
            return restNames;
          }));
          setRecentRooms(mutateRecents((list) => list.map((r) => (r.id === board.id ? { ...r, name: previous } : r))));
          notices$.notify({ message: refusalReason(board, previous), tone: 'error' });
          return;
        }
        notices$.notify({
          message: `Renamed on this device. “${name}” reaches the board the next time it can be reached from here.`,
          tone: 'info',
        });
      })
      .catch(() => {});
  };

  /** Why a board cannot be copied or backed up from here, or `null` when it can. */
  const copyBlock = (board: ShelfBoard): string | null => {
    if (status.restricted) return 'This server needs an invite link for every board, so boards cannot be copied from here.';
    if (loadPreview(board.id) === null && statusOf(board.id)?.exists !== true) return 'Open it once on this device, or connect, to copy it.';
    return null;
  };

  const duplicateBoard = async (board: ShelfBoard) => {
    const name = displayName(board, names);
    const invite = entryOf(board.id)?.invite;
    notices$.notify({ message: `Reading “${name}”…`, tone: 'info', duration: 3000 });
    const remote = await loadRemote();
    const plan = await remote.planDuplicate(board.id, { invite }).catch(() => null);
    if (!plan) {
      notices$.notify({ message: `Could not reach “${name}”, and this device holds no copy of what is on it. Try again when you are online.`, tone: 'error' });
      return;
    }
    if (plan.objectCount === 0) {
      notices$.notify({
        message: statusOf(board.id)?.exists === false
          ? `“${name}” is no longer on the server, so there is nothing to copy.`
          : plan.fromServer
            ? `“${name}” is empty, so a copy would be a blank board. Use New board instead.`
            : `Could not reach “${name}”, and this device’s copy of it is empty. Try again when you are online.`,
        tone: 'info',
      });
      return;
    }

    const copyName = `Copy of ${name}`;
    const go = async () => {
      const newId = nanoid(10);
      try {
        const where = await remote.writeDuplicate(newId, plan, copyName);
        setRecentRooms(mutateRecents((list) => upsertRecent(list, { id: newId, name: copyName, lastAccessed: Date.now() })));
        if (where === 'device') {
          notices$.notify({ message: `“${copyName}” is saved on this device and reaches the server when it can.`, tone: 'info' });
        }
        // A backup or template still waiting in this tab would be poured
        // into the copy when it opens, replacing what was just copied.
        if (hasPendingRestore()) takePendingRestore();
        takePendingTemplate();
        goToBoard(`/room/${newId}`);
      } catch (err) {
        const reason = (err as { name?: string })?.name;
        notices$.notify({
          message: reason === 'QuotaExceededError'
            ? `Could not save “${copyName}”: this browser is out of storage space. Free some space, or remove boards you no longer need from this device, and try again.`
            : reason === 'NotStoredError'
              ? `Could not save “${copyName}”: the server could not be reached and this browser did not keep the copy. Check that this site may store data, then try again.`
              : `Could not save “${copyName}”. Try again, or download a backup of “${name}” and restore it instead.`,
          tone: 'error',
          duration: null,
        });
      }
    };

    const cautions: string[] = [];
    if (!plan.fromServer) {
      cautions.push('the server could not be reached, so this copies only what this device last saw of it');
    }
    if (plan.mediaCount > 0) {
      cautions.push(
        `its ${plan.mediaCount === 1 ? 'image or audio file still loads' : `${plan.mediaCount} image and audio files still load`} from the original, ` +
        'so they stop working if the original is deleted'
      );
    }
    if (cautions.length === 0) { await go(); return; }
    notices$.notify({
      message: `Before you copy “${name}”: ${cautions.join(', and ')}.`,
      tone: 'warning',
      duration: null,
      action: { label: 'Copy anyway', run: () => void go() },
    });
  };

  const downloadBackup = async (board: ShelfBoard) => {
    const name = displayName(board, names);
    const invite = entryOf(board.id)?.invite;
    try {
      const snapshot = await (await loadRemote()).snapshotBoard(board.id, { title: name, access: { invite } });
      if (!snapshot) {
        notices$.notify({ message: `“${name}” has nothing on it to back up.`, tone: 'info' });
        return;
      }
      const url = URL.createObjectURL(new Blob([snapshot.text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugify(name) || 'board'}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      notices$.notify({
        message: `Saved a backup of “${name}” with ${snapshot.objectCount.toLocaleString()} objects${snapshot.fromServer ? '' : ', from this device’s copy'}.`,
        tone: 'success',
      });
    } catch {
      notices$.notify({ message: `Could not reach “${name}” to back it up. Try again when you are online.`, tone: 'error' });
    }
  };

  /** Save every address on this device as a file — the one safeguard that survives clearing site data. */
  const saveLibrary = () => {
    const text = serializeLibrary(readRecents(), readRemoved());
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vega-board-list-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notices$.notify({
      message: `Saved ${recentRooms.length + removedRooms.length} board addresses. Keep it somewhere this browser cannot reach.`,
      tone: 'success',
    });
  };

  /** Fold a saved list in. A union, never a replacement. */
  const loadLibrary = (text: string) => {
    const parsed = parseLibrary(text);
    if (!parsed.ok) { setRestoreError(parsed.error); return; }
    let added = 0;
    const boards = mutateRecents((list) => {
      const merged = mergeLibrary(list, parsed.file.boards);
      added = merged.added;
      return merged.boards;
    });
    setRecentRooms(boards);
    const live = new Set(boards.map((b) => b.id));
    setRemovedRooms(mutateRemoved((list) => {
      const shelf = new Map(list.map((r) => [r.id, r]));
      for (const r of parsed.file.removed) if (!shelf.has(r.id)) shelf.set(r.id, r);
      return [...shelf.values()].filter((r) => !live.has(r.id)).sort((a, b) => b.removedAt - a.removedAt);
    }));
    setView('boards');
    notices$.notify({
      message: added === 0
        ? 'That list held nothing this device did not already have.'
        : `Added ${added} board${added === 1 ? '' : 's'} from that list. Nothing was removed.`,
      tone: 'success',
    });
  };

  /** One picker and one drop target for both kinds of file, validated before anything navigates. */
  const handleRestoreFile = async (file: File) => {
    setRestoreError(null);
    const text = await file.text();
    if (looksLikeLibrary(text)) { loadLibrary(text); return; }
    const result = parseDocumentExport(text);
    if (!result.ok) { setRestoreError(result.error); return; }
    // Stored compactly: the stash shares this tab's session storage quota.
    let compact = text;
    try { compact = JSON.stringify(JSON.parse(text)); } catch { /* parsed above, so unreachable */ }
    takePendingRestore(); // so a stale one cannot pass for this one below
    stashPendingRestore(compact);
    if (!hasPendingRestore()) {
      setRestoreError('This backup is too large to hand to a new board from here. Start a new board and restore it from the board’s Export panel instead.');
      return;
    }
    goToBoard(`/room/${nanoid(10)}`);
  };

  const dragHasFile = (dt: DataTransfer | null) => !!dt && Array.from(dt.items).some((i) => i.kind === 'file');

  /**
   * A link or a code. A code carries a check symbol, so a mistyped one is
   * refused rather than opening an empty board that looks like lost work.
   */
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const trimmed = joinLink.trim();
    if (!trimmed) return;

    if (trimmed.includes('/room/')) {
      const roomId = (trimmed.split('/room/')[1] || '').split(/[/?#]/)[0].trim();
      if (!roomId) { setJoinError('That link has no board in it. Copy the whole thing, up to and past /room/.'); return; }
      goToBoard(`/room/${roomId}`);
      return;
    }
    if (looksLikeRoomCode(trimmed)) {
      const roomId = roomIdFromCode(trimmed);
      if (!roomId) { setJoinError('That code is not quite right. Check it against the one you were sent.'); return; }
      goToBoard(`/room/${roomId}`);
      return;
    }
    const roomId = trimmed.split(/[/?#]/)[0].trim();
    if (roomId) goToBoard(`/room/${roomId}`);
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(document.activeElement);
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenu(null);
        setPaletteOpen((open) => !open);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing || paletteOpen || menu || renaming) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault();
        openBoard();
      } else if (e.key === 'Escape' && peekId) {
        e.preventDefault();
        closePeek();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, menu, renaming, peekId, openBoard, closePeek]);

  /** A board link pasted anywhere outside a field fills the join box. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      const text = (e.clipboardData?.getData('text') || '').trim();
      if (!text || text.length > 400) return;
      if (!text.includes('/room/') && !looksLikeRoomCode(text)) return;
      e.preventDefault();
      setView('boards');
      openJoin(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openJoin]);

  /** Arrowing through templates while the peek is open moves the peek with you. */
  const onStageFocus = (e: React.FocusEvent) => {
    roving.onFocus(e);
    if (!peekId) return;
    // Only keyboard travel moves the peek. A click focuses its target first,
    // and following that focus swapped the peek before the click landed, so
    // Preview on another card toggled the new one shut.
    if (!(e.target as HTMLElement).matches(':focus-visible')) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-template]')?.dataset.template;
    if (id && id !== peekId) setPeekId(id);
  };

  // The same onboarding screen as everywhere else for a visitor with no identity.
  if (!user) return <AuthModal />;

  // ----------------------------------------------------------------- menus
  const boardMenuEntries = (board: ShelfBoard): MenuEntry[] => {
    const missing = statusOf(board.id)?.exists === false;
    const cannotCopy = copyBlock(board);
    const cannotRename = renameBlock(board);
    // A view or comment link can never rename, so the command is not offered.
    const entry = entryOf(board.id);
    const mayRename = !entry || canEditBoard(entry);
    const remove: MenuEntry = {
      kind: 'item', id: 'remove', label: 'Remove from this device', icon: <X size={15} />, shortcut: 'Delete', danger: true,
      detail: 'The board itself is untouched', onSelect: () => removeRoom(board),
    };
    const entries: MenuEntry[] = [
      { kind: 'item', id: 'open-tab', label: 'Open in new tab', icon: <ExternalLink size={15} />, onSelect: () => { window.open(`/room/${board.id}`, '_blank', 'noopener'); } },
      { kind: 'item', id: 'copy-link', label: 'Copy link', icon: <Copy size={15} />, onSelect: () => void copyAddress(board) },
      ...(mayRename
        ? [{ kind: 'item' as const, id: 'rename', label: 'Rename', icon: <Pencil size={15} />, shortcut: 'F2', disabled: Boolean(cannotRename), disabledReason: cannotRename ?? undefined, onSelect: () => setRenaming(board.id) }]
        : []),
      { kind: 'item', id: 'duplicate', label: 'Duplicate', icon: <CopyPlus size={15} />, disabled: Boolean(cannotCopy), disabledReason: cannotCopy ?? undefined, onSelect: () => void duplicateBoard(board) },
      pins[board.id]
        ? { kind: 'item', id: 'pin', label: 'Unpin', icon: <PinOff size={15} />, shortcut: 'P', onSelect: () => togglePinned(board) }
        : { kind: 'item', id: 'pin', label: 'Pin to top', icon: <Pin size={15} />, shortcut: 'P', onSelect: () => togglePinned(board) },
      { kind: 'separator', id: 'sep-1' },
      { kind: 'item', id: 'backup', label: 'Download backup', icon: <Download size={15} />, disabled: Boolean(cannotCopy), disabledReason: cannotCopy ?? undefined, onSelect: () => void downloadBackup(board) },
      { kind: 'separator', id: 'sep-2' },
      remove,
    ];
    // A board the server no longer has leads with the one thing worth doing about it.
    return missing ? [remove, { kind: 'separator', id: 'sep-0' }, ...entries.slice(0, -2)] : entries;
  };

  const menuEntries = (): MenuEntry[] => {
    if (!menu) return [];
    switch (menu.kind) {
      case 'board':
        return boardMenuEntries(menu.board);
      case 'sort':
        return BOARD_SORTS.map((option) => ({
          kind: 'item' as const, id: option.id, label: option.label, detail: option.hint, checked: sort === option.id,
          onSelect: () => setSort(option.id),
        }));
      case 'new':
        return [
          { kind: 'item', id: 'restore', label: 'From a backup file', icon: <UploadCloud size={15} />, onSelect: () => restoreInputRef.current?.click() },
          { kind: 'item', id: 'join', label: 'Open a shared link', icon: <Link2 size={15} />, onSelect: () => { setView('boards'); openJoin(); } },
          { kind: 'item', id: 'templates', label: 'From a template', icon: <Compass size={15} />, onSelect: () => goTemplates(null) },
        ];
      case 'me':
        return [
          { kind: 'heading', id: 'who', label: `${user.name} · ${user.isGuest ? 'Guest session' : 'Kept on this device'}` },
          { kind: 'item', id: 'save', label: 'Save board list', icon: <Download size={15} />, detail: 'Every address on this device, as a file', onSelect: saveLibrary },
          { kind: 'item', id: 'load', label: 'Load a board list', icon: <UploadCloud size={15} />, onSelect: () => restoreInputRef.current?.click() },
          { kind: 'separator', id: 'sep-a' },
          {
            kind: 'submenu', id: 'appearance', label: 'Appearance', icon: <SunMoon size={15} />,
            panel: () => (
              <Suspense fallback={<div className="appearance-panel" aria-busy="true" />}>
                <AppearancePanel />
              </Suspense>
            ),
          },
          { kind: 'separator', id: 'sep' },
          { kind: 'item', id: 'out', label: user.isGuest ? 'End guest session' : 'Sign out', icon: <LogOut size={15} />, onSelect: logout },
        ];
    }
  };

  const categoryLabel = CATEGORIES.find((c) => c.id === category)?.label;
  const pinnedSet = new Set(Object.keys(pins));
  const shownBoards = recentRooms.map((r) => ({ ...r, name: displayName(r, names) }));

  // ----------------------------------------------------------------- pieces
  const templateCard = (template: Template, scope: string) => (
    <TemplateCard
      key={`${scope}-${template.id}`}
      template={template}
      peeking={peekId === template.id}
      scope={scope}
      onPeek={peek}
      onUse={openTemplate}
    />
  );

  const templatesBody = (
    <TemplateGallery
      total={TEMPLATES.length}
      matched={matchedTemplates}
      category={category}
      query={query}
      showcase={featured}
      rest={rest}
      shelfColumns={shelfColumns}
      shelfRef={setShelfGrid}
      peekId={peekId}
      onPeek={peek}
      onUse={openTemplate}
      onCategory={(c) => goTemplates(c)}
      onClearQuery={() => { setQuery(''); searchRef.current?.focus(); }}
    />
  );

  const listHead = layout === 'list' && boardGroups.length > 0 && (
    <div className="blist__head" role="group" aria-label="Sort boards">
      <span className="blist__head-art" aria-hidden="true" />
      <button type="button" className="blist__sort" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>Name</button>
      <span className="blist__head-size">Size</span>
      <button type="button" className="blist__sort blist__sort--when" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>Last opened</button>
      <span className="blist__head-more" aria-hidden="true" />
    </div>
  );

  const boardsBody = !hasRooms ? (
    <QuickStart
      templateCount={TEMPLATES.length}
      starters={starters}
      peekingId={peekId}
      onBlank={openBoard}
      onTemplates={() => goTemplates(null)}
      onPeek={peek}
      onUse={openTemplate}
      onJoin={() => openJoin()}
      onRestore={() => restoreInputRef.current?.click()}
    />
  ) : boardGroups.length === 0 ? (
    <div className="stage__empty">
      <Search size={22} aria-hidden="true" />
      <h3>No boards match “{query.trim()}”</h3>
      <p>Try a different name, or clear the search.</p>
      <button type="button" className="stage__ghost" onClick={() => setQuery('')}>Clear search</button>
    </div>
  ) : (
    <>
      {listHead}
      {boardGroups.map((group) => (
        <section key={group.id} className="lgroup" aria-label={group.label || 'Your boards'}>
          {group.label && (
            <h2 className="lgroup__head">
              {group.id === 'pinned' && <Pin size={13} aria-hidden="true" />}
              {group.label}
              <span className="lgroup__count">{group.boards.length}</span>
            </h2>
          )}
          <div className={layout === 'list' ? 'blist' : 'tgrid tgrid--boards'}>
            {group.boards.map((room) => (
              <BoardTile
                key={room.id}
                board={room}
                layout={layout}
                status={statusOf(room.id)}
                pinned={Boolean(pins[room.id])}
                renaming={renaming === room.id}
                canRename={canRenameHere(room)}
                menuOpen={menu?.kind === 'board' && menu.board.id === room.id}
                onOpenMenu={(board, anchor) => setMenu({ kind: 'board', board, anchor, focusFirst: anchor.kind === 'rect' })}
                onStartRename={(board) => setRenaming(board.id)}
                onRename={commitRename}
                onTogglePin={togglePinned}
                onRemove={removeRoom}
                onOpen={(_board, cover) => armCover(cover)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );

  const modKey = IS_MAC ? '⌘' : 'Ctrl';

  return (
    <div className="lib">
      <nav className="lrail" aria-label="Library">
        <a className="lrail__brand" href="/" aria-label="Vega Studio home">
          <Logo piece="mark" size={24} />
        </a>

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
            {hasRooms && <span className="lrail__dot" aria-hidden="true" />}
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
            <Compass size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lrail__item"
            onClick={() => setPaletteOpen(true)}
            data-tooltip={`Find anything · ${modKey}K`}
            data-tooltip-pos="right"
            aria-label={`Find a board, template or action (${modKey}+K)`}
            aria-haspopup="dialog"
          >
            <Command size={17} aria-hidden="true" />
          </button>
        </div>

        <span className="lrail__spacer" />

        <div className="lrail__me">
          <button
            ref={meRef}
            type="button"
            className="lrail__avatar"
            onClick={() => setMenu(menu?.kind === 'me' ? null : { kind: 'me', anchor: anchorOf(meRef.current, 'above', 'start'), focusFirst: false })}
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'me'}
            aria-label={`${user.name}. Account, appearance and board list`}
          >
            <Avatar name={user.name} color={user.color} size={30} />
          </button>
        </div>

        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleRestoreFile(file);
            e.target.value = '';
          }}
        />
      </nav>

      <main
        className={`lstage${peeking ? ' lstage--peek' : ''}`}
        ref={stageRef}
        onDragEnter={(e) => {
          if (!dragHasFile(e.dataTransfer)) return;
          dragDepth.current += 1;
          setDropping(true);
        }}
        onDragOver={(e) => {
          if (!dragHasFile(e.dataTransfer)) return;
          // Unclaimed, the browser navigates to the file and unloads the app.
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
          if (file) void handleRestoreFile(file);
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

        <div
          className="lstage__inner"
          ref={roving.containerRef as React.RefObject<HTMLDivElement>}
          onKeyDown={roving.onKeyDown}
          onFocus={onStageFocus}
        >
          {restoreError && (
            <div className="stage__error" role="alert">
              {restoreError}
              <button type="button" className="stage__error-x" onClick={() => setRestoreError(null)} aria-label="Dismiss">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}

          {joinOpen && (
            <form className="lstage__join" onSubmit={handleJoin}>
              <Link2 size={16} aria-hidden="true" />
              <input
                ref={joinRef}
                type="text"
                value={joinLink}
                onChange={(e) => { setJoinLink(e.target.value); setJoinError(null); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setJoinOpen(false); setJoinError(null); } }}
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

          {/* An empty library has nothing to search, sort or lay out, so no header. */}
          {(view === 'templates' || hasRooms) && (
            <header className="lstage__head">
              <div className="lstage__titles">
                <h1 className="lstage__title">
                  {view === 'boards' ? 'Your boards' : category ? categoryLabel : 'Templates'}
                </h1>
                <p className="lstage__lede">
                  {view === 'boards'
                    ? `${recentRooms.length} on this device${pinnedSet.size ? `, ${pinnedSet.size} pinned` : ''}. Kept in your browser rather than in an account.`
                    : category
                      ? `${matchedTemplates.length} board${matchedTemplates.length === 1 ? '' : 's'}, each one editable the moment it opens.`
                      : 'Working boards, already filled in. Click one for a closer look.'}
                </p>
              </div>

              <div className="lstage__tools">
                <label className="lstage__search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        stageRef.current?.querySelector<HTMLElement>('[data-roving][tabindex="0"]')?.focus();
                      }
                    }}
                    placeholder={view === 'boards' ? 'Search your boards' : 'Search templates'}
                    aria-label={view === 'boards' ? 'Search your boards' : 'Search templates'}
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
                    <button
                      ref={sortRef}
                      type="button"
                      className="lbtn"
                      aria-haspopup="menu"
                      aria-expanded={menu?.kind === 'sort'}
                      onClick={() => setMenu(menu?.kind === 'sort' ? null : { kind: 'sort', anchor: anchorOf(sortRef.current), focusFirst: false })}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ kind: 'sort', anchor: anchorOf(sortRef.current), focusFirst: true }); }
                      }}
                    >
                      {BOARD_SORTS.find((s) => s.id === sort)?.label}
                      <ChevronDown size={13} aria-hidden="true" />
                    </button>

                    <div className="lstage__layout" role="group" aria-label="How boards are shown">
                      <button type="button" className="lbtn lbtn--icon" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} data-tooltip="Grid" aria-label="Show boards as a grid">
                        <LayoutGrid size={15} aria-hidden="true" />
                      </button>
                      <button type="button" className="lbtn lbtn--icon" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} data-tooltip="List" aria-label="Show boards as a list">
                        <Rows3 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </>
                )}

                {/* The page's one front door. A plain click makes a blank board; the caret holds the rarer openings. */}
                <div className="lstage__new">
                  <button type="button" className="lstage__new-go" onClick={openBoard} data-tooltip="New board · N">
                    <Plus size={16} aria-hidden="true" />
                    <span className="lstage__new-label">New board</span>
                  </button>
                  <button
                    ref={newMoreRef}
                    type="button"
                    className="lstage__new-more"
                    onClick={() => setMenu(menu?.kind === 'new' ? null : { kind: 'new', anchor: anchorOf(newMoreRef.current), focusFirst: false })}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ kind: 'new', anchor: anchorOf(newMoreRef.current), focusFirst: true }); }
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menu?.kind === 'new'}
                    aria-label="More ways to start a board"
                  >
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </header>
          )}

          {view === 'templates' && (
            <div className="lchips" role="group" aria-label="Template categories">
              <button type="button" className={`lchip${!category ? ' is-on' : ''}`} aria-pressed={!category} onClick={() => goTemplates(null)}>
                All <span>{TEMPLATES.length}</span>
              </button>
              {CATEGORIES.map((c) => {
                const count = TEMPLATES.filter((x) => x.category === c.id).length;
                if (count === 0) return null;
                return (
                  <button key={c.id} type="button" className={`lchip${category === c.id ? ' is-on' : ''}`} aria-pressed={category === c.id} onClick={() => goTemplates(c.id)}>
                    {c.label} <span>{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'boards' ? boardsBody : templatesBody}

          {view === 'boards' && removedRooms.length > 0 && (
            <section className="shelf" aria-label="Removed from this device">
              <button type="button" className="shelf__toggle" aria-expanded={shelfOpen} onClick={() => setShelfOpen((o) => !o)}>
                <ChevronRight size={14} aria-hidden="true" className="shelf__chev" />
                {removedRooms.length === 1 ? '1 board removed from this device' : `${removedRooms.length} boards removed from this device`}
              </button>

              {shelfOpen && (
                <>
                  <p className="shelf__note">
                    None of these was deleted. Each one still exists and still opens; this device simply stopped keeping the
                    address. Copy a link to take it with you, or save your whole board list from the account menu.
                  </p>
                  <ul className="shelf__list">
                    {removedRooms.map((room) => (
                      <li key={room.id} className="shelf__row" data-confirming={confirmForget === room.id || undefined}>
                        <span className="shelf__name">{room.name}</span>
                        {confirmForget === room.id ? (
                          <>
                            <span className="shelf__ask" role="alert">Forget this address for good? It cannot be brought back from here.</span>
                            <button type="button" className="shelf__act shelf__act--danger" onClick={() => forgetRemoved(room)}>
                              Forget
                            </button>
                            <button
                              ref={keepRef}
                              type="button"
                              className="shelf__put"
                              onClick={() => setConfirmForget(null)}
                              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setConfirmForget(null); } }}
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="shelf__when">Removed {whenOpened(room.removedAt)}</span>
                            <button type="button" className="shelf__act" onClick={() => void copyAddress(room)} data-tooltip="Copy this board's link">
                              <Link2 size={14} aria-hidden="true" /> Copy link
                            </button>
                            <button type="button" className="shelf__put" onClick={() => putBack(room.id)}>
                              <Undo2 size={14} aria-hidden="true" /> Put back
                            </button>
                            <button type="button" className="shelf__act shelf__act--let-go" onClick={() => setConfirmForget(room.id)} data-tooltip="Drop this address for good">
                              <Trash2 size={14} aria-hidden="true" /> Forget
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {view === 'boards' && hasRooms && !query.trim() && (
            <section className="lseam" aria-labelledby="lseam-title">
              <header className="lseam__head">
                <h2 className="lseam__title" id="lseam-title">Start from a template</h2>
                <button type="button" className="lbtn" onClick={() => goTemplates(null)}>
                  All {TEMPLATES.length}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </header>
              <div className="tgrid tgrid--seam" ref={setSeamGrid}>{suggestedTemplates.map((t) => templateCard(t, 'seam'))}</div>
            </section>
          )}
        </div>

        {peeking && (
          <TemplatePeek
            template={peeking}
            index={peekIndex}
            count={Math.max(1, visibleTemplates.length)}
            onStep={stepPeek}
            onClose={closePeek}
            onUse={openTemplate}
            onUseInNewTab={openTemplateInNewTab}
          />
        )}
      </main>

      {menu && (
        <Menu
          key={menu.kind === 'board' ? `board-${menu.board.id}` : menu.kind}
          entries={menuEntries()}
          label={menu.kind === 'board' ? `${menu.board.name} actions` : menu.kind === 'sort' ? 'Sort boards' : menu.kind === 'new' ? 'Start a board' : 'Account'}
          anchor={menu.anchor}
          focusFirst={menu.focusFirst}
          onClose={() => setMenu(null)}
        />
      )}

      {paletteOpen && (
        <Suspense fallback={null}>
          <HomePalette
            boards={shownBoards}
            pinned={pinnedSet}
            templates={TEMPLATES}
            onClose={() => setPaletteOpen(false)}
            onNewBoard={openBoard}
            onOpenBoard={(board) => goToBoard(`/room/${board.id}`)}
            onPeekTemplate={(t) => { goTemplates(t.category); setQuery(''); setPeekId(t.id); }}
            onBrowseTemplates={() => goTemplates(null)}
            onJoin={() => { setView('boards'); openJoin(); }}
            onRestore={() => restoreInputRef.current?.click()}
            onSaveList={saveLibrary}
          />
        </Suspense>
      )}
    </div>
  );
};
