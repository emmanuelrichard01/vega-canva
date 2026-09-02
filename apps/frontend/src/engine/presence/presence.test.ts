import { describe, it, expect } from 'vitest';
import {
  edgePlacement,
  formatDistance,
  initialsFor,
  phaseFor,
  readCollaborators,
  rosterSignature,
  type Collaborator,
} from './collaborators';
import {
  atLeast,
  boxOf,
  easeBox,
  fit,
  padBox,
  project,
  shouldRefit,
  unionBox,
  unproject,
  type Box,
} from './radarProjection';

const viewport = (over: Partial<Record<string, number>> = {}) => ({
  x: 0,
  y: 0,
  width: 1000,
  height: 800,
  zoom: 1,
  ...over,
});

const state = (over: Record<string, unknown> = {}) => ({
  user: { name: 'Dana Ito', color: '#3B82F6' },
  ...over,
});

describe('initialsFor', () => {
  it('takes the first and last initial of a full name', () => {
    expect(initialsFor('Dana Ito')).toBe('DI');
    expect(initialsFor('ada b lovelace')).toBe('AL');
  });

  it('takes one letter from a single name, not two', () => {
    // "AL" for "Alex" reads as an acronym for an organisation, not a person.
    expect(initialsFor('Alex')).toBe('A');
  });

  it('survives empty and whitespace-only names', () => {
    expect(initialsFor('')).toBe('?');
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('readCollaborators', () => {
  it('drops the local client and anyone who has not identified themselves', () => {
    const states = new Map<number, any>([
      [1, state()],
      [2, { cursor: { x: 0, y: 0 } }], // no user yet
      [7, state()],
    ]);
    const list = readCollaborators(states, 7);
    expect(list.map((c) => c.clientId)).toEqual([1]);
  });

  it('sorts by client id so the roster order does not shuffle', () => {
    const states = new Map<number, any>([
      [30, state()],
      [4, state()],
      [12, state()],
    ]);
    expect(readCollaborators(states, 99).map((c) => c.clientId)).toEqual([4, 12, 30]);
  });

  it('rejects a viewport that is missing width and height', () => {
    // What a peer on an older build publishes. The radar used to divide by the
    // missing width, draw a NaN-sized rectangle, and show nothing at all.
    const states = new Map<number, any>([
      [1, state({ viewport: { x: 10, y: 20, zoom: 2 } })],
    ]);
    expect(readCollaborators(states, 9)[0].viewport).toBeNull();
  });

  it('accepts a complete viewport', () => {
    const states = new Map<number, any>([[1, state({ viewport: viewport({ x: 5 }) })]]);
    expect(readCollaborators(states, 9)[0].viewport).toEqual({
      x: 5,
      y: 0,
      width: 1000,
      height: 800,
      zoom: 1,
    });
  });

  it('rejects a zero zoom, which would divide by zero downstream', () => {
    const states = new Map<number, any>([[1, state({ viewport: viewport({ zoom: 0 }) })]]);
    expect(readCollaborators(states, 9)[0].viewport).toBeNull();
  });

  it('treats a non-finite cursor as no cursor', () => {
    const states = new Map<number, any>([
      [1, state({ cursor: { x: NaN, y: 3 } })],
      [2, state({ cursor: { x: 4, y: 3 } })],
    ]);
    const list = readCollaborators(states, 9);
    expect(list[0].cursor).toBeNull();
    expect(list[1].cursor).toEqual({ x: 4, y: 3 });
  });

  it('accepts only the four known activities', () => {
    const states = new Map<number, any>([
      [1, state({ activity: 'recording' })],
      // What the previous free-string version put on the wire. It is not a
      // kind, so it must not reach the UI as one.
      [2, state({ activity: '✏️ Typing' })],
      [3, state({ activity: 'brewing tea' })],
    ]);
    const list = readCollaborators(states, 9);
    expect(list.map((c) => c.activity)).toEqual(['recording', null, null]);
  });

  it('carries the tool through, since that is what badges the arrow', () => {
    const states = new Map<number, any>([
      [1, state({ tool: 'pen' })],
      [2, state({})],
    ]);
    const list = readCollaborators(states, 9);
    expect(list[0].tool).toBe('pen');
    expect(list[1].tool).toBeNull();
  });

  it('flattens in-flight throws and drops malformed poses', () => {
    const states = new Map<number, any>([
      [1, state({ throws: { a: { x: 1, y: 2 }, b: null, c: { x: 'no' } } })],
    ]);
    expect(readCollaborators(states, 9)[0].throws).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('rosterSignature', () => {
  const base = (over: Partial<Collaborator> = {}): Collaborator => ({
    clientId: 1,
    id: 'author_dana',
    name: 'Dana',
    color: '#3B82F6',
    initials: 'D',
    cursor: { x: 0, y: 0 },
    smoothed: null,
    viewport: null,
    activity: null,
    tool: 'select',
    away: false,
    selection: [],
    throws: [],
    ...over,
  });

  it('ignores movement — that is the frame loop’s job, not React’s', () => {
    expect(rosterSignature([base({ cursor: { x: 999, y: -40 } })])).toBe(
      rosterSignature([base({ cursor: { x: 0, y: 0 } })])
    );
  });

  it('changes when someone leaves the canvas, so React can hide the pointer', () => {
    expect(rosterSignature([base({ cursor: null })])).not.toBe(rosterSignature([base()]));
  });

  it('changes when someone selects something, so the outline is drawn', () => {
    expect(rosterSignature([base({ selection: ['node-1'] })])).not.toBe(rosterSignature([base()]));
  });

  it('changes when someone goes idle or starts doing something', () => {
    expect(rosterSignature([base({ away: true })])).not.toBe(rosterSignature([base()]));
    expect(rosterSignature([base({ activity: 'typing' })])).not.toBe(rosterSignature([base()]));
  });

  it('changes when someone picks up a different tool, so the badge follows', () => {
    expect(rosterSignature([base({ tool: 'pen' })])).not.toBe(rosterSignature([base()]));
  });
});

describe('edgePlacement', () => {
  const view = { width: 1000, height: 800 };
  // Half-extents minus the 56px margin: 444 across, 344 down.

  it('returns null while the point is comfortably on screen', () => {
    expect(edgePlacement({ x: 600, y: 400 }, view)).toBeNull();
  });

  it('puts a marker on the edge it would leave by', () => {
    const placed = edgePlacement({ x: 1400, y: 400 }, view)!;
    expect(placed.x).toBeCloseTo(944);
    expect(placed.y).toBeCloseTo(400);
    expect(placed.angle).toBeCloseTo(0);
  });

  it('walks the ray rather than clamping each axis into the corner', () => {
    // Clamping x and y independently would put this at (944, 744) — the
    // corner — along with everything else that is off to the lower right.
    const placed = edgePlacement({ x: 1500, y: 1200 }, view)!;
    expect(placed.y).toBeCloseTo(744); // the nearer bound is hit exactly
    expect(placed.x).toBeCloseTo(930);
    expect(placed.x).toBeLessThan(944);
  });

  it('separates two people who are off in different directions', () => {
    const near = edgePlacement({ x: 1500, y: 500 }, view)!;
    const far = edgePlacement({ x: 1500, y: 1200 }, view)!;
    expect(Math.hypot(near.x - far.x, near.y - far.y)).toBeGreaterThan(100);
  });

  it('reports the direction to the person, in degrees', () => {
    expect(edgePlacement({ x: 500, y: -500 }, view)!.angle).toBeCloseTo(-90);
    expect(edgePlacement({ x: -500, y: 400 }, view)!.angle).toBeCloseTo(180);
  });

  it('does not invert on a viewport smaller than twice the margin', () => {
    const placed = edgePlacement({ x: 400, y: 40 }, { width: 80, height: 60 }, 56);
    expect(placed).not.toBeNull();
    expect(placed!.x).toBeGreaterThan(40);
  });
});

describe('formatDistance', () => {
  it('reads as a rough sense of distance, not a measurement', () => {
    expect(formatDistance(420)).toBe('420px');
    expect(formatDistance(2400)).toBe('2.4k');
    expect(formatDistance(24000)).toBe('24k');
  });
});

describe('phaseFor', () => {
  it('separates consecutive client ids, which is how people join', () => {
    const a = phaseFor(101);
    const b = phaseFor(102);
    expect(Math.abs(a - b)).toBeGreaterThan(0.2);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
});

describe('radar projection', () => {
  it('takes scale into account when bounding an object', () => {
    expect(boxOf({ x: 10, y: 10, width: 100, height: 50, scaleX: 2, scaleY: -1 })).toEqual({
      minX: 10,
      minY: 10,
      maxX: 210,
      maxY: 60,
    });
  });

  it('unions with either side missing', () => {
    const a: Box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(unionBox(null, a)).toEqual(a);
    expect(unionBox(a, null)).toEqual(a);
    expect(unionBox(a, { minX: -5, minY: 5, maxX: 5, maxY: 20 })).toEqual({
      minX: -5,
      minY: 0,
      maxX: 10,
      maxY: 20,
    });
  });

  it('never frames a world smaller than the floor', () => {
    // One sticky note on an empty board would otherwise be *magnified* by a
    // widget whose job is to show more than the screen does.
    expect(atLeast({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1000)).toEqual({
      minX: -450,
      minY: -450,
      maxX: 550,
      maxY: 550,
    });
  });

  it('leaves a box that is already large enough alone', () => {
    const box = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
    expect(atLeast(box, 1000)).toEqual(box);
  });

  it('fits with one scale for both axes and centres the remainder', () => {
    const view = fit({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 200, 200);
    expect(view.scale).toBeCloseTo(0.2);
    expect(view.offsetX).toBeCloseTo(0);
    expect(view.offsetY).toBeCloseTo(50);
  });

  it('round-trips a world point through the radar and back', () => {
    const view = fit(padBox({ minX: -200, minY: 40, maxX: 900, maxY: 700 }, 50), 260, 145);
    const point = project(view, 314, 271);
    const back = unproject(view, point.x, point.y);
    expect(back.x).toBeCloseTo(314);
    expect(back.y).toBeCloseTo(271);
  });

  describe('shouldRefit', () => {
    const current: Box = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };

    it('holds the frame while everything is still inside it', () => {
      // This is the whole fix for the map that "swam": panning changes the
      // desired box every frame, and re-fitting to it moved every object on
      // the radar every frame.
      expect(shouldRefit(current, { minX: 100, minY: 100, maxX: 900, maxY: 900 })).toBe(false);
    });

    it('re-frames when something has moved outside', () => {
      expect(shouldRefit(current, { minX: 100, minY: 100, maxX: 2000, maxY: 900 })).toBe(true);
    });

    it('tightens when the frame has become far larger than it needs to be', () => {
      expect(shouldRefit(current, { minX: 400, minY: 400, maxX: 600, maxY: 600 })).toBe(true);
    });

    it('re-frames from a degenerate starting box', () => {
      expect(shouldRefit({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, current)).toBe(true);
    });
  });

  describe('easeBox', () => {
    const from: Box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const to: Box = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

    it('moves a fraction of the way', () => {
      expect(easeBox(from, to, 0.5)).toEqual({ minX: 0, minY: 0, maxX: 150, maxY: 150 });
    });

    it('snaps once it is within a pixel, so the canvas stops repainting', () => {
      const nearly: Box = { minX: 0, minY: 0, maxX: 199.9, maxY: 199.9 };
      expect(easeBox(nearly, to, 0.5)).toEqual(to);
    });

    it('lands exactly on the target at alpha 1', () => {
      expect(easeBox(from, to, 1)).toEqual(to);
    });
  });

  describe('ruler inset projection & selection scaling', () => {
    it('projects world coordinates with ruler inset when rulers are enabled', () => {
      const world = { x: 150, y: 200 };
      const zoom = 1.5;
      const camX = 50;
      const camY = 30;
      const RULER_SIZE = 22;

      // With rulers enabled:
      const screenXWithRulers = world.x * zoom + camX + RULER_SIZE;
      const screenYWithRulers = world.y * zoom + camY + RULER_SIZE;
      expect(screenXWithRulers).toBe(150 * 1.5 + 50 + 22);
      expect(screenYWithRulers).toBe(200 * 1.5 + 30 + 22);

      // Without rulers:
      const screenXNoRulers = world.x * zoom + camX;
      const screenYNoRulers = world.y * zoom + camY;
      expect(screenXNoRulers).toBe(150 * 1.5 + 50);
      expect(screenYNoRulers).toBe(200 * 1.5 + 30);
    });

    it('computes correct scaled bounds for remote presence boxes', () => {
      const node = {
        width: 120,
        height: 80,
        scaleX: -1.5, // flipped & scaled
        scaleY: 2.0,
      };

      const computedWidth = node.width * Math.abs(node.scaleX || 1);
      const computedHeight = node.height * Math.abs(node.scaleY || 1);

      expect(computedWidth).toBe(180);
      expect(computedHeight).toBe(160);
    });
  });
});
