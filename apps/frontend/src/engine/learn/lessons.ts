import { TOOL_SHORTCUTS } from '../tools/shortcuts';
import { FORCE_IDS } from '../physics/forces';

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
 * The ones still without a scene fail the test in the other direction. A
 * comment is a pin and a thread, a voice note is a waveform, a frame is a box:
 * the words already put the right picture in your head, so a drawing would only
 * confirm it. `offline` has no gesture at all.
 */
export type DemoId =
  | 'route'
  | 'fill-grid'
  | 'reframe'
  | 'bind'
  | 'field'
  | 'chain'
  | 'boolean'
  | 'pen'
  | 'sizing'
  | 'unfurl'
  | 'code-shapes';

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
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'grid-content',
    trigger: { on: 'tool', tools: ['grid'] },
    title: 'A grid can hold your pictures',
    gist: 'The modules are not decoration. Put pictures or captions in them and they fill each one edge to edge, then follow it when you change the arrangement.',
    demo: 'fill-grid',
    steps: [
      {
        act: 'Drop image files straight onto a module',
        gives: 'Each picture fills it edge to edge, cropped to fit rather than squashed to fit',
      },
      {
        act: 'Select some pictures and a grid, then Place in grid',
        gives: 'They are dealt across the empty modules in the order you picked them',
      },
      {
        act: 'Double-click a picture in a module',
        gives: 'Drag to move it inside its frame, scroll to zoom in on part of it',
      },
      {
        act: 'Double-click an empty module',
        gives: 'A caption, already sized and clipped to that module',
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
    gist: 'The numbers behind a chart are a real sheet. Select a range, paste a block in from Excel or Sheets, and watch the chart redraw beside them as you type.',
    steps: [
      {
        act: 'Place a chart, then double-click it',
        gives: 'Its data as a spreadsheet, with the chart live beside it',
      },
      {
        act: 'Paste a block copied from Excel or Sheets',
        gives: 'Real rows and columns, not one cell of text. A single value pasted over a range fills it',
      },
      {
        act: 'Select some numbers',
        gives: 'Their sum, average, count, smallest and largest, along the bottom',
      },
      {
        act: 'Leave a cell empty rather than typing 0',
        gives: 'A gap in the line. A missing reading is not a measured nought, and the chart draws the difference',
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
    title: 'An arrow that follows what it joins',
    gist: 'A connector stores which two objects it joins, never a pair of coordinates, so rearranging a diagram never leaves an arrow pointing at nothing.',
    demo: 'bind',
    steps: [
      {
        act: 'Click one object, then the other',
        gives: 'An arrow between them that survives either one being moved or resized',
      },
      {
        act: 'Drop an end in the middle of an object',
        gives: 'It binds to the object, and the route picks whichever side is shortest as things move',
      },
      {
        act: 'Drop an end on the edge instead',
        gives: 'It binds to that exact point and stays on it',
      },
      { act: 'Select a connector and drag either end', gives: 'The same aim, taken again' },
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
    gist: 'Thinking out loud is never one note. Tab out of the one you are typing and the next appears beside it, already open.',
    demo: 'chain',
    steps: [
      { act: 'Press Tab while typing a note', gives: 'The next note, beside it, with the caret in it' },
      {
        act: 'Keep going',
        gives: 'Five across, then a new row. The colour and size carry, so a train of thought looks like one',
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
    steps: [
      { act: 'Click a path', gives: 'Its anchors, each one draggable on its own' },
      { act: 'Drag an anchor handle', gives: 'The curve either side of it, reshaped' },
      {
        act: 'Click anything else',
        gives: 'Ordinary selection, so the tool is never inert on half the board',
      },
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
    title: 'A frame is a page',
    gist: 'Not a group and not a box drawn around things. A frame is a region at a real size that clips what is inside it and exports on its own.',
    steps: [
      { act: 'Drag one out, or pick a preset size', gives: 'A named region at real dimensions' },
      { act: 'Put something across its edge', gives: 'The overhang is clipped, the way a page clips' },
      {
        act: 'Export with several frames on the board',
        gives: 'One file each, or one document with a page each',
      },
    ],
  },
  {
    id: 'comment-thread',
    trigger: { on: 'tool', tools: ['comment'] },
    title: 'Comments are pinned to the work',
    gist: 'A comment belongs to a place on the board rather than to a list beside it, so the conversation stays next to the thing it is about.',
    steps: [
      { act: 'Click anywhere, or on an object', gives: 'A pin, and a thread under it' },
      { act: 'Type @ and a name', gives: 'That person, mentioned' },
      { act: 'Resolve it', gives: 'The pin goes quiet without the thread being lost' },
    ],
  },
  {
    id: 'voice-note',
    trigger: { on: 'tool', tools: ['audio'] },
    title: 'Say it instead of typing it',
    gist: 'Some feedback is a sentence and some is a tone of voice. A voice note is an object on the board like any other.',
    steps: [
      { act: 'Click where it should sit, and talk', gives: 'A note with a real waveform, not a placeholder' },
      { act: 'Click it', gives: 'Playback, for anyone on the board' },
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
