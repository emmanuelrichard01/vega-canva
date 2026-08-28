import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { X, Search } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { TOOL_SHORTCUTS } from '../engine/tools/shortcuts';
import { TOOL_NAMES } from '../engine/tools/toolNames';
import { keyFor, LESSONS, type Lesson } from '../engine/learn/lessons';
import { learnState } from '../engine/learn/learnState';
import { LessonDemo } from './learn/LessonDemo';

interface Shortcut {
  keys: string;
  what: string;
}

interface Section {
  id: string;
  /** The label in the category rail. Short, because it sits in a narrow column. */
  tab: string;
  /**
   * Which heading in the rail this sits under.
   *
   * Declared by the section rather than listed separately, for the same reason
   * the categories are derived from the sections: a list beside a list is how
   * four of these ended up with no way to reach them at all. A section that
   * names no group would be a section nobody can find.
   */
  group: string;
  title: string;
  blurb?: string;
  rows: Shortcut[];
}

/** The order the groups appear in the rail, coarse to specialised. */
const GROUPS = ['Basics', 'Drawing', 'Content', 'Workspace'] as const;

/**
 * `Cmd` on a Mac, `Ctrl` everywhere else — decided once, at the top.
 *
 * `navigator.platform` is deprecated and empty in some browsers, which would
 * quietly tell every Mac user to press Ctrl. `userAgentData.platform` is the
 * replacement where it exists; the user-agent string is the fallback that has
 * always worked. Three sources, one answer, computed once.
 */
const MOD = ((): string => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const claimed =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /Mac|iPhone|iPad|iPod/i.test(claimed) ? 'Cmd' : 'Ctrl';
})();

function buildSections(): Section[] {
  const tools: Shortcut[] = Object.entries(TOOL_SHORTCUTS).map(([id, key]) => ({
    keys: key,
    what: TOOL_NAMES[id] ?? id,
  }));

  return [
    {
      id: 'tools',
      group: 'Basics',
      tab: 'Tools',
      title: 'Tools',
      blurb: 'One key each, no modifier. Press it anywhere on the board.',
      rows: tools,
    },
    {
      id: 'navigation',
      group: 'Basics',
      tab: 'Navigation',
      title: 'Moving around',
      blurb: 'The board has no edges. You cannot run out of space in any direction.',
      rows: [
        { keys: 'Scroll', what: 'Pan up, down and sideways' },
        { keys: 'Pinch', what: 'Zoom in and out at the pointer' },
        { keys: 'Ctrl + Scroll', what: 'Zoom with a mouse wheel' },
        { keys: 'Space + Drag', what: 'Pan without leaving the current tool' },
        { keys: 'Arrows', what: 'Pan the canvas viewport (when no objects are selected)' },
        { keys: '0', what: 'Reset view to origin at 100%' },
        { keys: `${MOD} + 0`, what: 'Reset zoom & position to 100%' },
        { keys: '+ / −', what: 'Zoom in and out' },
        { keys: `${MOD} + + / −`, what: 'Zoom in and out with modifier' },
        { keys: 'Shift + 1', what: 'Fit everything on screen' },
        { keys: `${MOD} + 1`, what: 'Zoom to fit all objects' },
        { keys: `${MOD} + K`, what: 'Command palette & search' },
        { keys: `${MOD} + P`, what: 'Command palette alternative' },
        { keys: '?', what: 'Open keyboard shortcuts & help' },
        { keys: '\\', what: 'Toggle Zen mode: hide or show panels' },
      ],
    },
    {
      id: 'selection',
      group: 'Basics',
      tab: 'Selection',
      title: 'Selecting',
      rows: [
        { keys: 'Click', what: 'Select one object' },
        { keys: 'Shift + Click', what: 'Add to or remove from selection' },
        { keys: 'Drag on empty board', what: 'Marquee: select everything inside' },
        { keys: `${MOD} + A`, what: 'Select every object on the board' },
        { keys: 'Esc', what: 'Deselect, or exit current edit mode' },
        { keys: 'Double-click', what: 'Go inside: text, line points, path anchors, image crop' },
        { keys: 'Enter', what: 'Edit selected text or note, or open a line’s points' },
        { keys: 'Alt + Drag', what: 'Duplicate the object instead of moving it' },
        { keys: 'Right-click', what: 'Context menu with type-actions & alignment' },
      ],
    },
    {
      id: 'editing',
      group: 'Basics',
      tab: 'Editing',
      title: 'Editing',
      rows: [
        { keys: `${MOD} + Z`, what: 'Undo previous action' },
        { keys: `${MOD} + Shift + Z`, what: 'Redo previously undone action' },
        { keys: `${MOD} + Y`, what: 'Redo (Windows / Linux standard)' },
        { keys: `${MOD} + C`, what: 'Copy, and it works across boards and tabs' },
        { keys: `${MOD} + X`, what: 'Cut selection to clipboard' },
        { keys: `${MOD} + V`, what: 'Paste. SVG arrives as editable vectors' },
        { keys: `${MOD} + D`, what: 'Duplicate selection, offset slightly' },
        { keys: `${MOD} + G`, what: 'Group selected objects' },
        { keys: `${MOD} + Shift + G`, what: 'Ungroup selected objects' },
        { keys: 'Delete / Backspace', what: 'Delete selection (frames take contents)' },
        { keys: 'Arrows', what: 'Nudge selection by 1 pixel' },
        { keys: 'Shift + Arrows', what: 'Nudge selection by 10 pixels' },
        { keys: `${MOD} + ]`, what: 'Bring selection forward one step' },
        { keys: `${MOD} + [`, what: 'Send selection backward one step' },
        { keys: `${MOD} + Shift + ]`, what: 'Bring selection to front' },
        { keys: `${MOD} + Shift + [`, what: 'Send selection to back' },
      ],
    },
    {
      /**
       * The tool that changed most, and the one nobody will guess at.
       *
       * A line was two points for the whole life of this project, so there is
       * no reason for anyone to suspect that clicking rather than dragging does
       * something different — which makes this the section most worth having.
       */
      id: 'lines',
      group: 'Drawing',
      tab: 'Lines',
      title: 'Lines & arrows',
      blurb: 'Drag for a straight line. Click for one with corners.',
      rows: [
        // Advertised as `L / R` here for a long time, and neither was bound:
        // `R` arms the generic Shape seat and `L` did nothing. The Tools
        // section above is generated from `TOOL_SHORTCUTS` and was right; this
        // hand-written row was the exact failure `toolNames.ts` warns about.
        { keys: 'L', what: 'Line / Arrow: press again to switch between them' },
        { keys: 'Drag', what: 'A straight line from where you pressed to where you let go' },
        { keys: 'Click, click, click', what: 'Place a corner with each click' },
        { keys: 'Enter / Esc', what: 'Finish the line you are drawing' },
        { keys: 'Double-click', what: 'Also finishes it. The last click lands on the last corner' },
        { keys: 'Backspace', what: 'Take back the corner you just placed' },
        { keys: 'Shift', what: 'Constrain the next corner to 15° steps' },
      ],
    },
    {
      id: 'linepoints',
      group: 'Drawing',
      tab: 'Line points',
      title: 'Reshaping a line',
      blurb: 'Double-click a line, or press Enter with it selected.',
      rows: [
        { keys: 'Double-click', what: 'Open the point editor' },
        { keys: `Enter / ${MOD} + Enter`, what: 'Open it from the keyboard' },
        { keys: 'Drag a point', what: 'Move that corner' },
        { keys: 'Drag a curve handle', what: 'Bend the segment into an arc' },
        { keys: 'Alt + Click a segment', what: 'Add a corner where you clicked' },
        { keys: 'Alt + Click a curve handle', what: 'Straighten that segment again' },
        { keys: 'Delete', what: 'Remove the selected corner' },
        { keys: 'Shift + Drag', what: 'Constrain to 15° from the neighbouring point' },
        { keys: 'Esc', what: 'Leave the point editor' },
      ],
    },
    {
      id: 'pen',
      group: 'Drawing',
      tab: 'Pen',
      title: 'The Pen (P)',
      blurb: 'Bézier curves. Click for corners, drag for smooth ones.',
      rows: [
        { keys: 'Click', what: 'Place a corner point' },
        { keys: 'Drag', what: 'Place a smooth point and pull its handles' },
        { keys: 'Alt + Drag', what: 'Break the handles apart for a cusp' },
        { keys: 'Click the last point', what: 'Retract its outgoing handle' },
        { keys: 'Click the first point', what: 'Close the path' },
        { keys: 'Shift', what: 'Constrain to 45° steps' },
        { keys: 'Backspace', what: 'Undo the last point' },
        { keys: 'Enter', what: 'Finish as an open path' },
        { keys: 'Esc', what: 'Discard the path' },
      ],
    },
    {
      id: 'vector',
      group: 'Drawing',
      tab: 'Vector',
      title: 'Vector & Direct Select (A)',
      blurb: 'Direct Select tool (A) or double-click any vector path.',
      rows: [
        { keys: 'A', what: 'Direct Select tool (anchors & bezier handles)' },
        { keys: 'Click + Drag', what: 'Marquee select multiple anchor points' },
        { keys: `${MOD} / Shift + Click`, what: 'Add or toggle anchors in selection' },
        { keys: 'Click Outline', what: 'Insert new anchor point on path' },
        { keys: 'Shift + Drag', what: 'Constrain anchor/handle drag to 0°, 45°, 90° axes' },
        { keys: 'Alt + Drag Handle', what: 'Break tangent symmetry for sharp cusp curves' },
        { keys: 'Alt + Click Anchor', what: 'Retract handles (convert to sharp corner)' },
        { keys: 'Double-click Anchor', what: 'Toggle between Corner and Smooth modes' },
        { keys: 'Delete / Backspace', what: 'Delete selected anchors and bridge path' },
        { keys: 'Arrows / Shift + Arrows', what: 'Nudge selected anchors by 1px / 10px' },
      ],
    },
    {
      id: 'typography',
      group: 'Content',
      tab: 'Type',
      title: 'Type & Formatting',
      blurb: 'Works on text nodes, shape labels, and sticky notes.',
      rows: [
        { keys: `${MOD} + B`, what: 'Toggle Bold weight' },
        { keys: `${MOD} + I`, what: 'Toggle Italic style' },
        { keys: `${MOD} + U`, what: 'Toggle Underline' },
      ],
    },
    {
      id: 'export',
      group: 'Content',
      tab: 'Export',
      title: 'Copying & exporting',
      blurb: 'Everything works on a selection as well as on the whole board.',
      rows: [
        { keys: `${MOD} + Shift + E`, what: 'Export the selection: six formats, with a preview' },
        { keys: 'Right-click', what: 'Copy as PNG or SVG, and Export from the same menu' },
      ],
    },
    {
      id: 'stickies',
      group: 'Content',
      tab: 'Notes',
      title: 'Sticky Notes',
      rows: [
        { keys: 'S, then click', what: 'Place a note, ready to type' },
        { keys: 'Tab', what: 'Chain another note beside the active one' },
        { keys: 'Esc', what: 'Finish editing (empty notes self-clean)' },
      ],
    },
    {
      id: 'layers',
      group: 'Workspace',
      tab: 'Layers',
      title: 'The Layers Panel',
      blurb: 'Click into the tree first. Keyboard arrows navigate from there.',
      rows: [
        { keys: '↑ / ↓', what: 'Move cursor; Shift extends selection' },
        { keys: '← / →', what: 'Fold and unfold a frame or group' },
        { keys: `${MOD} + ↑ / ↓`, what: 'Move one position forward or back in stack' },
        { keys: 'Enter', what: 'Rename layer' },
        { keys: 'Space', what: 'Toggle layer visibility' },
        { keys: `${MOD} + A`, what: 'Select every visible layer row' },
        { keys: 'Delete', what: 'Delete selected layer rows' },
      ],
    },
    {
      id: 'radar',
      group: 'Workspace',
      tab: 'Radar',
      title: 'Minimap & Radar',
      blurb: 'Focus the radar to fly the camera around the workspace.',
      rows: [
        { keys: 'Arrows', what: 'Pan by a quarter of a screen' },
        { keys: '+ / −', what: 'Zoom in and out' },
        { keys: '0', what: 'Back to 100% zoom' },
        { keys: 'Shift + 1 / Home', what: 'Fit all objects on screen' },
      ],
    },
    {
      id: 'replay',
      group: 'Workspace',
      tab: 'History',
      title: 'Session Time Travel',
      blurb: 'While history replay is active. The live canvas is preserved.',
      rows: [
        { keys: '← / →', what: 'Step one moment in history' },
        { keys: 'K / Space', what: 'Play or pause timeline playback' },
        { keys: 'Home / End', what: 'Jump to the beginning or end of history' },
      ],
    },
  ];
}

/**
 * Things worth knowing that are not a keystroke.
 *
 * The test for what belongs here: it has to be something the interface cannot
 * tell you by itself, and something that changes what you would do. "Edits sync
 * over CRDTs" fails both — it is true, it is invisible, and knowing it does not
 * change a single action anyone takes.
 */
/**
 * The tips are the lessons, and there is one list of them.
 *
 * There used to be a `TIPS` array here: ten paragraphs teaching the line tool,
 * the connector, booleans and the physics room. The canvas now coaches those
 * same gestures when you pick up the tool they belong to, and writing them a
 * second time for this screen would have made two bodies of teaching text about
 * one set of gestures. They drift the way every pair in this codebase drifts,
 * and teaching text drifts worst of all, because nobody thinks to update the
 * tutorial when they change the gesture.
 *
 * `engine/learn/lessons.ts` holds them. This screen shows the whole library
 * with its steps; the coach mark shows one, with two. Same sentences.
 */

/**
 * One lesson, in full.
 *
 * The coach mark on the canvas shows the first two steps because it is sitting
 * over a board somebody is working on. Nothing is competing for this screen, so
 * this shows all of them, and the gesture drawing beside them.
 *
 * The learned state is shown but never used to hide anything. A reference that
 * withheld what you already knew would be a reference you could not check.
 */
const LessonCard: React.FC<{ lesson: Lesson }> = ({ lesson }) => {
  const { learned } = useSyncExternalStore(
    learnState.subscribe,
    learnState.getSnapshot,
    learnState.getSnapshot
  );
  const key = keyFor(lesson);

  return (
    <article className="help-lesson" data-known={learned.includes(lesson.id) || undefined}>
      {lesson.demo && <LessonDemo demo={lesson.demo} />}
      <div className="help-lesson__body">
        <h4 className="help-lesson__title">
          {lesson.title}
          {key && <kbd>{key}</kbd>}
        </h4>
        <p className="help-lesson__gist">{lesson.gist}</p>
        <dl className="help-lesson__steps">
          {lesson.steps.map((step) => (
            <div key={step.act}>
              <dt>{step.act}</dt>
              <dd>{step.gives}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
};

const TIPS_TAB = 'tips';
const ALL_TAB = 'all';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** A category in the rail: what it is called, and how much is in it right now. */
interface Category {
  id: string;
  label: string;
  group: string | null;
  /** Matching rows under the current query. The rail reports it as a count. */
  count: number;
}

/**
 * The keyboard reference, and the handful of things a keyboard cannot say.
 *
 * ## What was wrong with the filtering
 *
 * The tab strip was a hand-written list of eight beside a section list of ten,
 * which is the arrangement this codebase keeps finding bugs in: four sections —
 * the vector tools, the radar, time travel and sticky notes — had **no tab of
 * their own**, so picking any tab hid them and they were reachable only under
 * "All". Nothing said so; they simply were not there. The categories are
 * derived from the sections now, so a section cannot exist without a way to
 * reach it, and each section names its own group for the same reason.
 *
 * Search had the mirror of the same fault. Tips were shown only when the query
 * was empty, so typing a word that appears in a tip hid every tip — and picking
 * the Tips tab and then typing produced a blank panel with no message, because
 * the empty state was itself inside the "not the tips tab" branch. A search that
 * hides what matches is worse than no search at all. Both lists are searched
 * now, and every combination of category and query renders either results or a
 * sentence saying why not.
 *
 * ## What was wrong with the switching
 *
 * Fixing the coverage left sixteen categories in a horizontally scrolling strip
 * of pills, which is the wrong shape twice over. Sixteen is too many to scan as
 * a row — they were in no order anyone could predict, and the last of them sat
 * off the right edge behind a scrollbar that was deliberately hidden, so the
 * panel gave no sign that the categories continued. And the strip stole the
 * width the *content* needed, which is what forced the second fault: picking a
 * category re-laid-out the entire body. "All" rendered two masonry columns plus
 * a tips sidebar; one category rendered a single column with no sidebar, so
 * every click changed the column count, the panel's internal widths and the
 * scroll height together. That is the jarring part, and no amount of
 * transition on a pill fixes it.
 *
 * So the categories are a **rail** down the left instead — all sixteen visible
 * at once, grouped and ordered, in a column that costs the content nothing
 * because a shortcut list is short lines of text and never wanted the last two
 * hundred pixels. The content pane keeps its geometry whatever is selected: two
 * columns always, of sections when several are shown and of rows when one is,
 * so the width, the column count and the type never move. What changes is what
 * is written in them.
 *
 * The tips are a category rather than a sidebar for the same reason — a panel
 * that appears and disappears beside the content is the single largest jump in
 * the old layout, and "Worth knowing" is a section of the reference, not a
 * different kind of thing.
 */
export const HelpModal: React.FC<Props> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState(ALL_TAB);
  const panelRef = useFocusTrap(open, onClose);
  /**
   * The content pane, so a category change starts at the top of what it shows.
   *
   * Keeping the scroll offset across a switch is the other half of the jarring:
   * pick a short category while scrolled down the long one and the pane lands
   * mid-nowhere, or snaps as the content shrinks under it.
   */
  const paneRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(buildSections, []);

  const q = query.trim().toLowerCase();

  /** Whether a shortcut row answers the current query. */
  const rowMatches = (r: Shortcut) =>
    r.what.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q);

  /**
   * Every section, narrowed to the rows that match — before any category is
   * applied.
   *
   * Computed once and shared by the rail and the pane, because the rail's
   * counts and the pane's contents have to be the same answer. Two passes over
   * the same question is how they drift.
   */
  const matched = useMemo(
    () =>
      sections.map((s) => {
        if (!q) return s;
        const rows = s.rows.filter(rowMatches);
        // A section whose own title matches keeps all of its rows: searching
        // "line" should show the line section entire, not only the two rows
        // that happen to repeat the word.
        return rows.length === 0 && s.title.toLowerCase().includes(q) ? s : { ...s, rows };
      }),
    // `rowMatches` closes over `q`, which is the only thing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, q]
  );

  const matchedTips = useMemo(() => {
    if (!q) return LESSONS;
    // The steps are searched as well as the title and the gist. Somebody
    // typing "Tab" is looking for the gesture, and the gesture only appears in
    // a step -- a search that misses what it is displaying is the fault this
    // screen's own header records having already had once.
    return LESSONS.filter((lesson) =>
      [lesson.title, lesson.gist, ...lesson.steps.flatMap((s) => [s.act, s.gives])]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [q]);

  const totalRows = matched.reduce((n, s) => n + s.rows.length, 0);

  /**
   * The rail, with a live count against each entry.
   *
   * The counts are the search's other half. Typing a word tells you *how many*
   * matches there are and *where they live* before you have gone looking — so
   * "line" showing eleven under Lines and four under Line points is an answer
   * in itself. An empty category is dimmed rather than removed: a rail whose
   * entries come and go as you type is a moving target, and the point of a
   * fixed rail is that it does not move.
   */
  const categories = useMemo<Category[]>(
    () => [
      { id: ALL_TAB, label: 'Everything', group: null, count: totalRows + matchedTips.length },
      ...GROUPS.flatMap((group) =>
        matched
          .filter((s) => s.group === group)
          .map((s) => ({ id: s.id, label: s.tab, group, count: s.rows.length }))
      ),
      { id: TIPS_TAB, label: 'Worth knowing', group: null, count: matchedTips.length },
    ],
    [matched, matchedTips.length, totalRows]
  );

  const visibleSections = useMemo(() => {
    if (activeTab === TIPS_TAB) return [];
    const scoped =
      activeTab === ALL_TAB ? matched : matched.filter((s) => s.id === activeTab);
    return scoped.filter((s) => s.rows.length > 0);
  }, [matched, activeTab]);

  const visibleTips = activeTab === ALL_TAB || activeTab === TIPS_TAB ? matchedTips : [];

  const nothingMatched = visibleSections.length === 0 && visibleTips.length === 0;

  /**
   * How many matches there are outside the category being looked at.
   *
   * The rail's counts made a new fault visible the moment they existed: search
   * for a word while a category is selected and the pane says "nothing
   * matches" — flatly, as though the word appears nowhere — while the rail
   * beside it is showing four matches in three other categories. Both are
   * true and together they are a contradiction, and the reader is the one left
   * to resolve it.
   *
   * Not auto-switched to Everything, which was the other candidate: a panel
   * that changes what it is showing while you type is a panel you cannot aim
   * at, and a search that keeps landing you somewhere you did not pick is
   * worse than one that tells you where to go. So the empty state names the
   * number and offers the one click.
   */
  const elsewhere =
    activeTab === ALL_TAB
      ? 0
      : totalRows + matchedTips.length - (visibleSections[0]?.rows.length ?? visibleTips.length);

  /** A single section fills the pane with its rows rather than half of it. */
  const single = visibleSections.length === 1 && visibleTips.length === 0;

  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  /** Re-open on Everything, so the panel never reappears mid-filter. */
  useEffect(() => {
    if (open) setActiveTab(ALL_TAB);
  }, [open]);

  /**
   * Up and down move through the rail, which a row of pills never offered.
   *
   * `role="tablist"` is a promise about the arrow keys as much as about the
   * labels, and this is the keyboard help — a category list you can only reach
   * by pointer, inside the panel that documents the keyboard, is the feature
   * contradicting itself. Roving tabindex, so one Tab press enters the rail and
   * the next leaves it for the content rather than walking sixteen buttons.
   */
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = categories.findIndex((c) => c.id === activeTab);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? categories.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + categories.length) % categories.length;
    setActiveTab(categories[next].id);
    railRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cat="${categories[next].id}"]`)
      ?.focus();
  };

  if (!open) return null;

  let lastGroup: string | null = null;

  return (
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        ref={panelRef}
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="help-modal__head">
          <h2 id="help-title">Keyboard &amp; Help</h2>
          <div className="help-modal__search">
            <Search size={13} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts and tips…"
              aria-label="Search shortcuts and tips"
              autoFocus
            />
            {query && (
              <button
                type="button"
                className="help-modal__clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="help-modal__split">
          <div
            ref={railRef}
            className="help-rail"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Help categories"
            onKeyDown={onRailKeyDown}
          >
            {categories.map((cat) => {
              const isActive = activeTab === cat.id;
              const heading = cat.group && cat.group !== lastGroup ? cat.group : null;
              lastGroup = cat.group;
              return (
                <React.Fragment key={cat.id}>
                  {heading && <p className="help-rail__group">{heading}</p>}
                  <button
                    type="button"
                    role="tab"
                    data-cat={cat.id}
                    aria-selected={isActive}
                    // One stop for the whole rail; the arrows move within it.
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveTab(cat.id)}
                    className={`help-rail__item ${isActive ? 'is-active' : ''} ${
                      cat.count === 0 ? 'is-empty' : ''
                    }`}
                  >
                    <span className="help-rail__label">{cat.label}</span>
                    <span className="help-rail__count">{cat.count}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* `key` on the pane restarts the fade, so a switch reads as a change
              rather than as a redraw. The geometry underneath it does not move,
              which is what makes a fade the right thing here at all. */}
          <div className="help-modal__pane" ref={paneRef}>
            <div
              // The empty state is a sentence and a button, and a multi-column
              // container puts the sentence in one column and the button in
              // the next. It is the answer to the whole pane, so the pane
              // stops being columns while it is showing one.
              className={`help-modal__cols ${single ? 'is-single' : ''} ${
                nothingMatched ? 'is-blank' : ''
              }`}
              key={activeTab}
            >
              {visibleSections.map((section) => (
                <section key={section.id} className="help-section">
                  <h3>{section.title}</h3>
                  {section.blurb && !q && <p className="help-section__blurb">{section.blurb}</p>}
                  <dl>
                    {section.rows.map((row) => (
                      <div key={row.keys + row.what} className="help-row">
                        <dt>
                          {row.keys.split(' + ').map((k, i) => (
                            <React.Fragment key={k + i}>
                              {i > 0 && <span className="help-plus">+</span>}
                              <kbd>{k}</kbd>
                            </React.Fragment>
                          ))}
                        </dt>
                        <dd>{row.what}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}

              {visibleTips.length > 0 && (
                <section className="help-section help-section--tips">
                  <h3>Worth knowing</h3>
                  {visibleTips.map((lesson) => (
                    <LessonCard key={lesson.id} lesson={lesson} />
                  ))}
                </section>
              )}

              {/* Outside both branches, so every combination of category and
                  query says something. Picking Tips and then typing used to
                  render a blank panel: the empty state lived inside the "not
                  the tips tab" branch and could not be reached from there. */}
              {nothingMatched && (
                <div className="help-modal__empty">
                  {q ? (
                    <>
                      <p>
                        Nothing in{' '}
                        <strong>
                          {categories.find((c) => c.id === activeTab)?.label ?? 'this category'}
                        </strong>{' '}
                        matches “{query}”.
                      </p>
                      {elsewhere > 0 ? (
                        <button
                          type="button"
                          className="help-modal__jump"
                          onClick={() => setActiveTab(ALL_TAB)}
                        >
                          Show all {elsewhere} {elsewhere === 1 ? 'match' : 'matches'}
                          elsewhere
                        </button>
                      ) : (
                        <p className="help-modal__hint">
                          Try a tool name, or a key like <kbd>{MOD}</kbd>.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>Nothing to show here yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
