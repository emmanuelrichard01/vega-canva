import { describe, expect, it } from 'vitest';
import {
  digest,
  isWalkable,
  lessonOf,
  satisfied,
  stepCopy,
  unwalkable,
  WALKTHROUGHS,
  walkthroughFor,
  type Observation,
  type Snapshot,
} from './walkthrough';
import { LESSONS, lessonById } from './lessons';
import { TOOL_SHORTCUTS } from '../tools/shortcuts';
import type { AnyNode } from '../model/schema';

/**
 * The walkthroughs, which hold no words of their own and must not start to.
 *
 * Two classes of failure are being guarded here and they are different.
 *
 * The first is the one this shape *introduces*: a walkthrough names a lesson
 * and indexes into its steps, so renaming a lesson or removing one of its
 * steps breaks a reference the compiler cannot see. That is the price of not
 * copying the copy, and it is worth paying only if something checks it.
 *
 * The second is the one it *inherits* from being a sequence that advances by
 * itself: a step whose observation can never be satisfied strands somebody
 * mid-walkthrough with no way forward and no Next button to rescue them. A
 * walkthrough that cannot be completed has to be a test failure, because on
 * the board it is indistinguishable from a person who has not tried yet.
 */

const node = (id: string, over: Partial<AnyNode> = {}): AnyNode =>
  ({ id, type: 'shape', x: 0, y: 0, width: 10, height: 10, ...over }) as unknown as AnyNode;

const snap = (objects: AnyNode[], selected: string[] = []): Snapshot => ({
  objects: Object.fromEntries(objects.map((n) => [n.id, n])),
  selected,
});

const empty = digest({});

/* --------------------------------------------------------------- the table */

describe('a walkthrough refers to a lesson rather than restating it', () => {
  it('names a lesson that exists', () => {
    for (const walk of WALKTHROUGHS) {
      expect(lessonById(walk.lesson), `no lesson "${walk.lesson}"`).toBeDefined();
      expect(lessonOf(walk)).toBeDefined();
    }
  });

  it('indexes only steps the lesson actually has', () => {
    // The reference this shape introduces, and the one nothing else can catch:
    // a lesson losing a step leaves a walkthrough pointing past the end of it.
    for (const walk of WALKTHROUGHS) {
      const lesson = lessonById(walk.lesson)!;
      walk.steps.forEach((at, i) => {
        expect(at.step, `${walk.lesson}[${i}]`).toBeLessThan(lesson.steps.length);
        expect(stepCopy(walk, i), `${walk.lesson}[${i}] has no words`).toBeDefined();
      });
    }
  });

  it('arms a tool that is really bound', () => {
    // `toolNames.ts` documents four places where a hard-coded shortcut went
    // stale. A walkthrough that arms a tool the dock does not have is the same
    // failure wearing a different hat.
    for (const walk of WALKTHROUGHS) {
      if (!walk.tool) continue;
      expect(TOOL_SHORTCUTS[walk.tool], `"${walk.tool}" is not a tool`).toBeDefined();
    }
  });

  it('arms the tool its own lesson is triggered by', () => {
    // Otherwise picking up the tool raises a coach mark for one lesson while
    // the walkthrough beside it teaches another -- two surfaces disagreeing
    // about what you are doing.
    for (const walk of WALKTHROUGHS) {
      if (!walk.tool) continue;
      const trigger = lessonById(walk.lesson)!.trigger;
      expect(trigger.on, walk.lesson).toBe('tool');
      if (trigger.on === 'tool') {
        expect(trigger.tools, walk.lesson).toContain(walk.tool);
      }
    }
  });

  it('arms a tool for every walkthrough that begins on the board', () => {
    /**
     * The other half of the rule above, and the one that was missing while
     * `tool` was read by nothing: a walkthrough whose first step is a gesture
     * on the canvas must arm the tool that gesture needs, or its opening
     * instruction has a silent prerequisite.
     *
     * A lesson triggered by a tool is, by definition, one of those. A
     * `library` lesson begins in a dialog and correctly arms nothing.
     */
    for (const walk of WALKTHROUGHS) {
      const trigger = lessonById(walk.lesson)!.trigger;
      if (trigger.on !== 'tool') continue;
      expect(walk.tool, `${walk.lesson} begins on the board and arms nothing`).toBeTruthy();
    }
  });

  it('has at least two steps, or it is a coach mark with extra machinery', () => {
    for (const walk of WALKTHROUGHS) {
      expect(walk.steps.length, walk.lesson).toBeGreaterThanOrEqual(2);
    }
  });

  it('offers each lesson at most once', () => {
    const ids = WALKTHROUGHS.map((w) => w.lesson);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the rest to the coach mark, which is not a gap', () => {
    // Named rather than counted, so adding a lesson does not silently change
    // what this test claims. Every id here is a lesson that is real teaching
    // and not a performable sequence -- see the note on WALKTHROUGHS.
    expect([...unwalkable()].sort()).toEqual(
      [
        'boolean-shapes',
        // Its steps are a paste and a selection stat — neither is a fact the
        // document holds afterwards, and the opener would need somebody to go
        // and find a spreadsheet, which is why `image-reframe` is here too.
        'chart-data',
        'comment-thread',
        'direct-select',
        'forces',
        'grid-content',
        'image-reframe',
        'offline',
        'text-box',
        'text-to-path',
        'voice-note',
      ].sort()
    );
  });

  it('finds a walkthrough by lesson, and knows when there is none', () => {
    expect(walkthroughFor('connector-bind')?.tool).toBe('connector');
    expect(walkthroughFor('offline')).toBeUndefined();
    expect(isWalkable('line-route')).toBe(true);
    expect(isWalkable('offline')).toBe(false);
  });
});

/* -------------------------------------------------------- the observations */

describe('created', () => {
  const observe: Observation = { of: 'created', type: 'sticky' };

  it('holds for a node that was not there when the step began', () => {
    expect(satisfied(observe, empty, snap([node('a', { type: 'sticky' })]))).toBe(true);
  });

  it('ignores one that was already there', () => {
    // The whole reason a digest is taken at the *start of the step*: a board
    // that already has sticky notes on it must not advance the step that asks
    // you to make one.
    const before = digest({ a: node('a', { type: 'sticky' }) });
    expect(satisfied(observe, before, snap([node('a', { type: 'sticky' })]))).toBe(false);
  });

  it('ignores a new node of the wrong type', () => {
    // The looseness this replaces: the coach mark retires on *any* new object,
    // so drawing a rectangle counted as having learned to chain sticky notes.
    expect(satisfied(observe, empty, snap([node('a', { type: 'shape' })]))).toBe(false);
  });
});

describe('vertices', () => {
  const route: Observation = { of: 'vertices', min: 3 };

  it('holds for a run that has actually turned a corner', () => {
    const line = node('a', {
      geometry: { kind: 'line', vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] },
    } as Partial<AnyNode>);
    expect(satisfied(route, empty, snap([line]))).toBe(true);
  });

  it('does not hold for the two-point drag taught by the step before it', () => {
    const line = node('a', { geometry: { kind: 'line' } } as Partial<AnyNode>);
    expect(satisfied(route, empty, snap([line]))).toBe(false);
  });
});

describe('connected', () => {
  const observe: Observation = { of: 'connected' };
  const conn = (from?: string, to?: string) =>
    node('c', {
      type: 'connector',
      from: from ? { nodeId: from } : {},
      to: to ? { nodeId: to } : {},
    } as Partial<AnyNode>);

  it('holds only when both ends are bound to something', () => {
    expect(satisfied(observe, empty, snap([conn('a', 'b')]))).toBe(true);
  });

  it('does not hold for a connector with a loose end', () => {
    // The step teaches that an arrow *joins two objects*. One end bound is a
    // line that happens to start on a box.
    expect(satisfied(observe, empty, snap([conn('a', undefined)]))).toBe(false);
    expect(satisfied(observe, empty, snap([conn(undefined, undefined)]))).toBe(false);
  });
});

describe('framed', () => {
  const observe: Observation = { of: 'framed' };

  it('holds for something dragged into a frame', () => {
    const before = digest({ a: node('a') });
    expect(satisfied(observe, before, snap([node('a', { frameId: 'f' })]))).toBe(true);
  });

  it('holds for something created inside one', () => {
    // Both routes are the same fact in the document, and both satisfy the
    // step's words. `createNode` decides membership from the box, so a shape
    // drawn inside a frame joins it without ever being dragged.
    expect(satisfied(observe, empty, snap([node('a', { frameId: 'f' })]))).toBe(true);
  });

  it('ignores something that was already in one', () => {
    const before = digest({ a: node('a', { frameId: 'f' }) });
    expect(satisfied(observe, before, snap([node('a', { frameId: 'f' })]))).toBe(false);
  });
});

describe('selected', () => {
  it('counts what is selected now, not what was made', () => {
    const observe: Observation = { of: 'selected', min: 2 };
    expect(satisfied(observe, empty, snap([node('a'), node('b')], ['a', 'b']))).toBe(true);
    expect(satisfied(observe, empty, snap([node('a'), node('b')], ['a']))).toBe(false);
  });
});

describe('unfurled', () => {
  const observe: Observation = { of: 'unfurled' };
  const link = (id: string, status: string) =>
    node(id, { type: 'link', link: { url: 'https://x.test', display: 'auto', status } } as Partial<AnyNode>);

  it('waits for the card to fill in rather than for it to appear', () => {
    // The step's words are "a card that fills itself in". A link node exists
    // the instant the address is pasted and is a grey skeleton for a moment
    // afterwards; advancing then teaches that the product is fast, not that it
    // works.
    expect(satisfied(observe, empty, snap([link('a', 'loading')]))).toBe(false);
    expect(satisfied(observe, empty, snap([link('a', 'ready')]))).toBe(true);
  });

  it('ignores a card that was already on the board', () => {
    const before = digest({ a: link('a', 'ready') });
    expect(satisfied(observe, before, snap([link('a', 'ready')]))).toBe(false);
  });

  it('does not accept a card that failed', () => {
    expect(satisfied(observe, empty, snap([link('a', 'error')]))).toBe(false);
  });
});

describe('moved', () => {
  const observe: Observation = { of: 'moved' };

  it('holds when something that was here has been dragged', () => {
    const before = digest({ a: node('a') });
    expect(satisfied(observe, before, snap([node('a', { x: 40 })]))).toBe(true);
  });

  it('ignores something that has not moved', () => {
    const before = digest({ a: node('a') });
    expect(satisfied(observe, before, snap([node('a')]))).toBe(false);
  });

  it('does not accept drawing a new object as having moved one', () => {
    // A node created during the step has no previous position. Counting it
    // would make "drag one of its boxes" satisfiable by drawing another.
    const before = digest({ a: node('a') });
    expect(satisfied(observe, before, snap([node('a'), node('b', { x: 900 })]))).toBe(false);
  });

  it('ignores a connector, which moves because its endpoints did', () => {
    // A connector's box is derived from what it joins, so it shifts whenever
    // they do — that is the effect the step asks the reader to cause, not
    // evidence that they caused it.
    const before = digest({ c: node('c', { type: 'connector' }) });
    expect(satisfied(observe, before, snap([node('c', { type: 'connector', x: 40 })]))).toBe(false);
  });
});

/* ------------------------------------------------------------ completeness */

describe('every walkthrough can be finished', () => {
  /**
   * A board on which every observation in the table holds.
   *
   * This is the test that matters most and the one easiest to leave out. A
   * walkthrough advances by itself, so a step whose observation can never be
   * true does not fail loudly -- it looks exactly like somebody who has not
   * done it yet, and the only report you get is "the tutorial is stuck".
   */
  const board = snap(
    [
      node('shape-a'),
      node('shape-b'),
      node('sticky-1', { type: 'sticky' }),
      node('frame-1', { type: 'frame' }),
      node('in-frame', { frameId: 'frame-1' }),
      node('path-1', { type: 'path' }),
      node('route', {
        geometry: { kind: 'line', vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 1 }] },
      } as Partial<AnyNode>),
      node('conn', {
        type: 'connector',
        from: { nodeId: 'shape-a' },
        to: { nodeId: 'shape-b' },
      } as Partial<AnyNode>),
    ],
    ['shape-a', 'shape-b']
  );

  for (const walk of WALKTHROUGHS) {
    it(`${walk.lesson} has no step that cannot be reached`, () => {
      walk.steps.forEach((at, i) => {
        expect(satisfied(at.observe, empty, board), `${walk.lesson} step ${i}`).toBe(true);
      });
    });
  }
});

describe('the words are the lesson’s', () => {
  it('reads them through, never copying them', () => {
    const walk = walkthroughFor('line-route')!;
    const lesson = LESSONS.find((l) => l.id === 'line-route')!;
    expect(stepCopy(walk, 1)).toBe(lesson.steps[walk.steps[1].step]);
  });

  it('ends quietly rather than throwing on an index the lesson lost', () => {
    expect(stepCopy(walkthroughFor('line-route')!, 99)).toBeUndefined();
  });
});
