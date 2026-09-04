import { describe, expect, it } from 'vitest';
import { buildSequenceDiagram } from './buildSequence';
import { layoutSequence, parseSequence } from './sequence';
import { sequenceToMermaid } from './sequenceEmit';
import type { AnyNode } from '../model/schema';

/**
 * Frames around a range of messages: `loop`, `alt`/`else`, `opt`, `par`.
 *
 * These were refused at first, on the grounds that a frame cannot be dropped
 * without drawing a picture that looks complete and says something the source
 * does not. The reasoning was right and the conclusion was wrong — the answer
 * to a construct you cannot fake is to implement it, and a sequence diagram
 * without `alt` is missing the thing sequence diagrams are mostly drawn for.
 */

/** The example from mermaid's own documentation, and the one that was refused. */
const NESTED = `
sequenceDiagram
    loop Daily query
        Alice->>Bob: Hello Bob, how are you?
        alt is sick
            Bob->>Alice: Not so good :(
        else is well
            Bob->>Alice: Feeling fresh like a daisy
        end

        opt Extra response
            Bob->>Alice: Thanks for asking
        end
    end
`;

const parse = (src: string) => parseSequence(src.trim());

describe('parsing frames', () => {
  it('accepts the nested example', () => {
    const { diagram, error } = parse(NESTED);
    expect(error).toBeNull();
    expect(diagram).not.toBeNull();
  });

  it('keeps every message inside it', () => {
    const { diagram } = parse(NESTED);
    const messages = diagram!.steps.filter((s) => s.kind === 'message');
    expect(messages.map((m) => (m.kind === 'message' ? m.label : ''))).toEqual([
      'Hello Bob, how are you?',
      'Not so good :(',
      'Feeling fresh like a daisy',
      'Thanks for asking',
    ]);
  });

  it('records the frames in the order they open and close', () => {
    const { diagram } = parse(NESTED);
    const markers = diagram!.steps
      .filter((s) => s.kind !== 'message' && s.kind !== 'note')
      .map((s) =>
        s.kind === 'block-start' ? `${s.block}:${s.label}` : s.kind === 'block-section' ? `else:${s.label}` : 'end'
      );
    expect(markers).toEqual([
      'loop:Daily query',
      'alt:is sick',
      'else:is well',
      'end',
      'opt:Extra response',
      'end',
      'end',
    ]);
  });

  it('reads a par and its and-divider', () => {
    const { diagram } = parse(`
sequenceDiagram
  par Fan out
    A->>B: one
  and
    A->>C: two
  end`);
    const kinds = diagram!.steps.map((s) => s.kind);
    expect(kinds).toEqual(['block-start', 'message', 'block-section', 'message', 'block-end']);
  });

  it("does not mistake a message for a block because a word starts it", () => {
    // `endpoint` begins with `end`; matching on a prefix would close a frame
    // that was never opened.
    const { diagram, error } = parse('sequenceDiagram\n  A->>B: endpoint ready');
    expect(error).toBeNull();
    expect(diagram!.steps).toHaveLength(1);
  });
});

describe('what an unbalanced document says', () => {
  it('points at the block that was never closed', () => {
    // The missing `end` is invisible, so the only useful coordinate is where
    // the frame that never closed began.
    const { diagram, error, errorLine } = parse('sequenceDiagram\n  A->>B: hi\n  loop forever\n    B->>A: yes');
    expect(diagram).toBeNull();
    expect(error).toMatch(/never closed/);
    expect(errorLine).toBe(3);
  });

  it('rejects an end with nothing open', () => {
    const { diagram, error } = parse('sequenceDiagram\n  A->>B: hi\n  end');
    expect(diagram).toBeNull();
    expect(error).toMatch(/no block is open/);
  });

  it('rejects an else outside any block', () => {
    const { diagram, error } = parse('sequenceDiagram\n  A->>B: hi\n  else nope');
    expect(diagram).toBeNull();
    expect(error).toMatch(/no block is open/);
  });
});

describe('laying frames out', () => {
  const laid = () => layoutSequence(parse(NESTED).diagram!, { originX: 0, originY: 0 });

  it('draws one frame per block', () => {
    expect(laid().frames).toHaveLength(3);
  });

  it('nests them: the loop contains both of the others', () => {
    const frames = laid().frames;
    const loop = frames.find((f) => f.block === 'loop')!;
    for (const inner of frames.filter((f) => f !== loop)) {
      expect(inner.y).toBeGreaterThan(loop.y);
      expect(inner.y + inner.height).toBeLessThan(loop.y + loop.height);
    }
  });

  it('gives the alt its else compartment', () => {
    const alt = laid().frames.find((f) => f.block === 'alt')!;
    expect(alt.sections).toHaveLength(1);
    expect(alt.sections[0].label).toBe('is well');
    // The divider falls inside the frame, not on its edge.
    expect(alt.sections[0].y).toBeGreaterThan(alt.y);
    expect(alt.sections[0].y).toBeLessThan(alt.y + alt.height);
  });

  it('records how deep each one is', () => {
    const frames = laid().frames;
    expect(frames.find((f) => f.block === 'loop')!.depth).toBe(0);
    expect(frames.find((f) => f.block === 'alt')!.depth).toBe(1);
    expect(frames.find((f) => f.block === 'opt')!.depth).toBe(1);
  });

  it('spans only the participants it talks about', () => {
    /**
     * An `alt` between two of five participants should not draw a box across
     * the whole diagram.
     */
    const layout = layoutSequence(
      parse(`
sequenceDiagram
  A->>B: one
  loop just these two
    D->>E: inner
  end
  A->>C: two`).diagram!,
      { originX: 0, originY: 0 }
    );
    const frame = layout.frames[0];
    const a = layout.lanes.find((l) => l.key === 'A')!;
    expect(frame.x).toBeGreaterThan(a.centreX);
  });

  it('contains every frame within the reported bounds', () => {
    const layout = laid();
    for (const frame of layout.frames) {
      expect(frame.x + frame.width).toBeLessThanOrEqual(layout.width + 0.001);
      expect(frame.y + frame.height).toBeLessThanOrEqual(layout.height + 0.001);
    }
  });

  it('leaves room for the label tab above the first message inside', () => {
    const layout = laid();
    const loop = layout.frames.find((f) => f.block === 'loop')!;
    const firstMessage = layout.steps.find((s) => s.kind === 'arrow')!;
    expect(firstMessage.y - loop.y).toBeGreaterThanOrEqual(20);
  });
});

describe('the round trip through the board', () => {
  const build = (source: string): AnyNode[] =>
    buildSequenceDiagram(parse(source).diagram!, { x: 0, y: 0 }).nodes as unknown as AnyNode[];

  it('comes back as source that still parses', () => {
    const emitted = sequenceToMermaid(build(NESTED))!;
    expect(parseSequence(emitted).error).toBeNull();
  });

  it('keeps every frame, in order and nested the same way', () => {
    const emitted = sequenceToMermaid(build(NESTED))!;
    const back = parseSequence(emitted).diagram!;
    const markers = back.steps
      .filter((s) => s.kind !== 'message' && s.kind !== 'note')
      .map((s) =>
        s.kind === 'block-start' ? `${s.block}:${s.label}` : s.kind === 'block-section' ? `else:${s.label}` : 'end'
      );
    expect(markers).toEqual([
      'loop:Daily query',
      'alt:is sick',
      'else:is well',
      'end',
      'opt:Extra response',
      'end',
      'end',
    ]);
  });

  it('keeps the messages inside the right frames', () => {
    const emitted = sequenceToMermaid(build(NESTED))!;
    const back = parseSequence(emitted).diagram!;
    const order = back.steps.map((s) =>
      s.kind === 'message' ? s.label : s.kind === 'block-start' ? s.block : s.kind
    );
    expect(order).toEqual([
      'loop',
      'Hello Bob, how are you?',
      'alt',
      'Not so good :(',
      'block-section',
      'Feeling fresh like a daisy',
      'block-end',
      'opt',
      'Thanks for asking',
      'block-end',
      'block-end',
    ]);
  });

  it('survives a second trip unchanged', () => {
    // Open, apply, open again. Any disagreement between the emitter and the
    // builder would show up as drift here.
    const once = sequenceToMermaid(build(NESTED))!;
    const twice = sequenceToMermaid(build(once))!;
    expect(twice).toBe(once);
  });

  it('does not read a frame as a note', () => {
    // Both are plates with text on them; only the keyword tells them apart.
    const emitted = sequenceToMermaid(build(NESTED))!;
    expect(emitted).not.toMatch(/Note over .*loop/);
  });
});
