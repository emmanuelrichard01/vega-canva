import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { TOOL_SHORTCUTS } from '../engine/tools/shortcuts';
import { TOOL_NAMES } from '../engine/tools/toolNames';
import { keyFor, LESSONS, type Lesson } from '../engine/learn/lessons';
import { learnState } from '../engine/learn/learnState';
import { isWalkable } from '../engine/learn/walkthrough';
import { walkthroughState } from '../engine/learn/walkthroughState';
import { useStore } from '../hooks/useStore';
import { tourState } from '../engine/learn/tourState';
import { TOUR } from '../engine/learn/tour';
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

/** The key the *other* sort of machine uses, for the note under the title. */
const OTHER_MOD = MOD === 'Cmd' ? 'Ctrl' : 'Cmd';
const OTHER_PLATFORM = MOD === 'Cmd' ? 'On Windows and Linux' : 'On a Mac';

function buildSections(): Section[] {
  const tools: Shortcut[] = [
    ...Object.entries(TOOL_SHORTCUTS).map(([id, key]) => ({
      keys: key,
      what: TOOL_NAMES[id] ?? id,
    })),
    // Written here rather than in the map above because neither is a tool:
    // they change how long the tool in your hand stays there. Both are bound
    // in `useRoomShortcuts`; see `toolModes` for the rules.
    { keys: 'Q', what: 'Keep the armed tool after it places something (or double-click its seat)' },
    { keys: 'Hold a tool key', what: 'Use that tool, then let go to go back to the last one' },
  ];

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
const LessonCard: React.FC<{ lesson: Lesson; onWalk: (id: string) => void }> = ({
  lesson,
  onWalk,
}) => {
  const { learned } = useSyncExternalStore(
    learnState.subscribe,
    learnState.getSnapshot,
    learnState.getSnapshot
  );
  const key = keyFor(lesson);
  /**
   * Whether this lesson can be *performed* as well as read.
   *
   * Derived from the walkthrough table rather than listed here, for the reason
   * the tool rows below are derived from `TOOL_SHORTCUTS`: a second list of
   * which lessons are walkable would be wrong the first time one was added.
   */
  const walkable = isWalkable(lesson.id);

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
        {/*
          The offer to do it rather than read it.
          Here rather than on the canvas because a walkthrough is a thing you
          choose to start: raising one unasked is the wizard this product has
          twice decided against. The coach mark is what arrives uninvited, and
          it is one glance rather than five steps.
        */}
        {walkable && (
          <button type="button" className="help-lesson__walk" onClick={() => onWalk(lesson.id)}>
            Walk me through it
          </button>
        )}
      </div>
    </article>
  );
};

/**
 * The part of a string that matched, marked.
 *
 * A search that filters but does not say *why* a row survived makes the reader
 * re-run the query in their head on every result. On a list of a hundred
 * shortcuts that is the difference between scanning and reading.
 *
 * First occurrence only, and case-insensitive against the already-lowercased
 * query the rest of the panel filters with, so what is highlighted is exactly
 * what was matched on. A second pass with different rules would be a second
 * answer to one question.
 */
const Highlight: React.FC<{ text: string; q: string }> = ({ text, q }) => {
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="help-mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
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
   * Begin a walkthrough, and get out of its way.
   *
   * Closing the reference is half the action rather than a courtesy: the
   * walkthrough's first step is a gesture on the board, and the board is
   * behind this dialog. Leaving it open would be asking somebody to do
   * something they cannot reach.
   *
   * The snapshot is read at this instant, not when the first step is observed,
   * so anything already on the board cannot count toward the first step —
   * starting the connector walkthrough on a board that already has connectors
   * would otherwise complete step one before it had been read.
   */
  const startWalk = useCallback(
    (lessonId: string) => {
      walkthroughState.start(lessonId, {
        objects: useStore.getState().objects,
        selected: [],
      });
      onClose();
    },
    [onClose]
  );
  /**
   * The content pane, so a category change starts at the top of what it shows.
   *
   * Keeping the scroll offset across a switch is the other half of the jarring:
   * pick a short category while scrolled down the long one and the pane lands
   * mid-nowhere, or snaps as the content shrinks under it.
   */
  const paneRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * One indicator that travels, rather than sixteen that light up.
   *
   * The difference is not decoration. A background that appears under whichever
   * item was clicked gives the eye nothing to follow, so a category change is
   * two separate events -- something went out over there, something came on
   * over here -- and the reader has to find the new one. A single mark that
   * moves is one event, and the eye is carried to the answer rather than
   * sent looking for it.
   *
   * Measured rather than computed from an index: the rail has group headings
   * between its items, of a height set by the stylesheet, so anything derived
   * from the item's position in the list would be wrong by however many
   * headings preceded it and would go wronger every time the type scale moved.
   */
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);

  const sections = useMemo(buildSections, []);

  /** Whether coach marks are still being offered, and the control to change it. */
  const { muted } = useSyncExternalStore(
    learnState.subscribe,
    learnState.getSnapshot,
    learnState.getSnapshot
  );

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
   * Where the indicator goes, measured after layout and before paint.
   *
   * `useLayoutEffect` rather than `useEffect`: with the latter the mark is
   * painted at its old position for one frame and then jumps, which on the
   * first open means it flies in from wherever it happened to be.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const el = railRef.current?.querySelector<HTMLElement>(`[data-cat="${activeTab}"]`);
    setMarker(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [open, activeTab, categories.length, q]);

  /**
   * Typing anywhere in the panel goes to the search field.
   *
   * This is the screen people open when they cannot remember something, and
   * the first thing anyone does with a wall of shortcuts is start typing. Any
   * printable key with no modifier lands in the field, wherever focus happens
   * to be, so the search is never something to aim at first.
   *
   * Modified keys are left alone, because this is also the screen where
   * somebody is most likely to be *trying* a shortcut to see what it does.
   */
  const onPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return;
    const el = document.activeElement?.tagName;
    if (el === 'INPUT' || el === 'TEXTAREA') return;
    searchRef.current?.focus();
  }, []);

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
        onKeyDown={onPanelKeyDown}
      >
        <header className="help-modal__head">
          <div className="help-modal__title">
            <h2 id="help-title">Everything you can do</h2>
            {/**
              * The two facts this panel knew and never said.
              *
              * `MOD` is worked out at the top of the file from three sources
              * because getting it wrong tells every Mac user to press the wrong
              * key -- and then the answer was only ever *used*, never
              * explained, so a Windows user reading a colleague's screenshot
              * had no way to translate. And the key that opens this is the one
              * shortcut that cannot be found by opening this.
              *
              * The sentence itself has to be written from the reader's machine
              * rather than about both at once. "`Ctrl` is `Cmd` on a Mac and
              * `Ctrl` everywhere else" is what the general form rendered as on
              * Windows: a definition that restates its own subject, with the
              * one useful half -- what the *other* machine presses -- buried in
              * a clause that reads as a contradiction. Two short sentences,
              * one about this machine and one about the other, say the whole
              * thing without ever needing to be parsed twice.
              */}
            <p className="help-modal__orient">
              Every shortcut below uses <kbd>{MOD}</kbd>. {OTHER_PLATFORM}, press{' '}
              <kbd>{OTHER_MOD}</kbd> instead. <kbd>?</kbd> reopens this page.
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {/* Its own row, full width. It was wedged between the title and the
            close button, which is the layout for a field nobody is expected to
            use -- and this is the primary way anybody finds anything here. */}
        <div className="help-modal__seek">
          <div className="help-modal__search">
            <Search size={14} aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Down from the field enters the rail, so a search and the
                // thing it found are one gesture apart.
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  railRef.current
                    ?.querySelector<HTMLButtonElement>(`[data-cat="${activeTab}"]`)
                    ?.focus();
                }
              }}
              placeholder="Search shortcuts and tips"
              aria-label="Search shortcuts and tips"
              autoFocus
            />
            {query && (
              <button
                type="button"
                className="help-modal__clear"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* The count, said once, where the typing is. The rail breaks it down
              by category; this is the one number that answers "is it in here
              at all", which is the question a query with no results leaves
              hanging. */}
          {q && (
            <p className="help-modal__tally" role="status">
              {totalRows + matchedTips.length === 0
                ? 'Nothing matches'
                : `${totalRows + matchedTips.length} ${
                    totalRows + matchedTips.length === 1 ? 'match' : 'matches'
                  }`}
            </p>
          )}
        </div>

        <div className="help-modal__split">
          <div
            ref={railRef}
            className="help-rail"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Help categories"
            onKeyDown={onRailKeyDown}
          >
            {/* The travelling mark. Behind the items and never in the tab
                order: it is a drawing of which one is selected, and
                `aria-selected` is what actually says so. */}
            {marker && (
              <span
                className="help-rail__marker"
                aria-hidden="true"
                style={{ transform: `translateY(${marker.top}px)`, height: marker.height }}
              />
            )}

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
                      q && cat.count === 0 ? 'is-empty' : ''
                    }`}
                  >
                    {cat.id === TIPS_TAB && (
                      <Sparkles size={12} className="help-rail__mark" aria-hidden />
                    )}
                    <span className="help-rail__label">{cat.label}</span>
                    {/**
                      * The count, only while searching.
                      *
                      * It is the search's other half: typing a word and seeing
                      * eleven under Lines is an answer before you have gone
                      * looking. At rest it is sixteen numbers nobody asked for,
                      * and the rail should read as a table of contents rather
                      * than as a spreadsheet.
                      */}
                    {q && <span className="help-rail__count">{cat.count}</span>}
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
              {visibleSections.map((section, i) => (
                <section
                  key={section.id}
                  className="help-section"
                  // The stagger index, so a switch arrives as a sequence rather
                  // than as a page appearing at once. Capped in the stylesheet.
                  style={{ '--i': i } as React.CSSProperties}
                >
                  <h3>{section.title}</h3>
                  {section.blurb && !q && <p className="help-section__blurb">{section.blurb}</p>}
                  <dl>
                    {section.rows.map((row) => (
                      /**
                       * What it does first, the keys second and right-aligned.
                       *
                       * They were the other way round. A shortcut sheet is read
                       * by intent -- you know what you want and you are looking
                       * for the key -- so leading with the key makes the reader
                       * scan a column of symbols they do not yet care about.
                       * Right-aligning the keys also puts them on a common
                       * edge, which is what makes a long list scannable at all.
                       */
                      <div key={row.keys + row.what} className="help-row">
                        <dt>
                          <Highlight text={row.what} q={q} />
                        </dt>
                        <dd>
                          {row.keys.split(' + ').map((k, ki) => (
                            <React.Fragment key={k + ki}>
                              {ki > 0 && <span className="help-plus">+</span>}
                              <kbd>{k}</kbd>
                            </React.Fragment>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}

              {visibleTips.length > 0 && (
                <section className="help-section help-section--tips">
                  <h3>Worth knowing</h3>
                  {/* Its own grid, because a lesson is a card and a shortcut
                      table is a list of short lines. Sharing one measure sliced
                      the cards in half; see `.help-section--tips`. */}
                  <div className="help-lessons">
                    {visibleTips.map((lesson) => (
                      <LessonCard key={lesson.id} lesson={lesson} onWalk={startWalk} />
                    ))}
                  </div>
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

        {/**
          * The one control this panel owed somebody.
          *
          * `LessonCoach` offers "Stop showing tips", and the note beside that
          * button says the choice is reversible from the reference library.
          * It was not: nothing here could turn them back on, which is the
          * capability-with-no-honouring failure invariant 6 names, committed by
          * the same change that wrote the promise.
          *
          * A switch rather than a button, because it is a state you can see
          * rather than an action you have to guess the current effect of.
          */}
        <footer className="help-modal__foot">
          <label className="help-modal__tips">
            <button
              type="button"
              role="switch"
              aria-checked={!muted}
              className="grid-switch"
              data-active={!muted || undefined}
              onClick={() => (muted ? learnState.unmute() : learnState.mute())}
            >
              <span className="grid-switch__dot" />
            </button>
            <span>
              Show tips on the canvas
              <span className="help-modal__tips-hint">
                {muted
                  ? 'Off. Nothing will interrupt you.'
                  : 'A tool you have not used yet explains itself once.'}
              </span>
            </span>
          </label>

          {/**
            * One button, and "Show them all again" is not it.
            *
            * It called `learnState.reset()`, which clears what you have learned
            * *and* unmutes -- so pressing it while the switch beside it was off
            * silently turned that switch back on. Two controls where one
            * secretly moves the other is worse than either alone.
            *
            * It was also answering a question already answered twice on this
            * screen. "I want tips again" is the switch. "Show me that lesson
            * again" is the library directly below, which holds every one of
            * them in full, with its drawing, which is more than a coach mark
            * would have given back.
            */}
          <div className="help-modal__foot-actions">
            {/* The tour, replayable. It is offered once on a first run and then
                never again on its own, which is only bearable if there is an
                obvious way back to it -- and this is where somebody who has
                forgotten where something lives already comes looking. */}
            <button
              type="button"
              className="help-modal__tour"
              onClick={() => {
                onClose();
                tourState.start();
              }}
            >
              Take the {TOUR.length}-step tour
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
