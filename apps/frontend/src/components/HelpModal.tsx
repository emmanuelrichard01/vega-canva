import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Compass, Keyboard, ListChecks, MousePointer2, Search, Sparkles, Table2, Users, X } from 'lucide-react';
import { Dialog, useDialog } from './ui/Dialog';
import { tooltipProps } from './ui/Tooltip';
import { IS_MAC, capsFor, comboFromEvent, comboToSpec, combosInSpec } from './menu/shortcuts';
import { LESSONS } from '../engine/learn/lessons';
import { learnState } from '../engine/learn/learnState';
import { walkthroughState } from '../engine/learn/walkthroughState';
import { tourState } from '../engine/learn/tourState';
import { stepsFor } from '../engine/learn/tour';
import { checklistState } from '../engine/learn/tourChecklist';
import { useRoomPermissions } from '../hooks/useRoomPermissions';
import { useStore } from '../hooks/useStore';
import {
  HELP_PAGES,
  COLLAB_ORDER,
  RELEASE_NOTES,
  buildKeyMap,
  buildShortcutGroups,
  keyAndLayer,
  lessonMatches,
  pageForLesson,
  searchGroups,
  type HelpPageId,
  type ShortcutGroup,
  type ShortcutRow,
} from './help/helpContent';
import { DRAWN_KEYS, HelpKeyboard } from './help/HelpKeyboard';
import { HelpLesson } from './help/HelpLesson';
import { useReducedMotion } from './learn/ScriptedDemo';
import './help/help.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The page to open on. Shortcuts, because `?` and the menu's Shortcuts row both mean it. */
  initialPage?: HelpPageId;
}

const PAGE_ICON: Record<HelpPageId, typeof Compass> = {
  start: Compass,
  recipes: ListChecks,
  tools: MousePointer2,
  shortcuts: Keyboard,
  collab: Users,
  data: Table2,
  new: Sparkles,
};

/**
 * Keys the search field keeps for itself. Every other modified key pressed on
 * this page is looked up instead of reaching the board.
 */
const FIELD_KEYS = new Set([
  'mod+a', 'mod+c', 'mod+v', 'mod+x', 'mod+z', 'mod+y', 'mod+shift+z', 'mod+backspace', 'mod+delete',
  'mod+arrowleft', 'mod+arrowright', 'alt+backspace', 'alt+arrowleft', 'alt+arrowright',
  'mod+shift+arrowleft', 'mod+shift+arrowright',
]);

/** One written shortcut as keycaps for this machine, alternatives separated. */
export const Keys: React.FC<{ written: string }> = ({ written }) => (
  <span className="hc-keys">
    {written.split(/\s+\/\s+/).map((alt, ai) => (
      <React.Fragment key={alt + ai}>
        {ai > 0 && <span className="hc-keys__or">or</span>}
        {capsFor(alt).map((k, ki) => (
          <kbd key={k + ki}>{k}</kbd>
        ))}
      </React.Fragment>
    ))}
  </span>
);

/** The part of a string that matched the search, marked, so a surviving row says why. */
const Highlight: React.FC<{ text: string; q: string }> = ({ text, q }) => {
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="hc-mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
};

const ShortcutList: React.FC<{ group: ShortcutGroup; q: string; flash: string | null; hideBlurb?: boolean }> = ({
  group,
  q,
  flash,
  hideBlurb,
}) => (
  <section className="hc-group" aria-labelledby={`hc-group-${group.id}`}>
    <h4 id={`hc-group-${group.id}`} className="hc-group__title">
      {group.title}
    </h4>
    {group.blurb && !q && !hideBlurb && <p className="hc-group__blurb">{group.blurb}</p>}
    <dl className="hc-rows">
      {group.rows.map((row) => (
        <div key={row.keys + row.what} className="hc-row" data-flash={flash === row.keys + row.what || undefined}>
          <dt>
            <Highlight text={row.what} q={q} />
          </dt>
          <dd>
            <Keys written={row.keys} />
          </dd>
        </div>
      ))}
    </dl>
  </section>
);

/**
 * Where things are, drawn: the left column, the board, the right column and
 * the dock. A sentence about "the left column" is something you have to map
 * onto the screen; this is the screen.
 */
const LayoutSketch: React.FC = () => (
  <figure className="hc-sketch" aria-label="The board fills the window. Layers and the board's name are in the left column, properties in the right column, and the tools in the dock along the bottom.">
    <svg viewBox="0 0 480 220" role="presentation" aria-hidden="true">
      <rect className="hc-sketch__board" x="0.5" y="0.5" width="479" height="219" rx="10" />
      <g className="hc-sketch__dots">
        {Array.from({ length: 9 }, (_, r) =>
          Array.from({ length: 21 }, (_, c) => <circle key={`${r}-${c}`} cx={40 + c * 20} cy={20 + r * 22} r="1" />)
        )}
      </g>
      <rect className="hc-sketch__panel" x="12" y="12" width="104" height="196" rx="8" />
      <rect className="hc-sketch__panel" x="364" y="12" width="104" height="196" rx="8" />
      <rect className="hc-sketch__panel" x="164" y="178" width="152" height="30" rx="10" />
      <g className="hc-sketch__lines">
        <rect x="24" y="26" width="52" height="6" rx="3" />
        <rect x="24" y="48" width="72" height="4" rx="2" />
        <rect x="32" y="60" width="64" height="4" rx="2" />
        <rect x="32" y="72" width="56" height="4" rx="2" />
        <rect x="24" y="84" width="68" height="4" rx="2" />
        <rect x="376" y="26" width="44" height="6" rx="3" />
        <rect x="376" y="48" width="80" height="14" rx="4" />
        <rect x="376" y="70" width="80" height="14" rx="4" />
        <rect x="376" y="92" width="38" height="14" rx="4" />
        <rect x="418" y="92" width="38" height="14" rx="4" />
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x={174 + i * 20} y="186" width="12" height="14" rx="3" />
        ))}
      </g>
      <rect className="hc-sketch__work" x="182" y="64" width="64" height="44" rx="4" />
      <rect className="hc-sketch__work hc-sketch__work--alt" x="262" y="84" width="52" height="52" rx="26" />
    </svg>
    <figcaption className="hc-sketch__legend">
      <span><b>Left</b> layers and the board’s menu</span>
      <span><b>Bottom</b> the dock: tools, Insert ＋ and All tools</span>
      <span><b>Right</b> properties of the selection</span>
    </figcaption>
  </figure>
);

export const HelpModal: React.FC<Props> = ({ open, onClose, initialPage = 'shortcuts' }) => {
  if (!open) return null;
  return (
    <Dialog onClose={onClose} size="xl" className="hc" ariaLabel="Help">
      <HelpCentre initialPage={initialPage} />
    </Dialog>
  );
};

const HelpCentre: React.FC<{ initialPage: HelpPageId }> = ({ initialPage }) => {
  const { close, titleId } = useDialog();
  const [page, setPage] = useState<HelpPageId>(initialPage);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ combo: string; hits: Array<{ group: ShortcutGroup; row: ShortcutRow }> } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(buildShortcutGroups, []);
  const keymap = useMemo(() => buildKeyMap(groups, DRAWN_KEYS), [groups]);
  const { muted } = useSyncExternalStore(learnState.subscribe, learnState.getSnapshot, learnState.getSnapshot);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  /**
   * Pages cross-fade: the page you leave fades out (80ms), then the next fades
   * in (100ms), so a change is never longer than 180ms and never a hard cut.
   * Under reduced motion the swap is immediate.
   */
  const view: string = searching ? 'search' : page;
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState<string>(view);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (view === shown) return;
    if (reducedMotion) {
      setShown(view);
      return;
    }
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown(view);
      setLeaving(false);
    }, 80);
    return () => window.clearTimeout(id);
  }, [view, shown, reducedMotion]);
  const matchedGroups = useMemo(() => searchGroups(groups, q), [groups, q]);
  const matchedLessons = useMemo(() => (q ? LESSONS.filter((l) => lessonMatches(l, q)) : LESSONS), [q]);
  const matchedNotes = useMemo(
    () => (q ? RELEASE_NOTES.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q)) : RELEASE_NOTES),
    [q]
  );
  const total = matchedGroups.reduce((n, g) => n + g.rows.length, 0) + matchedLessons.length + matchedNotes.length;

  /** Matches per page, for the counts beside the nav while searching. */
  const countFor = (id: HelpPageId): number => {
    if (id === 'shortcuts') return matchedGroups.reduce((n, g) => n + g.rows.length, 0);
    if (id === 'new') return matchedNotes.length;
    return (
      matchedGroups.filter((g) => g.page === id).reduce((n, g) => n + g.rows.length, 0) +
      matchedLessons.filter((l) => pageForLesson(l) === id).length
    );
  };

  const startWalk = useCallback(
    (lessonId: string) => {
      // Read now, so what is already on the board cannot count toward step one.
      walkthroughState.start(lessonId, { objects: useStore.getState().objects, selected: [] });
      close();
    },
    [close]
  );

  const go = (id: HelpPageId) => {
    setPage(id);
    setQuery('');
    setFound(null);
    mainRef.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (query) setFound(null);
  }, [query]);

  // Bring a found row into view once the page it is on has rendered.
  useEffect(() => {
    if (!flash) return;
    mainRef.current?.querySelector<HTMLElement>('[data-flash]')?.scrollIntoView({ block: 'center' });
    const t = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(t);
  }, [flash]);

  /**
   * Typing anywhere goes to the search field, and pressing a shortcut looks it
   * up. This is the page people open when they cannot remember something, and
   * the one where they are most likely to try a key to see what it does, so
   * that key is explained here and never passed to the board.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA';
    const combo = comboFromEvent(e);
    const modified = e.metaKey || e.ctrlKey || e.altKey || (e.shiftKey && /^Digit/.test(e.code));
    if (combo && modified && !(inField && FIELD_KEYS.has(combo))) {
      e.preventDefault();
      e.stopPropagation();
      const hits = groups.flatMap((g) =>
        g.rows.filter((r) => combosInSpec(r.keys).includes(combo)).map((row) => ({ group: g, row }))
      );
      setFound({ combo, hits });
      setQuery('');
      setPage('shortcuts');
      if (hits.length > 0) setFlash(hits[0].row.keys + hits[0].row.what);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || inField) return;
    // Space and the arrows belong to whatever control has focus.
    if (e.key === ' ' || (e.target as HTMLElement).closest('.hkb__board')) return;
    searchRef.current?.focus();
  };

  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const at = HELP_PAGES.findIndex((p) => p.id === page);
    const n = HELP_PAGES.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    go(HELP_PAGES[next].id);
    navRef.current?.querySelector<HTMLElement>(`[data-page="${HELP_PAGES[next].id}"]`)?.focus();
  };

  const current = HELP_PAGES.find((p) => p.id === page)!;
  const focusKey = found ? keyAndLayer(found.combo, DRAWN_KEYS) : null;
  const lessonsOn = (id: HelpPageId) => LESSONS.filter((l) => pageForLesson(l) === id);
  /** The Collaboration page tells its story in a deliberate order, not the list's. */
  const collabLessons = useMemo(() => {
    const on = LESSONS.filter((l) => pageForLesson(l) === 'collab');
    const rank = (id: string) => {
      const at = COLLAB_ORDER.indexOf(id);
      return at < 0 ? COLLAB_ORDER.length : at;
    };
    return [...on].sort((x, y) => rank(x.id) - rank(y.id));
  }, []);
  const groupsOn = (id: HelpPageId) => groups.filter((g) => g.page === id);

  return (
    <div className="hc__grid" onKeyDown={onKeyDown}>
      <aside className="hc__side">
        <h2 id={titleId} className="hc__title">
          Help
        </h2>

        <div className="hc__search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                navRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.focus();
              }
            }}
            placeholder="Search, or press a shortcut"
            aria-label="Search help"
            aria-describedby="hc-search-hint"
          />
          {query && (
            <button
              type="button"
              className="hc__clear"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="hc-search-hint" className="hc__sr">
          Press any shortcut while this page is open to find out what it does.
        </p>

        <nav ref={navRef} className="hc__nav" aria-label="Help topics" onKeyDown={onNavKeyDown}>
          {HELP_PAGES.map((p) => {
            const Icon = PAGE_ICON[p.id];
            const isCurrent = !searching && page === p.id;
            const count = searching ? countFor(p.id) : null;
            return (
              <button
                key={p.id}
                type="button"
                data-page={p.id}
                className="hc__nav-item"
                aria-current={isCurrent ? 'page' : undefined}
                data-empty={count === 0 || undefined}
                tabIndex={page === p.id ? 0 : -1}
                onClick={() => go(p.id)}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="hc__nav-label">{p.label}</span>
                {count !== null && <span className="hc__nav-count">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="hc__side-foot">
          <div className="hc__tips">
            <button
              type="button"
              role="switch"
              aria-checked={!muted}
              aria-labelledby="hc-tips-label"
              aria-describedby="hc-tips-hint"
              className="ui-switch"
              onClick={() => (muted ? learnState.unmute() : learnState.mute())}
            >
              <span className="ui-switch__track" aria-hidden="true">
                <span className="ui-switch__thumb" />
              </span>
            </button>
            <span>
              <span id="hc-tips-label" className="hc__tips-label">
                Tips on the canvas
              </span>
              <span id="hc-tips-hint" className="hc__tips-hint">
                {muted ? 'Off. Nothing will interrupt you.' : 'A new tool explains itself once.'}
              </span>
            </span>
          </div>
          <TourButton className="hc__tour" />
        </div>
      </aside>

      <div className="hc__main">
        <header className="hc__head">
          <div className="hc__heading">
            <h3 className="hc__page-title">{searching ? `Results for “${query.trim()}”` : current.label}</h3>
            <p className="hc__lede" role={searching ? 'status' : undefined}>
              {searching
                ? total === 0
                  ? 'Nothing matches. Try a tool name, or press the shortcut itself.'
                  : `${total} ${total === 1 ? 'match' : 'matches'}`
                : current.lede}
            </p>
          </div>
          <button
            type="button"
            className="dlg__close"
            onClick={close}
            aria-label="Close"
            data-dialog-close
            {...tooltipProps({ label: 'Close', shortcut: 'Esc', side: 'bottom' })}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="hc__scroll" ref={mainRef} key={shown} data-leaving={leaving || undefined}>
          {found && !searching && (
            <div className="hc-finder" role="status" data-hit={found.hits.length > 0 || undefined}>
              <Keys written={comboToSpec(found.combo)} />
              {found.hits.length > 0 ? (
                <span className="hc-finder__what">
                  {found.hits[0].row.what}
                  <span className="hc-finder__where">
                    {found.hits[0].group.title}
                    {found.hits.length > 1 && `, and ${found.hits.length - 1} more`}
                  </span>
                </span>
              ) : (
                <span className="hc-finder__what">Nothing is bound to this.</span>
              )}
              <button type="button" className="hc__clear" onClick={() => setFound(null)} aria-label="Dismiss">
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}

          {shown === 'search' ? (
            <SearchResults
              groups={matchedGroups}
              lessons={matchedLessons}
              notes={matchedNotes}
              q={q}
              onWalk={startWalk}
            />
          ) : shown === 'start' ? (
            <>
              <LayoutSketch />
              <p className="hc-prose">
                The dock along the bottom holds the tools you reach for most. Insert ＋ adds pictures, links,
                icons and media, and All tools lists every tool there is. Every tool also has a single key.
                Right-click anything to see what it can do. The tour points at each part of the screen in
                turn, and you can stop it at any step.
              </p>
              <div className="hc-actions">
                <TourButton />
                <button
                  type="button"
                  className="dlg-btn dlg-btn--outline"
                  onClick={() => {
                    close();
                    checklistState.reopen();
                  }}
                >
                  Show the getting-started checklist
                </button>
              </div>
              <Columns>
                {groupsOn('start').map((g) => (
                  <ShortcutList key={g.id} group={g} q="" flash={flash} />
                ))}
              </Columns>
            </>
          ) : shown === 'recipes' ? (
            <Lessons lessons={lessonsOn('recipes')} onWalk={startWalk} title="Recipes" hideTitle />
          ) : shown === 'tools' ? (
            <>
              <ToolGrid group={groups.find((g) => g.id === 'tools')!} />
              <Lessons lessons={lessonsOn('tools')} onWalk={startWalk} title="Gestures worth knowing" />
              <Columns>
                {groupsOn('tools')
                  .filter((g) => g.id !== 'tools')
                  .map((g) => (
                    <ShortcutList key={g.id} group={g} q="" flash={flash} />
                  ))}
              </Columns>
            </>
          ) : shown === 'shortcuts' ? (
            <>
              <HelpKeyboard keymap={keymap} focus={focusKey} />
              <p className="hc-note">
                {IS_MAC
                  ? 'Shown with this Mac’s keys. On Windows and Linux, ⌘ is Ctrl and ⌥ is Alt.'
                  : 'Shown with this computer’s keys. On a Mac, Ctrl is ⌘ and Alt is ⌥.'}
              </p>
              <Columns>
                {groups.map((g) => (
                  <ShortcutList key={g.id} group={g} q="" flash={flash} />
                ))}
              </Columns>
            </>
          ) : shown === 'collab' ? (
            <>
              <dl className="hc-roles">
                <div>
                  <dt>Can edit</dt>
                  <dd>Draw, move and delete anything, and share the board onward.</dd>
                </div>
                <div>
                  <dt>Can comment</dt>
                  <dd>Read the board and leave comments. The drawing tools stay away.</dd>
                </div>
                <div>
                  <dt>Can view</dt>
                  <dd>Look and export. The server refuses edits, so this is a real limit.</dd>
                </div>
              </dl>
              <p className="hc-prose">
                Share links carry one of these roles. Comment and view links are signed by the server, so
                nobody can turn one into an edit link, and they can expire. Open Share from the right column to
                make one.
              </p>
              <Lessons lessons={collabLessons} onWalk={startWalk} title="Live on the board" gallery />
              <Columns>
                {groupsOn('collab').map((g) => (
                  <ShortcutList key={g.id} group={g} q="" flash={flash} />
                ))}
              </Columns>
              
            </>
          ) : shown === 'data' ? (
            <>
              <p className="hc-prose">
                A table holds the numbers, a chart reads them from the table and redraws as they change, and a
                grid lays out a composition with modules that pictures and captions fill. Diagrams can be written
                as Mermaid code and arrive as real shapes you can restyle.
              </p>
              <Columns>
                {groupsOn('data').map((g) => (
                  <ShortcutList key={g.id} group={g} q="" flash={flash} />
                ))}
              </Columns>
              <Lessons lessons={lessonsOn('data')} onWalk={startWalk} title="How they work" />
            </>
          ) : (
            <ReleaseNotes notes={RELEASE_NOTES} />
          )}
        </div>
      </div>
    </div>
  );
};

/** Starts the tour, or picks it up where it was left; the label says which. */
const TourButton: React.FC<{ className?: string }> = ({ className }) => {
  const { close } = useDialog();
  const { role } = useRoomPermissions();
  const tour = useSyncExternalStore(tourState.subscribe, tourState.getSnapshot, tourState.getSnapshot);
  const resume = tour.resumeAt !== null && tourState.canResume();
  return (
    <button
      type="button"
      className={`dlg-btn dlg-btn--outline ${className ?? ''}`}
      onClick={() => {
        close();
        if (resume) tourState.start();
        else tourState.restart();
      }}
    >
      {resume ? 'Resume the tour' : `Take the ${stepsFor(role).length}-step tour`}
    </button>
  );
};

const Columns: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="hc-cols">{children}</div>;

const ToolGrid: React.FC<{ group: ShortcutGroup }> = ({ group }) => (
  <section className="hc-tools" aria-labelledby="hc-tools-title">
    <h4 id="hc-tools-title" className="hc-group__title">
      {group.title}
    </h4>
    <p className="hc-group__blurb">{group.blurb}</p>
    <ul className="hc-tools__list">
      {group.rows.map((row) => (
        <li key={row.keys + row.what} className="hc-tools__item">
          <span className="hc-tools__name">{row.what}</span>
          <Keys written={row.keys} />
        </li>
      ))}
    </ul>
  </section>
);

const Lessons: React.FC<{
  lessons: readonly (typeof LESSONS)[number][];
  onWalk: (id: string) => void;
  title: string;
  /** The page title already says it. */
  hideTitle?: boolean;
  /** Columns of lessons that rise in one after another. */
  gallery?: boolean;
}> = ({ lessons, onWalk, title, hideTitle, gallery }) =>
  lessons.length === 0 ? null : (
    <section className={gallery ? 'hc-lessons hc-lessons--gallery' : 'hc-lessons'} aria-label={title}>
      {!hideTitle && <h4 className="hc-group__title">{title}</h4>}
      {/* The LESSONS builder's demos, drawn once and shared with the coach mark. */}
      <div className="hc-lessons__list">
        {lessons.map((lesson, i) => (
          <HelpLesson key={lesson.id} lesson={lesson} onWalk={onWalk} index={gallery ? i : undefined} />
        ))}
      </div>
    </section>
  );

const ReleaseNotes: React.FC<{ notes: typeof RELEASE_NOTES }> = ({ notes }) => (
  <ol className="hc-notes">
    {notes.map((note) => (
      <li key={note.title} className="hc-note-item">
        <h4 className="hc-note-item__title">{note.title}</h4>
        <p className="hc-note-item__body">{note.body}</p>
        {note.keys && (
          <p className="hc-note-item__keys">
            <span>Try</span>
            {note.keys.map((k) => (
              <Keys key={k} written={k} />
            ))}
          </p>
        )}
      </li>
    ))}
  </ol>
);

const SearchResults: React.FC<{
  groups: ShortcutGroup[];
  lessons: readonly (typeof LESSONS)[number][];
  notes: typeof RELEASE_NOTES;
  q: string;
  onWalk: (id: string) => void;
}> = ({ groups, lessons, notes, q, onWalk }) => (
  <>
    {groups.length > 0 && (
      <Columns>
        {groups.map((g) => (
          <ShortcutList key={g.id} group={g} q={q} flash={null} />
        ))}
      </Columns>
    )}
    <Lessons lessons={lessons} onWalk={onWalk} title="Lessons" />
    {notes.length > 0 && (
      <section className="hc-lessons" aria-label="What's new">
        <h4 className="hc-group__title">What’s new</h4>
        <ReleaseNotes notes={notes} />
      </section>
    )}
  </>
);
