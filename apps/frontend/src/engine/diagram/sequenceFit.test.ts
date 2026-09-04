import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateText, layoutSequence, parseSequence, SEQ_TYPE } from './sequence';

/**
 * Whether the words fit in the boxes drawn for them.
 *
 * The first layout used a fixed 150-unit column and a fixed gap, which holds
 * until a participant is called "Identity provider" or a message says
 * "Exchange code + code_verifier" — and then the text runs outside its box and
 * across its neighbours. The diagram does not look *wrong* when that happens,
 * it looks **unfinished**, which is harder to diagnose and was the report.
 *
 * These assertions are the fit itself rather than any particular number, so
 * the constants can be tuned without rewriting them.
 */

const MODAL = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'components', 'MermaidModal.tsx'
);

function sequenceTemplates(): Array<{ name: string; source: string }> {
  const src = readFileSync(MODAL, 'utf8');
  const start = src.indexOf('const TEMPLATES');
  const block = src.slice(start, src.indexOf('\n];', start));
  const re = /name: '([^']+)',\s*kind: 'sequence',\s*source: `([\s\S]*?)`,/g;
  const out: Array<{ name: string; source: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push({ name: m[1], source: m[2] });
  return out;
}

const SEQUENCES = sequenceTemplates();

/** The same estimator the layout defaults to, so the fit is self-consistent. */
const widthOf = (text: string, fontSize: number) =>
  estimateText(text, { fontSize }).width;

describe('the shipped sequence templates', () => {
  it('were found', () => {
    expect(SEQUENCES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(SEQUENCES.map((t) => [t.name, t.source] as const))(
    '%s: every participant name fits its box',
    (_name, source) => {
      const layout = layoutSequence(parseSequence(source).diagram!);
      for (const lane of layout.lanes) {
        for (const line of lane.lines) {
          expect(widthOf(line, SEQ_TYPE.head)).toBeLessThanOrEqual(lane.width);
        }
        // And the box is deep enough for however many lines that took.
        expect(lane.height).toBeGreaterThanOrEqual(lane.lines.length * SEQ_TYPE.head * 1.35);
      }
    }
  );

  it.each(SEQUENCES.map((t) => [t.name, t.source] as const))(
    '%s: columns never overlap',
    (_name, source) => {
      const layout = layoutSequence(parseSequence(source).diagram!);
      for (let i = 1; i < layout.lanes.length; i += 1) {
        const prev = layout.lanes[i - 1];
        expect(layout.lanes[i].x).toBeGreaterThanOrEqual(prev.x + prev.width);
      }
    }
  );

  it.each(SEQUENCES.map((t) => [t.name, t.source] as const))(
    '%s: every message label fits between its two lifelines',
    (_name, source) => {
      /**
       * The gap-widening pass, checked end to end. A label wider than the span
       * it rides is drawn across whatever column is next to it.
       */
      const layout = layoutSequence(parseSequence(source).diagram!);
      const centre = new Map(layout.lanes.map((l) => [l.key, l.centreX]));
      for (const step of layout.steps) {
        if (step.kind !== 'arrow' || step.self || !step.label) continue;
        const span = Math.abs((centre.get(step.to) ?? 0) - (centre.get(step.from) ?? 0));
        expect(widthOf(step.label, SEQ_TYPE.message)).toBeLessThanOrEqual(span);
      }
    }
  );

  it.each(SEQUENCES.map((t) => [t.name, t.source] as const))(
    '%s: every note fits its own plate',
    (_name, source) => {
      const layout = layoutSequence(parseSequence(source).diagram!);
      for (const step of layout.steps) {
        if (step.kind !== 'note') continue;
        expect(step.lines.length).toBeGreaterThan(0);
        for (const line of step.lines) {
          expect(widthOf(line, SEQ_TYPE.note)).toBeLessThanOrEqual(step.width);
        }
        expect(step.height).toBeGreaterThanOrEqual(step.lines.length * SEQ_TYPE.note * 1.35);
      }
    }
  );

  it.each(SEQUENCES.map((t) => [t.name, t.source] as const))(
    '%s: nothing is drawn outside the reported bounds',
    (_name, source) => {
      // The fit-to-view uses these. A note beside the first participant, or a
      // self-loop off the last one, used to fall outside them and get cut off.
      const layout = layoutSequence(parseSequence(source).diagram!, {
        originX: 0,
        originY: 0,
      });
      for (const step of layout.steps) {
        if (step.kind !== 'note') continue;
        expect(step.x + step.width).toBeLessThanOrEqual(layout.width + 0.001);
        expect(step.y + step.height).toBeLessThanOrEqual(layout.height + 0.001);
      }
    }
  );

  it.each(SEQUENCES.map((t) => [t.name, t.source] as const))(
    '%s: steps stay in the order they were written',
    (_name, source) => {
      // A tall note pushes what follows it down. If that arithmetic were
      // wrong, a message would be drawn over the note above it.
      const layout = layoutSequence(parseSequence(source).diagram!);
      const tops = layout.steps.map((st) => (st.kind === 'note' ? st.y : st.y));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    }
  );
});

describe('a long name widens its own column, not every column', () => {
  it('leaves the short ones alone', () => {
    const source = `sequenceDiagram
  participant A as A
  participant B as A considerably longer participant name
  A->>B: hi`;
    const layout = layoutSequence(parseSequence(source).diagram!);
    expect(layout.lanes[1].width).toBeGreaterThan(layout.lanes[0].width);
  });

  it('wraps rather than growing without limit', () => {
    const source = `sequenceDiagram
  participant A as ${'Extremely long '.repeat(12)}name
  A->>B: hi`;
    const layout = layoutSequence(parseSequence(source).diagram!);
    expect(layout.lanes[0].width).toBeLessThanOrEqual(260);
    expect(layout.lanes[0].lines.length).toBeGreaterThan(1);
  });
});

describe('a wide message label widens the gap it has to cross', () => {
  it('pushes the two columns apart', () => {
    const short = layoutSequence(parseSequence('sequenceDiagram\n  A->>B: ok').diagram!);
    const long = layoutSequence(
      parseSequence(
        'sequenceDiagram\n  A->>B: a considerably longer message label than that one'
      ).diagram!
    );
    const spanOf = (l: ReturnType<typeof layoutSequence>) =>
      l.lanes[1].centreX - l.lanes[0].centreX;
    expect(spanOf(long)).toBeGreaterThan(spanOf(short));
  });

  it('gives a self-message room for its loop', () => {
    // The loop reaches right, into whatever is next to it.
    const withLoop = layoutSequence(
      parseSequence('sequenceDiagram\n  A->>A: think about it carefully\n  A->>B: go').diagram!
    );
    const without = layoutSequence(parseSequence('sequenceDiagram\n  A->>B: go').diagram!);
    expect(withLoop.lanes[1].x - withLoop.lanes[0].x).toBeGreaterThan(
      without.lanes[1].x - without.lanes[0].x
    );
  });
});
