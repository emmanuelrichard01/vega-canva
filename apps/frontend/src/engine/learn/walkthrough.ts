import { LESSONS, lessonById, type Lesson, type LessonStep } from './lessons';
import { localVertices } from '../model/lineEnds';
import type { AnyNode, NodeType } from '../model/schema';

/**
 * A lesson you perform rather than read.
 *
 * ## What this is, next to the two teaching surfaces that already exist
 *
 * `tour.ts` is about **nouns**: this is the dock, that rail is the layer list.
 * It runs once, near the beginning, and it advances with a Next button because
 * there is nothing to do — locating a panel is not a gesture.
 *
 * `lessons.ts` is about **verbs**, and `LessonCoach` shows one as a card: the
 * gist, then every step at once, as prose. That is the right shape for
 * reference and the wrong shape for learning a gesture, because reading "click
 * once per corner, then press Enter" is not the same as having done it, and
 * the card retires on *any* new object — so it counts a rectangle as proof
 * that you learned to route a line.
 *
 * A walkthrough is the third thing and the one the brief actually asked for:
 * one step at a time, anchored to the board, **advancing only when the gesture
 * it describes has actually been performed.** No Next button, because a wizard
 * is the thing people dismiss, and because a Next button would let somebody
 * finish a walkthrough having done none of it.
 *
 * ## Why it holds no words of its own
 *
 * `lessons.ts` opens by arguing that a second body of teaching text about the
 * same gestures will drift from the first, and that teaching text is
 * especially prone to it because nobody updates the tutorial when they change
 * the gesture. Writing a walkthrough's copy here would be exactly that mistake
 * committed by the module that quotes it.
 *
 * So a walkthrough is a **reference into a lesson**: the lesson id, and for
 * each of its steps an index into that lesson's own `steps` array. The words
 * come from `lessons.ts` at read time. `walkthrough.test.ts` fails if an index
 * points past the end of the lesson it names, which is the failure mode this
 * shape has and the compiler cannot see.
 *
 * ## Why the observations are data, not functions
 *
 * A step advances when its `Observation` holds. It would be shorter to store a
 * predicate per step, and the result would be untestable in the way that
 * matters: you could not enumerate what the product claims to be able to
 * notice, and a predicate that never fires looks exactly like one whose
 * gesture nobody performed. As data, every observation in the table is checked
 * by one function that is itself covered, and a walkthrough that cannot be
 * completed is a test failure rather than a person stuck on step two.
 *
 * `LessonCoach` rejected per-tool success reporting -- "sixteen call sites to
 * keep in step" -- and it was right to. Nothing here asks a tool to report
 * anything: every observation is a question about the document, answered by
 * comparing it against a digest taken when the step began. A tool that grows a
 * new gesture cannot forget to tell this module, because it was never telling
 * it anything.
 */

/* --------------------------------------------------------------- observing */

/**
 * What proves a step's gesture was performed.
 *
 * Deliberately few, and every one of them a fact the document holds rather
 * than an event a component fires. The rule for adding one: it must be
 * checkable from a snapshot, and it must be something the step's own words
 * actually ask for. An observation looser than its step -- "any new object",
 * which is what the coach mark uses -- passes for the wrong gesture and
 * teaches nothing, and that is the specific weakness this replaces.
 */
export type Observation =
  /** A node of this type that was not there when the step began. */
  | { of: 'created'; type: NodeType }
  /** A new line or path with at least this many vertices. Proves a route. */
  | { of: 'vertices'; min: number }
  /** A new connector with both ends bound to an object. */
  | { of: 'connected' }
  /** Some node that has joined a frame since the step began. */
  | { of: 'framed' }
  /** At least this many objects selected right now. */
  | { of: 'selected'; min: number };

/**
 * What the board looked like when a step began.
 *
 * A digest rather than the objects map itself. Holding the map would work --
 * `useStore` replaces it on every change, so a kept reference is a genuine
 * point-in-time value -- but it would also pin every node of a five-hundred
 * object board in memory for as long as somebody leaves a walkthrough open,
 * to answer two questions about ids.
 */
export interface Digest {
  /** Every id present when the step began. */
  ids: ReadonlySet<string>;
  /** Of those, the ones that already belonged to a frame. */
  framed: ReadonlySet<string>;
}

export interface Snapshot {
  objects: Readonly<Record<string, AnyNode>>;
  selected: readonly string[];
}

export function digest(objects: Readonly<Record<string, AnyNode>>): Digest {
  const ids = new Set<string>();
  const framed = new Set<string>();
  for (const [id, node] of Object.entries(objects)) {
    ids.add(id);
    if (node.frameId) framed.add(id);
  }
  return { ids, framed };
}

/** The nodes that have appeared since the digest was taken. */
function fresh(now: Snapshot, before: Digest): AnyNode[] {
  return Object.entries(now.objects)
    .filter(([id]) => !before.ids.has(id))
    .map(([, node]) => node);
}

/**
 * Whether the gesture has happened.
 *
 * Pure, and the only place an observation is interpreted, so the vocabulary
 * cannot mean one thing in the table and another on the board.
 */
export function satisfied(observe: Observation, before: Digest, now: Snapshot): boolean {
  switch (observe.of) {
    case 'created':
      return fresh(now, before).some((n) => n.type === observe.type);

    case 'vertices':
      /**
       * Counted through `localVertices`, which is the one reader of all three
       * storage forms a line has -- the run, the two-point pair, and the
       * legacy corner-to-corner box. Counting `geometry.vertices` directly
       * would answer correctly for a route and return zero for every line
       * drawn before routes existed, which is the disagreement that module
       * exists to prevent.
       */
      return fresh(now, before).some(
        (n) =>
          (n.type === 'shape' || n.type === 'path') &&
          localVertices(n as Parameters<typeof localVertices>[0]).length >= observe.min
      );

    case 'connected':
      // Both ends bound to something. A connector with one loose end is a
      // connector that was drawn, not one that was *attached*, and the step
      // that asks for this is teaching the difference.
      return fresh(now, before).some(
        (n) => n.type === 'connector' && Boolean(n.from?.nodeId) && Boolean(n.to?.nodeId)
      );

    case 'framed':
      // Something that has joined a frame, whether it was made inside one or
      // dragged into one. Both satisfy the step's words, and the document
      // records them identically.
      return Object.entries(now.objects).some(
        ([id, node]) => Boolean(node.frameId) && !before.framed.has(id)
      );

    case 'selected':
      return now.selected.length >= observe.min;
  }
}

/* ------------------------------------------------------------ the sequences */

export interface WalkStep {
  /**
   * Which of the lesson's own steps this is. The words live there.
   *
   * Not every lesson step earns a walkthrough step: some describe a *result*
   * rather than a gesture ("Five across, then a new row"), and some cannot be
   * observed at all. Those are skipped rather than restated here, which is why
   * this is an index and not a range.
   */
  step: number;
  observe: Observation;
}

export interface Walkthrough {
  /** The lesson whose words this performs. */
  lesson: string;
  /** The tool it arms when it starts. */
  tool: string;
  steps: readonly WalkStep[];
}

/**
 * The walkthroughs, in the order the reference offers them.
 *
 * ## What earns one
 *
 * A stricter test than a lesson's. A lesson earns its place if the gesture is
 * unguessable; a walkthrough additionally needs every step to be **observable
 * from the document**, because a step that cannot detect its own completion
 * has no way to advance and would strand somebody mid-sequence. That is why
 * there are fewer of these than there are lessons, and why the ones about
 * looking rather than making -- the force fields, reframing a picture -- are
 * not here. They are real lessons and they stay in the coach mark and the
 * reference; they are not sequences you can be walked through, because
 * nothing they produce is a fact the board holds afterwards.
 *
 * `image-reframe` is the clearest case and worth naming: "drag the picture
 * under the crop handles" changes a `crop` field, which is observable -- but
 * the step before it needs a picture already on the board, and a walkthrough
 * that opens by asking somebody to go and find a photograph is a walkthrough
 * that most people abandon on step one.
 */
export const WALKTHROUGHS: readonly Walkthrough[] = [
  {
    // The one the brief names: you learn connectors by dragging a box.
    lesson: 'connector-bind',
    tool: 'connector',
    steps: [
      { step: 0, observe: { of: 'connected' } },
      { step: 3, observe: { of: 'selected', min: 1 } },
    ],
  },
  {
    lesson: 'line-route',
    tool: 'shape-line',
    steps: [
      { step: 0, observe: { of: 'created', type: 'shape' } },
      // Three vertices is the smallest run that has actually turned a corner,
      // which is the whole claim the step makes. Two would pass for the drag
      // taught by the step above it.
      { step: 1, observe: { of: 'vertices', min: 3 } },
    ],
  },
  {
    lesson: 'sticky-chain',
    tool: 'sticky',
    steps: [
      { step: 0, observe: { of: 'created', type: 'sticky' } },
      // The second note is the lesson. One note proves the tool works; the
      // chain is the thing nobody guesses.
      { step: 1, observe: { of: 'created', type: 'sticky' } },
    ],
  },
  {
    lesson: 'frame-page',
    tool: 'frame',
    steps: [
      { step: 0, observe: { of: 'created', type: 'frame' } },
      { step: 1, observe: { of: 'framed' } },
    ],
  },
  {
    lesson: 'pen-anchors',
    tool: 'bezier-pen',
    steps: [
      { step: 0, observe: { of: 'created', type: 'path' } },
      { step: 3, observe: { of: 'created', type: 'path' } },
    ],
  },
];

const BY_LESSON = new Map(WALKTHROUGHS.map((w) => [w.lesson, w]));

/** The walkthrough for a lesson, if that lesson has one. */
export const walkthroughFor = (lessonId: string): Walkthrough | undefined =>
  BY_LESSON.get(lessonId);

/** Whether a lesson can be performed as well as read. */
export const isWalkable = (lessonId: string): boolean => BY_LESSON.has(lessonId);

/** The lesson a walkthrough performs. Undefined only if the table is wrong. */
export const lessonOf = (walk: Walkthrough): Lesson | undefined => lessonById(walk.lesson);

/**
 * The words for one step, taken from the lesson rather than held here.
 *
 * Returns undefined rather than throwing for an index the lesson does not
 * have. A walkthrough is teaching furniture: if the table and the lesson fall
 * out of step, the sequence should end quietly rather than take the board down
 * with it. The test is what stops it getting that far.
 */
export function stepCopy(walk: Walkthrough, index: number): LessonStep | undefined {
  const lesson = lessonById(walk.lesson);
  const at = walk.steps[index];
  if (!lesson || !at) return undefined;
  return lesson.steps[at.step];
}

/** Every lesson that has no walkthrough, for the test that explains why. */
export const unwalkable = (): readonly string[] =>
  LESSONS.filter((l) => !BY_LESSON.has(l.id)).map((l) => l.id);
