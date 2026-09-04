import { describe, expect, it } from 'vitest';
import { layoutSequence, looksLikeSequence, parseSequence } from './sequence';

const parse = (src: string) => parseSequence(src.trim());

describe('recognising a sequence diagram', () => {
  it('reads the header', () => {
    expect(looksLikeSequence('sequenceDiagram\n  A->>B: hi')).toBe(true);
  });

  it('does not claim a flowchart', () => {
    expect(looksLikeSequence('flowchart TD\n  A-->B')).toBe(false);
  });

  it('is not fooled by the word appearing in a label', () => {
    // `looksLikeSequence` decides which parser runs, so a false positive sends
    // a perfectly good flowchart to the wrong one.
    expect(looksLikeSequence('flowchart TD\n  A[Start sequenceDiagram]')).toBe(false);
  });
});

describe('participants', () => {
  it('appear in the order they are first seen', () => {
    // Column order is the reader's map. A participant that moved when a later
    // message was added would be a different picture of the same conversation.
    const { diagram } = parse(`
sequenceDiagram
  Bob->>Alice: Hello
  Carol->>Bob: Hi
`);
    expect(diagram!.participants.map((p) => p.key)).toEqual(['Bob', 'Alice', 'Carol']);
  });

  it('take a declared alias as their label', () => {
    const { diagram } = parse(`
sequenceDiagram
  participant A as Alice
  A->>A: think
`);
    expect(diagram!.participants[0]).toMatchObject({ key: 'A', label: 'Alice' });
  });

  it('keep a declaration that arrives after first use', () => {
    // Mermaid allows this, and the label is the interesting half.
    const { diagram } = parse(`
sequenceDiagram
  A->>B: Hello
  participant A as Alice
`);
    expect(diagram!.participants[0].label).toBe('Alice');
    expect(diagram!.participants).toHaveLength(2);
  });

  it('marks an actor', () => {
    const { diagram } = parse(`
sequenceDiagram
  actor U as User
  U->>S: request
`);
    expect(diagram!.participants[0].actor).toBe(true);
    expect(diagram!.participants[1].actor).toBe(false);
  });
});

describe('arrow forms', () => {
  /**
   * The table is sorted longest-token-first, and this is what that sort is
   * for: `-->>` contains `-->` which contains `->`, so a shorter form matched
   * first would claim the front of a longer one and leave its tail in the
   * label.
   */
  const cases: [string, { line: string; head: string }][] = [
    ['A->B: x', { line: 'solid', head: 'open' }],
    ['A-->B: x', { line: 'dotted', head: 'open' }],
    ['A->>B: x', { line: 'solid', head: 'arrow' }],
    ['A-->>B: x', { line: 'dotted', head: 'arrow' }],
    ['A-xB: x', { line: 'solid', head: 'cross' }],
    ['A--xB: x', { line: 'dotted', head: 'cross' }],
    ['A-)B: x', { line: 'solid', head: 'async' }],
    ['A--)B: x', { line: 'dotted', head: 'async' }],
  ];

  it.each(cases)('reads %s', (line, expected) => {
    const { diagram } = parse(`sequenceDiagram\n  ${line}`);
    expect(diagram!.steps[0]).toMatchObject(expected);
  });

  it('leaves nothing of the arrow in the label', () => {
    const { diagram } = parse('sequenceDiagram\n  A-->>B: Hello');
    expect(diagram!.steps[0]).toMatchObject({ from: 'A', to: 'B', label: 'Hello' });
  });

  it('takes a message with no label', () => {
    const { diagram } = parse('sequenceDiagram\n  A->>B');
    expect(diagram!.steps[0]).toMatchObject({ from: 'A', to: 'B', label: '' });
  });
});

describe('activation suffixes', () => {
  it('strips + from the receiver without making it part of the name', () => {
    // `A->>+B` is a message to B, not to a participant called "+B".
    const { diagram } = parse('sequenceDiagram\n  A->>+B: go');
    expect(diagram!.steps[0]).toMatchObject({ to: 'B', activate: true });
    expect(diagram!.participants.map((p) => p.key)).toEqual(['A', 'B']);
  });

  it('strips - from the sender', () => {
    const { diagram } = parse('sequenceDiagram\n  B-->>-A: done');
    expect(diagram!.steps[0]).toMatchObject({ from: 'B', to: 'A', deactivate: true });
  });
});

describe('notes', () => {
  it('spans two participants', () => {
    const { diagram } = parse(`
sequenceDiagram
  A->>B: hi
  Note over A,B: they agree
`);
    expect(diagram!.steps[1]).toMatchObject({
      kind: 'note',
      over: ['A', 'B'],
      placement: 'over',
      text: 'they agree',
    });
  });

  it('reads a side placement', () => {
    const { diagram } = parse('sequenceDiagram\n  Note right of A: thinking');
    expect(diagram!.steps[0]).toMatchObject({ placement: 'right', over: ['A'] });
  });

  it('introduces a participant it mentions', () => {
    const { diagram } = parse('sequenceDiagram\n  Note over Solo: alone');
    expect(diagram!.participants.map((p) => p.key)).toEqual(['Solo']);
  });
});

describe('what it refuses, and what it merely skips', () => {
  it('draws a block rather than refusing it', () => {
    /**
     * These were refused at first, on the grounds that a frame around a range
     * of messages cannot be dropped without drawing a picture that looks
     * complete and says something the source does not. The reasoning was right
     * and the conclusion was wrong: the answer to a construct you cannot fake
     * is to implement it. See `sequenceBlocks.test.ts` for the whole of it.
     */
    const { diagram, error } = parse(`
sequenceDiagram
  A->>B: hi
  loop every minute
    B->>A: poll
  end
`);
    expect(error).toBeNull();
    expect(diagram!.steps.map((s) => s.kind)).toEqual([
      'message',
      'block-start',
      'message',
      'block-end',
    ]);
  });

  it('skips a directive that changes nothing it draws', () => {
    // `autonumber` only adds counters. Refusing a whole file over it would be
    // a tantrum, so it is reported as skipped and the diagram still builds.
    const { diagram, skippedLines } = parse(`
sequenceDiagram
  autonumber
  A->>B: hi
`);
    expect(diagram!.steps).toHaveLength(1);
    expect(skippedLines).toEqual([2]);
  });

  it('wants the header', () => {
    const { diagram, error } = parse('A->>B: hi');
    expect(diagram).toBeNull();
    expect(error).toMatch(/sequenceDiagram/);
  });

  it('says so when there is nothing but a header', () => {
    const { diagram, error } = parse('sequenceDiagram');
    expect(diagram).toBeNull();
    expect(error).toMatch(/participants/i);
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const laidOut = (src: string) => {
  const { diagram } = parse(src);
  return layoutSequence(diagram!, { originX: 0, originY: 0 });
};

describe('layout', () => {
  it('puts participants in columns, in declaration order', () => {
    const l = laidOut('sequenceDiagram\n  A->>B: hi\n  C->>A: yo');
    const xs = l.lanes.map((lane) => lane.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.lanes.map((lane) => lane.key)).toEqual(['A', 'B', 'C']);
  });

  it('runs every lifeline to the same depth', () => {
    // A ragged comb does not read as columns.
    const l = laidOut('sequenceDiagram\n  A->>B: one\n  B->>C: two');
    const bottoms = new Set(l.lanes.map((lane) => lane.lineBottom));
    expect(bottoms.size).toBe(1);
  });

  it('starts every lifeline below its head box', () => {
    const l = laidOut('sequenceDiagram\n  A->>B: hi');
    for (const lane of l.lanes) expect(lane.lineTop).toBe(lane.y + lane.height);
  });

  it('stacks messages downward in the order they were written', () => {
    const l = laidOut('sequenceDiagram\n  A->>B: one\n  B->>A: two\n  A->>B: three');
    const ys = l.steps.map((s) => (s.kind === 'arrow' ? s.y : 0));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(3);
  });

  it('gives a self-message more room than a straight one', () => {
    /**
     * A loop drawn in a normal row overlaps the messages above and below it.
     * The gap after a self-message has to be bigger than the ordinary one.
     */
    const plain = laidOut('sequenceDiagram\n  A->>B: one\n  A->>B: two');
    const looped = laidOut('sequenceDiagram\n  A->>A: think\n  A->>B: two');
    const gapPlain = (plain.steps[1] as { y: number }).y - (plain.steps[0] as { y: number }).y;
    const gapLoop = (looped.steps[1] as { y: number }).y - (looped.steps[0] as { y: number }).y;
    expect(gapLoop).toBeGreaterThan(gapPlain);
  });

  it('marks a self-message as one', () => {
    const l = laidOut('sequenceDiagram\n  A->>A: think');
    expect(l.steps[0]).toMatchObject({ kind: 'arrow', self: true });
  });

  it('spans a note across the participants it covers', () => {
    const l = laidOut('sequenceDiagram\n  A->>B: hi\n  Note over A,B: both');
    const note = l.steps[1] as { x: number; width: number };
    const [a, b] = l.lanes;
    expect(note.x).toBeLessThan(a.centreX);
    expect(note.x + note.width).toBeGreaterThan(b.centreX);
  });

  it('reports bounds that contain every column', () => {
    const l = laidOut('sequenceDiagram\n  A->>B: hi\n  B->>C: yo');
    for (const lane of l.lanes) {
      expect(lane.x + lane.width).toBeLessThanOrEqual(l.width + 0.001);
      expect(lane.lineBottom).toBeLessThanOrEqual(l.height + 0.001);
    }
  });

  it('names the cast at both ends', () => {
    /**
     * Mermaid repeats the participant boxes at the foot, and the reason is
     * scrolling: on a long exchange the top row is off the screen by the time
     * it matters, so a reader following the last few messages would have
     * nothing to tell the columns apart by.
     */
    const l = laidOut('sequenceDiagram\n  A->>B: one\n  B->>A: two');
    for (const lane of l.lanes) {
      expect(lane.footY).toBeGreaterThan(lane.y + lane.height);
      // The lifeline stops at the foot box rather than running through it.
      expect(lane.lineBottom).toBe(lane.footY);
    }
  });

  it('puts every foot box at the same depth', () => {
    const l = laidOut('sequenceDiagram\n  A->>B: one\n  B->>C: two');
    expect(new Set(l.lanes.map((lane) => lane.footY)).size).toBe(1);
  });

  it('reports bounds that contain the foot boxes', () => {
    // A fit computed to the lifelines alone would cut them in half.
    const l = laidOut('sequenceDiagram\n  A->>B: one');
    for (const lane of l.lanes) {
      expect(lane.footY + lane.height).toBeLessThanOrEqual(l.height + 0.001);
    }
  });

  it('honours the origin it is given', () => {
    const { diagram } = parse('sequenceDiagram\n  A->>B: hi');
    const l = layoutSequence(diagram!, { originX: 100, originY: 50 });
    expect(l.lanes[0].x).toBe(100);
    expect(l.lanes[0].y).toBe(50);
  });
});
