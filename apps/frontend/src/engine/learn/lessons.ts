import { TOOL_SHORTCUTS } from '../tools/shortcuts';
import { FORCE_IDS } from '../physics/forces';
import { chord } from './chords';
import type { ScriptedId } from './demoScript';

/**
 * What the interface cannot say for itself, written down once.
 *
 * ## Why this is a module and not copy inside components
 *
 * `HelpModal` already carried a `TIPS` array teaching the line tool, the
 * connector, booleans and the physics room. Building in-canvas coaching with
 * its own words would have made a second body of teaching text about the same
 * gestures, and the two would drift the way every pair in this codebase has:
 * each looks right on its own, and only somebody who reads both notices they
 * disagree. Invariant 7, and it is worth paying for up front here because
 * teaching text is *especially* prone to it -- nobody updates the tutorial when
 * they change the gesture.
 *
 * So there is one list. The reference reads it as a library, the canvas reads
 * it as a coach mark when you pick up the tool it is about, and both are
 * looking at the same sentences.
 *
 * ## What earns a lesson
 *
 * Only a gesture you could not guess. Every tool already has a tooltip, a key
 * badge and a name; teaching thirteen icons teaches thirteen names and no
 * judgement. The test is narrower: *if you armed this tool and did the obvious
 * thing, would you find what it does?* Dragging a rectangle: yes, no lesson.
 * Clicking once per corner to build a route, dropping a photograph into a grid
 * module, holding a force field over a running simulation: no, and each gets
 * one.
 *
 * That is why the eraser, the shape tool and the hand are absent. They are not
 * forgotten, they are guessable, and a coach mark on a guessable tool is the
 * thing that teaches people to dismiss coach marks.
 *
 * ## Why keys are looked up rather than written
 *
 * `toolNames.ts` opens by saying that a help screen hard-coding a shortcut will
 * be wrong, and then documents four places where exactly that happened. A
 * lesson names a tool; `keyFor` asks `TOOL_SHORTCUTS` what that tool is bound
 * to. Anything advertised here is bound, by construction.
 */

/** One gesture, and what it produces. */
export interface LessonStep {
  /** The gesture, in the imperative. */
  act: string;
  /** What you get for it. Never a restatement of the gesture. */
  gives: string;
}

/**
 * The little animations, which are shared rather than one per lesson.
 *
 * A gesture drawing is expensive to make well and several lessons are about
 * the *same* gesture at bottom -- clicking a sequence of points builds a line
 * and builds a path. A lesson with no demo is a lesson whose steps are enough
 * on their own, which is still most of them. An animation that adds nothing is
 * worse than none: it takes the eye first and then does not repay it.
 *
 * ## The test a scene has to pass
 *
 * The words have to be *unable* to carry it. `boolean-shapes` is the clearest
 * case in the list and says so in its own gist -- "four words for four results
 * nobody can tell apart from the words" -- and `pen-anchors`, `text-box`,
 * `link-card` and `diagram-code` fail the same way for the same reason: each
 * turns on a difference between two pictures ("smooth" against "corner", type
 * that reflows against type that scales, an address against a card, code
 * against objects) and a sentence naming both is a sentence you have to
 * imagine.
 *
 * The same holds for the newer gestures: a stroke that snaps when you hold
 * still, a chain that grows on Tab, a column that fills when you drag a corner
 * are things that happen *over time*, and a sentence cannot show time.
 *
 * ## Two kinds of scene
 *
 * `ScriptedId` demos are driven by one clock (`demoScript.ts`): a ghost pointer,
 * keycaps and the drawing all read the same time, so they can be paused,
 * scrubbed and replaced by a three-frame storyboard under reduced motion. The
 * rest are older CSS loops that stay as they are until their lesson changes.
 *
 * The ones still without a scene fail the test in the other direction. A
 * comment is a pin and a thread, a voice note is a waveform, a frame is a box:
 * the words already put the right picture in your head, so a drawing would only
 * confirm it. `offline` has no gesture at all.
 */
export const LEGACY_DEMO_IDS = [
  'route',
  'reframe',
  'field',
  'boolean',
  'pen',
  'sizing',
  'unfurl',
  'code-shapes',
] as const;

export type LegacyDemoId = (typeof LEGACY_DEMO_IDS)[number];

export type DemoId = LegacyDemoId | ScriptedId;

/**
 * What raises a lesson on the canvas.
 *
 * A tool, or nothing.
 *
 * There was briefly a third kind -- a *moment*, such as the first selection or
 * the fifth object -- carrying the two panel lessons. It was the wrong shape
 * twice. A card floating above the dock saying "click the rail on the right" is
 * the worst possible version of a spatial instruction, and it arrived at a
 * moment somebody had chosen to do something else. Both faults are the same
 * one: where things live is not a thing to teach just in time. It is a thing to
 * point at, once, when asked. That is `tour.ts`.
 *
 * What is left here is verbs, which is what just-in-time teaching is actually
 * for: you have picked up the tool, so this is the moment the gesture matters.
 *
 * `library` is not a failure to find a trigger. Combining two shapes and
 * reading a diagram back out as code are real capabilities with no moment at
 * which the product could honestly interrupt to mention them, so they are found
 * rather than offered.
 */
export type LessonTrigger =
  | { on: 'tool'; tools: readonly string[] }
  | { on: 'library' };

export interface Lesson {
  id: string;
  trigger: LessonTrigger;
  title: string;
  /** The one sentence that makes the rest guessable. */
  gist: string;
  steps: readonly LessonStep[];
  demo?: DemoId;
  /**
   * A recipe: several tools used together to make something, rather than one
   * gesture. It is always `library`-triggered, because there is no tool whose
   * arming means "I am about to build a flowchart", and it is always walkable
   * (`walkthrough.ts`), because the point of a recipe is that you finish with
   * the thing made.
   */
  recipe?: true;
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'grid-content',
    trigger: { on: 'tool', tools: ['grid'] },
    title: 'A grid is a live layout',
    gist: 'The modules are not decoration. Put things in them and they fill each one edge to edge, then follow it when you change the arrangement. Or go the other way and let a grid form around what you already have.',
    demo: 'arrange',
    steps: [
      {
        act: 'Drag a picture, a note or any object onto a module',
        gives: 'It is adopted: sized to the module, cropped to fit rather than squashed to fit',
      },
      {
        act: `Select several objects and press ${chord('arrangeInGrid')}`,
        gives: 'A grid forms around them with a cell for each, sized to what it holds',
      },
      {
        act: 'Double-click a grid, or select it and press Enter',
        gives: `Edit cells. ${chord('mergeCells')} merges the selected cells, ${chord('splitCells')} splits them, and dragging a border resizes the rows or columns`,
      },
      {
        act: 'Double-click a picture in a module',
        gives: 'Drag to move it inside its frame, scroll to zoom in on part of it',
      },
      {
        act: 'Change the arrangement underneath it all',
        gives: 'Content follows its module. Anything with no module left waits in a strip below the grid, and returns when there is room',
      },
    ],
  },
  {
    /**
     * The chart tool had no lesson at all, which was the largest hole in this
     * table: it is the one tool where placing it is the easy part and every
     * question after that — where do the numbers come from, how do I get my
     * own in, what are the expression tokens — is unguessable from the canvas.
     * Grid, which is comparable in depth, has had one all along.
     */
    id: 'chart-data',
    trigger: { on: 'tool', tools: ['chart'] },
    title: 'A chart is a spreadsheet you can see',
    gist: 'The numbers behind a chart are a real sheet, or a range of a table on the board. Change a number and the chart redraws beside it. Drag a bar and the number follows.',
    demo: 'chartlive',
    steps: [
      {
        act: 'Place a chart, then double-click it',
        gives: 'Its data as a spreadsheet, with the chart live beside it. Paste a block from Excel or Sheets and it lands as real rows and columns',
      },
      {
        act: 'Select a range in a table and choose Chart this',
        gives: 'A chart beside the table, linked to that range. Edit the table and the chart follows',
      },
      {
        act: 'Select a chart and drag a bar or a point',
        gives: 'The value moves with your pointer, and the number behind it changes to match',
      },
      {
        act: 'Click a legend entry. Alt-click one',
        gives: 'Click hides or shows that series. Alt-click shows it on its own',
      },
      {
        act: 'Select a chart and double-click its title or an axis label',
        gives: 'The text, open to edit in place',
      },
      {
        act: 'Leave a cell empty rather than typing 0',
        gives: 'A gap in the line. A missing reading is not a measured nought, and the chart draws the difference',
      },
    ],
  },
  {
    id: 'pen-snap',
    trigger: { on: 'tool', tools: ['pen'] },
    title: 'Draw it roughly, hold, and it snaps clean',
    gist: 'Keep the pen still for a beat at the end of a stroke and it becomes the shape you meant: a line, arrow, ellipse, box, diamond, triangle or polygon, drawn in the same brush.',
    demo: 'snap',
    steps: [
      {
        act: 'Draw a rough circle, box or arrow, then hold still',
        gives: 'The stroke snaps to a clean version. Keep moving and it stays freehand, so handwriting is safe',
      },
      { act: 'Hold Shift while you draw', gives: 'A straight line from where you pressed to where you are' },
      {
        act: 'Pick Pen, Marker or Highlighter in the options that open with the tool',
        gives: 'Three brushes. The highlighter lays translucent ink and never snaps. Snap to shapes can be switched off in the same place',
      },
    ],
  },
  {
    id: 'eraser-lasso',
    trigger: { on: 'tool', tools: ['eraser'] },
    title: 'Erase with a loop',
    gist: 'The eraser either wipes what it passes over or removes everything inside a loop you draw. Alt swaps between the two for one stroke.',
    demo: 'lasso',
    steps: [
      {
        act: 'Choose Lasso in the eraser options, then draw a loop',
        gives: 'Everything the loop encloses is removed when you let go',
      },
      {
        act: 'Hold Alt as you press',
        gives: 'The other mode for that one stroke: the brush if Lasso is chosen, the lasso if the brush is',
      },
    ],
  },
  {
    id: 'shape-library',
    trigger: { on: 'tool', tools: ['shape'] },
    title: 'Every shape, one search away',
    gist: 'The shape seat opens a library you can search, pin and place from. Type what you are after, even loosely, and pick.',
    demo: 'shapes',
    steps: [
      {
        act: 'Open the shape library and type a few letters',
        gives: 'Matching shapes, forgiving of typos. Your pins and recent shapes sit at the top',
      },
      {
        act: 'Drag a tile onto the board',
        gives: 'The shape lands where you let go. The library stays open, so you can drag out several in a row',
      },
      {
        act: 'Hold Shift as you click a tile',
        gives: 'The tool is armed and the library stays open',
      },
      {
        act: 'Select a shape and look for small handles',
        gives: 'Shapes with a setting, such as a star’s points, show a handle on the board that you can drag',
      },
    ],
  },
  {
    id: 'line-route',
    /**
     * Both halves of the line seat, because they are one gesture.
     *
     * This listed `shape-line` alone, and the lesson's own third step is
     * "press the line key again — the same seat switches between Line and
     * Arrow". So following the instruction the card gave you dismissed the
     * card: the Arrow tool raised nothing, even though clicking once per
     * corner means exactly the same thing with it. `LINE_SEAT` is the pair.
     */
    trigger: { on: 'tool', tools: ['shape-line', 'shape-arrow'] },
    title: 'A line can turn corners',
    gist: 'Dragging gives you a straight line, which is the obvious half. Clicking once per corner gives you a route, and any segment of it can be bent into an arc afterwards.',
    demo: 'route',
    steps: [
      { act: 'Drag', gives: 'A straight line from where you pressed to where you let go' },
      {
        act: 'Click instead, once per corner, then press Enter',
        gives: 'A route with as many corners as you clicked. Backspace takes back the last one',
      },
      {
        act: 'Press the line key again',
        gives: 'The same seat in the dock switches between Line and Arrow',
      },
      {
        act: 'Double-click a finished line',
        gives: 'Its points, ready to move. Drag the small handle on a segment to bend it into an arc',
      },
    ],
  },
  {
    id: 'connector-bind',
    trigger: { on: 'tool', tools: ['connector'] },
    title: 'Grow a diagram from any shape',
    gist: 'A connector stores which two objects it joins, never a pair of coordinates, so rearranging a diagram never leaves an arrow pointing at nothing. The quickest way to make one is from the shape you are on.',
    demo: 'flow',
    steps: [
      {
        act: 'Select a shape or note and bring the pointer near it',
        gives: 'A magnet on each side. Click one for a connected copy on that side, with the line already routed',
      },
      {
        act: `Press ${chord('quickNext')} with it selected`,
        gives: 'The next shape in the direction the diagram is flowing, already connected. Keep pressing to build a chain',
      },
      {
        act: `Press ${chord('quickBack')}`,
        gives: 'Selection steps back to the shape that leads into this one',
      },
      {
        act: 'Click one object, then the other, with the connector tool',
        gives: 'An arrow between them that survives either one being moved or resized',
      },
      {
        act: 'Drop an end in the middle of an object, or on its edge',
        gives: 'In the middle it picks whichever side is shortest as things move. On the edge it stays on that exact point',
      },
      {
        act: 'Double-click a connector',
        gives: 'A label that sits on the line. Elbow and curved lines route around other objects, and the small handles on a segment move it',
      },
    ],
  },
  {
    id: 'forces',
    trigger: { on: 'tool', tools: FORCE_IDS },
    title: 'The board can be pushed around',
    gist: 'Play mode runs a real simulation on your objects. A force is a field you hold over it, and stopping puts everything back exactly where it was.',
    demo: 'field',
    steps: [
      {
        act: `Press ${chord('physicsPlay')}`,
        gives: 'Physics starts with the last force you used. Pick another from the bar that opens',
      },
      {
        act: 'Press Play, then hold a force over the board',
        gives: 'Objects move under the field for as long as you hold it',
      },
      {
        act: 'Watch the ring under the cursor',
        gives: 'That circle is exactly how far the field reaches. Nothing outside it moves',
      },
      {
        act: 'Turn on Only the selection',
        gives: 'The field passes straight through everything else, which stays where it is',
      },
      {
        act: 'Switch from Hold to Latch and click once',
        gives: 'The field keeps running on its own for a few seconds. Escape stops it',
      },
      { act: 'Press Stop', gives: 'The layout you started with, restored' },
    ],
  },
  {
    id: 'image-reframe',
    trigger: { on: 'tool', tools: ['image'] },
    title: 'A picture can be reframed in place',
    gist: 'Going inside a picture is a double-click, and what happens next depends on who owns its edges.',
    demo: 'reframe',
    steps: [
      {
        act: 'Double-click a picture on the board',
        gives: 'Crop handles. Drag them to change what is kept, or drag the picture under them',
      },
      {
        act: 'Double-click one that sits in a grid module',
        gives: 'The module holds still and the picture moves inside it. Scroll to zoom where the pointer is',
      },
      { act: 'Press Escape', gives: 'Back to exactly the framing you started the gesture with' },
    ],
  },
  {
    id: 'sticky-chain',
    trigger: { on: 'tool', tools: ['sticky'] },
    title: 'One note, then eight more',
    gist: 'Thinking out loud is never one note. Press Tab while you type and the next note appears beside it, already open.',
    demo: 'chain',
    steps: [
      {
        act: `Press ${chord('chainRight')} while typing a note`,
        gives: 'The next note, beside it, with the caret in it. Five across, then a new row',
      },
      {
        act: `Press ${chord('chainDown')}`,
        gives: 'The next note goes below instead. Colour and size carry, so a train of thought looks like one',
      },
      {
        act: `Press ${chord('finishNote')}`,
        gives: 'Finishes this note and opens the next, the same as Tab, for when Tab is busy',
      },
      {
        act: 'Select notes and press 1 to 8',
        gives: 'They take that colour, all at once',
      },
      {
        act: `Select several and press ${chord('organiseByTheme')}`,
        gives: `Notes of one colour gather into a column. Add Shift (${chord('organiseByAuthor')}) to gather by who wrote them`,
      },
      { act: 'Press Escape', gives: 'Out of the note and back to the board' },
    ],
  },
  {
    id: 'pen-anchors',
    trigger: { on: 'tool', tools: ['bezier-pen'] },
    title: 'Curves come from dragging, not from clicking',
    gist: 'A click places a corner. Pressing and dragging places a smooth point and pulls its handles out as you go, which is the whole difference between a polygon and a curve.',
    demo: 'pen',
    steps: [
      { act: 'Click', gives: 'A corner point' },
      { act: 'Press and drag', gives: 'A smooth point, with the curve bending to follow your drag' },
      { act: 'Press Backspace mid-run', gives: 'The last point taken back, not the whole path' },
      {
        act: 'Click the first point again, or press Enter',
        gives: 'Closed, or finished as an open run',
      },
    ],
  },
  {
    id: 'direct-select',
    trigger: { on: 'tool', tools: ['direct-select'] },
    title: 'Inside a shape, not around it',
    gist: 'The arrow moves an object. This one edits what the object is made of.',
    demo: 'anchors',
    steps: [
      { act: 'Click a path, or double-click it with the arrow', gives: 'Its points, each one pickable on its own' },
      { act: 'Drag across points', gives: 'All of them picked, in a box you can drag, scale or turn' },
      { act: 'Drag a handle', gives: 'The curve either side of its point, reshaped' },
      { act: 'Press Enter or Esc', gives: 'Done: the path stays selected and the arrow comes back' },
    ],
  },
  {
    id: 'text-box',
    trigger: { on: 'tool', tools: ['text'] },
    title: 'Three ways a text box can size itself',
    gist: 'Whether the box follows the words or the words follow the box is a setting, and it changes what dragging a corner means.',
    demo: 'sizing',
    steps: [
      { act: 'Auto width', gives: 'The box is as wide as the longest line, and never wraps' },
      { act: 'Auto height', gives: 'It wraps at the width you set and grows downward as you type' },
      {
        act: 'Fixed',
        gives: 'Both dimensions imposed, and dragging a corner scales the type itself rather than reflowing it',
      },
    ],
  },
  {
    id: 'frame-page',
    trigger: { on: 'tool', tools: ['frame'] },
    title: 'A frame is a page, and a slide',
    gist: 'Not a group and not a box drawn around things. A frame is a region at a real size that clips what is inside it, exports on its own and presents as a slide.',
    demo: 'present',
    steps: [
      { act: 'Drag one out, or pick a preset size', gives: 'A named region at real dimensions' },
      { act: 'Put something across its edge', gives: 'The overhang is clipped, the way a page clips' },
      {
        act: `Press ${chord('present')}`,
        gives: 'The frames present in reading order, starting from the selected one. Arrow keys move between them and Escape leaves',
      },
      {
        act: `Select a frame and press ${chord('fitFrame')}`,
        gives: 'It shrinks or grows to wrap exactly what it holds',
      },
      {
        act: 'Export with several frames on the board',
        gives: 'One file each, or one document with a page each',
      },
    ],
  },
  {
    id: 'table-cells',
    trigger: { on: 'tool', tools: ['table'] },
    title: 'A table is a small spreadsheet',
    gist: 'The cells take formulas, fills and pasted blocks, so the numbers on the board can do sums rather than sit there.',
    demo: 'fill',
    steps: [
      { act: 'Drag out a table, then double-click it', gives: 'Its cells, open to type in. Paste a block from Excel or Sheets and it lands as real rows and columns' },
      {
        act: 'Drag the small square at the corner of the selected cells',
        gives: 'The cells you cover are filled from the ones you started with, carrying a series on where there is one',
      },
      {
        act: `Select a range and press ${chord('fillDown')} or ${chord('fillRight')}`,
        gives: 'Copies the first row down the range, or the first column across it',
      },
      {
        act: 'Start a cell with =, like =SUM(B2:B5)',
        gives: 'A total that recalculates as the numbers change. The formula bar above the table shows and edits it',
      },
      {
        act: `Click the caret on a column heading, or press ${chord('columnMenu')}`,
        gives: 'The column menu: sort, filter, and set what kind of column it is',
      },
      {
        act: 'Give a column a richer type',
        gives: 'Checkbox, rating, currency, date or choice, and each cell then edits as one',
      },
      {
        act: 'Select a range and choose Chart this',
        gives: 'A chart beside the table that stays linked to it',
      },
    ],
  },
  {
    id: 'comment-thread',
    trigger: { on: 'tool', tools: ['comment'] },
    title: 'Comments are pinned to the work',
    gist: 'A comment belongs to a place on the board rather than to a list beside it, so the conversation stays next to the thing it is about.',
    demo: 'thread',
    steps: [
      { act: 'Click anywhere, or on an object', gives: 'A pin, and a thread under it' },
      {
        act: 'Click on an object, then move that object',
        gives: 'The pin goes with it, so the thread is never left pointing at empty board',
      },
      { act: 'Type @ and a name', gives: 'That person, mentioned' },
      { act: 'Resolve it', gives: 'The pin goes quiet without the thread being lost' },
    ],
  },
  {
    id: 'voice-note',
    trigger: { on: 'tool', tools: ['audio'] },
    title: 'Say it instead of typing it',
    gist: 'Some feedback is a sentence and some is a tone of voice. A voice note is an object on the board like any other.',
    demo: 'voice',
    steps: [
      { act: 'Click where it should sit, and talk', gives: 'A recording with a live waveform and a timer' },
      { act: `Press ${chord('voicePause')}`, gives: 'Pauses and resumes the recording' },
      { act: `Press ${chord('voiceKeep')}`, gives: 'Keeps it as a note with a real waveform, not a placeholder' },
      { act: `Press ${chord('voiceDiscard')}`, gives: 'Throws the recording away' },
      { act: 'Click a note', gives: 'Playback, for anyone on the board. Only one plays at a time' },
    ],
  },

  /* ---------------------------------------------------------- library only */

  {
    id: 'boolean-shapes',
    trigger: { on: 'library' },
    title: 'Combine shapes, and see it before you commit',
    gist: 'Union, Subtract, Intersect and Exclude are four words for four results nobody can tell apart from the words.',
    demo: 'boolean',
    steps: [
      { act: 'Select two or more shapes', gives: 'The four operations appear on the floating toolbar' },
      {
        act: 'Hover one of them',
        gives: 'The result drawn over the shapes it would replace, so you can tell the four apart before choosing',
      },
    ],
  },
  {
    id: 'diagram-code',
    trigger: { on: 'library' },
    title: 'Diagrams go both ways',
    gist: 'A flowchart written as code becomes real, editable boxes and arrows, and a diagram you drew by hand can be read back out as code.',
    demo: 'code-shapes',
    steps: [
      { act: 'Write a flowchart in Mermaid', gives: 'Real objects on the board, not a picture of them' },
      {
        act: 'Drag one of its boxes',
        gives: 'The arrows follow, because they were joined to the box rather than drawn between two points',
      },
      { act: 'Select a diagram and copy it as Mermaid', gives: 'The same flowchart, as text you can paste anywhere' },
    ],
  },
  {
    /**
     * A link is the one object here that nothing arms a tool for — it is made
     * by pasting an address onto the board — so there is no moment at which
     * the product could raise this, and `library` is where it belongs.
     *
     * It earns a lesson because the two things worth knowing about it are both
     * invisible: that a bare URL becomes a card at all, and that the card can
     * be turned into a player in place rather than a link you leave to follow.
     */
    id: 'link-card',
    trigger: { on: 'library' },
    title: 'A pasted address becomes a card',
    gist: 'Paste a URL onto the board and it unfurls into a card with the page’s own title, summary and picture. The server fetches it, so opening a board never announces its viewers to the sites it links.',
    demo: 'unfurl',
    steps: [
      { act: 'Paste a web address onto the board', gives: 'A card that fills itself in, rather than a line of blue text' },
      {
        act: 'Double-click a video, track or Figma file',
        gives: 'It plays where it sits, instead of taking you somewhere else',
      },
      {
        act: 'Use the card’s menu to change how it sits',
        gives: 'The same link as a wide card, a tall one, or a single compact row',
      },
    ],
  },
  {
    id: 'text-to-path',
    trigger: { on: 'library' },
    title: 'Text can become a shape',
    gist: 'Real letterforms as editable vectors, counters and all, for when the type has to stop being type.',
    steps: [
      { act: 'Right-click a text object and Convert to path', gives: 'Its outlines, editable point by point' },
      {
        act: 'Watch for the note',
        gives: 'Anything a contour cannot express, such as a highlight, is named as it is dropped rather than quietly lost',
      },
    ],
  },
  {
    id: 'offline',
    trigger: { on: 'library' },
    title: 'Nothing is lost offline',
    gist: 'Keep working with the network down. Edits merge when you come back rather than one side overwriting the other.',
    steps: [
      { act: 'Lose the connection', gives: 'The board says so, once, and keeps accepting edits' },
      { act: 'Come back', gives: 'Your changes and everyone else’s, merged rather than fought over' },
    ],
  },
  {
    id: 'select-more',
    trigger: { on: 'library' },
    title: 'Select exactly what you mean',
    gist: 'A click selects the top object. Holding a key changes what a click, a hover or a shortcut reaches.',
    demo: 'select',
    steps: [
      { act: `Hold ${chord('addToSelection')} and click`, gives: 'Adds to the selection, or takes one out of it' },
      {
        act: `Hold ${chord('deepSelect')} and click`,
        gives: 'Goes straight to the object inside a group or frame, instead of the group',
      },
      {
        act: `${chord('selectBehind')}-click`,
        gives: 'Picks the object behind the one on top. Keep going to work down the stack',
      },
      {
        act: `Hold ${chord('measure')} over an object`,
        gives: 'The distance to its neighbours, drawn on the board',
      },
      {
        act: `Select one object, then press ${chord('similarFill')}`,
        gives: `Everything with the same fill joins the selection. ${chord('similarType')}, ${chord('similarStroke')} and ${chord('similarFont')} match type, stroke and font instead`,
      },
    ],
  },
  {
    id: 'cursor-chat',
    trigger: { on: 'library' },
    title: 'Say something at your pointer',
    gist: 'On a shared board you can type a short message that follows your pointer and is seen by everyone, without opening a comment.',
    demo: 'cursorchat',
    steps: [
      {
        act: `Press ${chord('cursorChat')} with the pointer over the board`,
        gives: 'A small box opens at your pointer, and everyone sees what you type as you type it',
      },
      { act: 'Press Enter', gives: 'Sends it. Escape cancels instead' },
    ],
  },
  {
    id: 'music-vinyl',
    trigger: { on: 'library' },
    title: 'The record beside your avatar',
    gist: 'A board can have a soundtrack. The record button next to your avatar opens the music panel.',
    steps: [
      { act: 'Click the record beside your avatar', gives: 'The music panel: stations of recorded tracks, and Spotify if you have connected it' },
      {
        act: 'Pick a station',
        gives: 'It plays for you. If you share what you are listening to, collaborators see it under your name',
      },
    ],
  },

  /* ---------------------------------------------------------------- recipes */

  {
    id: 'slides-deck',
    trigger: { on: 'library' },
    title: 'Build a deck, then present it',
    gist: 'Frames are slides. Slide view lays the deck out, each slide arrives with its own transition, and the show has a laser, a presenter view and a PDF at the end.',
    demo: 'slides',
    steps: [
      {
        act: `Press ${chord('slideView')}`,
        gives: 'Every frame as a slide in one grid. Arrow keys move between them and Alt with an arrow reorders them',
      },
      {
        act: 'Choose a slide and set its transition',
        gives: 'Glide, Dissolve, Smart move, Push, Slide or Zoom, or none. Smart move carries objects with the same layer name from one slide to the next',
      },
      {
        act: `Press ${chord('present')}`,
        gives: 'The show starts from the selected slide. Type a slide number and Enter to jump, B or W to blank the screen, Esc to leave',
      },
      {
        act: `Press ${chord('laser')} while presenting`,
        gives: 'Your pointer becomes a laser. Press it again to put the pointer back',
      },
      {
        act: 'Open Presenter view in the show controls',
        gives: 'Your notes, a timer and the next slide, on your screen or in a window of their own',
      },
      {
        act: 'Export the board as a PDF',
        gives: 'One page for each slide, in the order of the show',
      },
    ],
  },
  {
    id: 'grid-edit-cells',
    trigger: { on: 'library' },
    title: 'Edit a grid cell by cell',
    gist: 'Edit cells turns a grid inside out: every border can be dragged, every cell typed into, and the content follows.',
    demo: 'gridedit',
    steps: [
      { act: 'Drag a border between two tracks', gives: 'The two tracks trade space and the grid keeps its size' },
      {
        act: 'Hold Shift as you drag',
        gives: 'The track before the border takes the new size and every other track shares what is left equally',
      },
      {
        act: 'Hold Alt as you drag',
        gives: 'Only the track before the border changes, and the grid grows or shrinks to match',
      },
      {
        act: `Hold ${chord('noSnap')}`,
        gives: 'Snapping is off, so the size lands exactly where you let go. Esc cancels the drag',
      },
      { act: 'Double-click a border', gives: 'The track before it fits what it holds' },
      {
        act: 'Double-click a cell',
        gives: 'Type straight into it. In the panel, Item placement sets where the content sits in its module',
      },
    ],
  },
  {
    id: 'sketch-board',
    trigger: { on: 'library' },
    title: 'Sketch the whole board',
    gist: 'One key redraws every shape in a hand-drawn style, and the same key brings the clean lines back. Nothing about the shapes changes, only how they are drawn.',
    demo: 'sketch',
    steps: [
      {
        act: `Press ${chord('sketchBoard')}`,
        gives: 'The whole board is drawn by hand. Only people who can edit the board can switch it',
      },
      { act: 'Press it again', gives: 'Clean lines, exactly as they were' },
      {
        act: 'Choose the sketch style on a single shape',
        gives: 'Just that shape is rough while the rest stay clean',
      },
      { act: 'Export as SVG or PNG', gives: 'The hand-drawn strokes come with it' },
    ],
  },
  {
    id: 'shadows-effects',
    trigger: { on: 'library' },
    title: 'Depth with shadows',
    gist: 'A drop shadow lifts an object off the board and an inner shadow presses it in. Both live in Effects, in the properties panel.',
    demo: 'shadow',
    steps: [
      { act: 'Select an object and open Effects', gives: 'The shadow switch, with its blur, spread, offset and colour' },
      { act: 'Switch on a shadow and drag the blur', gives: 'The shadow softens as you drag, live on the board' },
      { act: 'Choose Inner', gives: 'The shadow moves inside the shape, as if it were pressed into the board' },
      { act: 'Export', gives: 'Shadows are drawn into SVG and PNG files, not dropped' },
    ],
  },
  {
    id: 'touch-gestures',
    trigger: { on: 'library' },
    title: 'Touch, and drawing with a Pencil',
    gist: 'On a tablet or a phone the board answers to the fingers you already use. One finger belongs to the tool, two or more move the board.',
    demo: 'touch',
    steps: [
      { act: 'Pinch with two fingers', gives: 'Zoom and pan together around the middle of your fingers' },
      { act: 'Press and hold', gives: 'The context menu for that spot' },
      { act: 'Tap with two fingers', gives: 'Undo' },
      { act: 'Tap with three fingers', gives: 'Redo' },
      {
        act: 'Draw with an Apple Pencil or a stylus',
        gives: 'It draws and selects. A resting palm is ignored, and once you have used a stylus a single finger pans',
      },
    ],
  },
  {
    id: 'export-files',
    trigger: { on: 'library' },
    title: 'Get it out in any shape',
    gist: 'Export takes the selection, a frame or the whole board, in the format and scale you choose.',
    steps: [
      {
        act: `Press ${chord('exportBoard')}`,
        gives: 'Export for the selection, or the board if nothing is selected: PNG, JPEG, WebP, SVG or PDF',
      },
      {
        act: 'Add several sizes in the Export section of the panel',
        gives: 'One file for each size and format, and more than one goes out together as a ZIP',
      },
      { act: 'Right-click and choose Copy as PNG or SVG', gives: 'Straight to the clipboard, ready to paste into a document' },
      { act: 'Right-click a frame and choose Copy link to frame', gives: 'A link that opens the board on exactly that frame' },
    ],
  },
  {
    id: 'template-gallery',
    trigger: { on: 'library' },
    title: 'Start from a template',
    gist: 'A template is a finished board you can take apart: real objects, real tables and live charts, not a picture of one.',
    steps: [
      {
        act: 'Browse templates from the home screen',
        gives: 'Boards sorted into Systems and architecture, Product and teams, Diagrams, Web and UI, Data and dashboards, Science, Physics, Slides and Illustration',
      },
      { act: 'Open one', gives: 'A board you can change freely, with every object ready to edit' },
    ],
  },
  {
    id: 'version-history',
    trigger: { on: 'library' },
    title: 'Go back in time',
    gist: 'The board remembers how it was made. Scrub through its history, then restore a moment or leave it as it is.',
    steps: [
      { act: 'Search for Version history in the command palette', gives: 'A timeline of the board, with the live board kept as it is' },
      { act: 'Step with the arrow keys, or press K or Space to play', gives: 'The board replays edit by edit. Home and End jump to the start and the end' },
      { act: 'Restore a version', gives: 'The board returns to that moment' },
    ],
  },
  {
    id: 'collab-cursors',
    trigger: { on: 'library' },
    title: 'Everyone is on the board',
    gist: 'Each person has a coloured pointer with their name on it, and what they select or drag is outlined in the same colour.',
    demo: 'cursors',
    steps: [
      { act: 'Open the same board as someone else', gives: 'Their pointer appears, moving as they move, with a name tag' },
      { act: 'Watch someone pick up an object', gives: 'It is outlined in their colour, so two people rarely reach for the same thing' },
      { act: 'Look to the edge of the board', gives: 'A marker points toward people who are working off screen' },
    ],
  },
  {
    id: 'collab-follow',
    trigger: { on: 'library' },
    title: 'Follow someone’s view',
    gist: 'Click a face and your board moves with theirs, inside a frame in their colour, so you always know whose view you are in.',
    demo: 'follow',
    steps: [
      { act: 'Click a person’s face in the avatar row', gives: 'Your view tracks theirs, pans and zooms included' },
      { act: 'Move the board, click the face again or press Esc', gives: 'You are back in charge of your own view' },
      { act: 'Look at the person you followed', gives: 'They are told how many people are following them' },
    ],
  },
  {
    id: 'collab-spotlight',
    trigger: { on: 'library' },
    title: 'Present to the whole room',
    gist: 'While you present, you can invite everyone to follow. It is an invitation, never a pull: nobody’s view moves until they say so.',
    demo: 'spotlight',
    steps: [
      { act: `Press ${chord('present')}, then choose Invite everyone to follow`, gives: 'People on the board are asked to come along' },
      { act: 'On the other side, choose Follow', gives: 'Your view glides to theirs, inside a frame in their colour' },
      { act: 'Choose Dismiss instead', gives: 'You stay exactly where you are' },
    ],
  },
  {
    id: 'collab-ping',
    trigger: { on: 'library' },
    title: 'Point at something',
    gist: 'A ping is a ripple on the board that everyone sees at once, with your name on it. It leaves nothing behind.',
    demo: 'ping',
    steps: [
      { act: `Hold ${chord('pingMods')} and click`, gives: 'A ripple at that spot, in your colour, seen by everyone on the board' },
      { act: 'Wait a moment', gives: 'It fades by itself. Nothing is added to the board' },
    ],
  },
  {
    id: 'collab-reactions',
    trigger: { on: 'library' },
    title: 'Cheer a presentation',
    gist: 'People watching a show can send a reaction, and it floats up on the presenter’s screen without interrupting them.',
    demo: 'reactions',
    steps: [
      { act: 'While someone presents, tap a reaction', gives: 'It rises on the presenter’s screen and fades' },
      { act: 'Send several', gives: 'They gather into a small crowd' },
    ],
  },
  {
    id: 'collab-share',
    trigger: { on: 'library' },
    title: 'Share with the right role',
    gist: 'A link carries a role. Edit, comment and view links are signed by the server, so nobody can turn one into another.',
    demo: 'share',
    steps: [
      { act: 'Open Share and choose a role', gives: 'Edit, Comment or View. The server enforces it, so a view link really cannot edit' },
      { act: 'Copy the link', gives: 'Anyone who opens it arrives as a live pointer on the board' },
      { act: 'Set an expiry on a comment or view link', gives: 'The link stops working when it runs out' },
    ],
  },
  {
    id: 'recipe-flowchart',
    trigger: { on: 'library' },
    recipe: true,
    title: 'Flowchart in 60 seconds',
    gist: 'Grow each step from the last with the keyboard, then drag one around and watch the lines re-route.',
    demo: 'flow',
    steps: [
      { act: 'Draw a shape and leave it selected', gives: 'Your first step' },
      {
        act: `Press ${chord('quickNext')}`,
        gives: 'The next step appears beside it, already joined by a connector',
      },
      {
        act: `Press ${chord('quickNext')} twice more`,
        gives: 'A chain of steps, each connected to the one before',
      },
      {
        act: 'Drag one step somewhere else',
        gives: 'The arrows follow and route around whatever is in the way',
      },
    ],
  },
  {
    id: 'recipe-live-chart',
    trigger: { on: 'library' },
    recipe: true,
    title: 'Live chart from a table',
    gist: 'Type the numbers once, in a table, and let a chart read them. Change a number later and the chart redraws.',
    demo: 'chartlive',
    steps: [
      { act: 'Drag out a table and type a few numbers', gives: 'Rows and columns you edit like a sheet' },
      {
        act: 'Select the numbers and choose Chart this',
        gives: 'A chart beside the table, linked to that range',
      },
      {
        act: 'Select the chart',
        gives: 'Drag a bar to change its value, double-click the title to rename it, Alt-click a legend entry to show one series alone',
      },
    ],
  },
  {
    id: 'recipe-bento',
    trigger: { on: 'library' },
    recipe: true,
    title: 'Bento layout with Arrange in grid',
    gist: 'Make the pieces first, in any order and any size, then let a grid gather them.',
    demo: 'arrange',
    steps: [
      { act: 'Draw four or five shapes', gives: 'Any size, anywhere. They are the pieces of the layout' },
      { act: 'Select them all', gives: 'Drag a box round them, or hold Shift and click each one' },
      {
        act: `Press ${chord('arrangeInGrid')}`,
        gives: `They snap into a live grid with a cell each. Double-click the grid, select two cells and press ${chord('mergeCells')} to merge them`,
      },
    ],
  },
  {
    id: 'recipe-retro',
    trigger: { on: 'library' },
    recipe: true,
    title: 'Run a retro with stickies',
    gist: 'Write fast, sort by colour, and put some music on from the record beside your avatar.',
    demo: 'chain',
    steps: [
      {
        act: `Write a note, press ${chord('chainRight')}, and write another`,
        gives: 'Each note opens the next beside it',
      },
      {
        act: 'Add a few more, then select them',
        gives: 'Press 1 to 8 to give the selection a colour. One colour per column of the retro works well',
      },
      {
        act: `Press ${chord('organiseByTheme')}`,
        gives: 'Notes of one colour gather into a column, ready to talk through',
      },
    ],
  },
  {
    id: 'recipe-present',
    trigger: { on: 'library' },
    recipe: true,
    title: 'Present frames as slides',
    gist: 'Each frame is a slide, shown in reading order. Fit the frames to their content first so nothing is cut off.',
    demo: 'present',
    steps: [
      { act: 'Draw two frames side by side', gives: 'Each one is a slide.' },
      { act: 'Put something inside each frame', gives: 'Anything inside a frame belongs to that slide' },
      {
        act: `Select a frame and press ${chord('fitFrame')}`,
        gives: 'The frame wraps exactly what it holds',
      },
      {
        act: `Press ${chord('present')}`,
        gives: 'The slides play from the selected frame. Arrow keys move between them and Escape leaves',
      },
    ],
  },
];

/** Every lesson, by id, for the one place that needs to look one up. */
const BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

export const lessonById = (id: string): Lesson | undefined => BY_ID.get(id);

/**
 * The lesson a tool raises, if it has one.
 *
 * Built as a map at module load rather than searched per call: the lookup
 * runs on every tool change, and a linear scan over fifteen lessons on a
 * keystroke is the kind of thing that is free until the day it is not.
 */
const BY_TOOL = new Map<string, Lesson>();
for (const lesson of LESSONS) {
  if (lesson.trigger.on !== 'tool') continue;
  for (const tool of lesson.trigger.tools) BY_TOOL.set(tool, lesson);
}

export const lessonForTool = (toolId: string): Lesson | undefined => BY_TOOL.get(toolId);

/**
 * The key that arms a lesson's tool, or nothing.
 *
 * Asked of `TOOL_SHORTCUTS` rather than written down, because a lesson that
 * names its own key is the exact failure `toolNames.ts` opens by warning about:
 * the one place a person goes when they are already unsure is the place least
 * likely to be updated when a binding changes.
 *
 * A lesson with several tools -- the six force fields share one -- has no
 * single key, and says nothing rather than picking one of six.
 */
export function keyFor(lesson: Lesson): string | undefined {
  if (lesson.trigger.on !== 'tool' || lesson.trigger.tools.length === 0) return undefined;

  /**
   * One key, however many tools share it.
   *
   * The rule used to be "exactly one tool", which was the same thing while
   * every lesson named one. It stopped being the same thing when the line
   * lesson took both halves of its seat: `shape-line` and `shape-arrow` are
   * two tools on one key, and requiring a single tool made the lesson that
   * teaches that seat the one lesson unable to say which key opens it.
   *
   * The six force fields still get nothing, which is the case this guard was
   * written for: they share no key, so there is no single answer and picking
   * one of six would be worse than silence.
   */
  const keys = new Set(
    lesson.trigger.tools.map((tool) => TOOL_SHORTCUTS[tool]).filter(Boolean)
  );
  return keys.size === 1 ? [...keys][0] : undefined;
}
