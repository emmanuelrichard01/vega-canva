import { describe, expect, it } from 'vitest';
import { buildSequenceDiagram } from './buildSequence';
import { parseSequence } from './sequence';
import { isSequenceDiagram, sequenceToMermaid } from './sequenceEmit';
import type { AnyNode } from '../model/schema';

/**
 * Reading a sequence diagram back off the board.
 *
 * The bug: "Edit diagram" re-derives source from the objects, and
 * `diagramToMermaid` only knows how to write flowcharts — so it turned a
 * sequence diagram into a flowchart of lifelines and arrow stubs, and applying
 * that replaced the real diagram with the nonsense. Editing was destructive on
 * exactly the diagrams the feature had just learned to draw.
 *
 * The assertions are round trips rather than string comparisons: what matters
 * is that the diagram survives the journey, not that it comes back formatted
 * the way it went in.
 */

const build = (source: string): AnyNode[] => {
  const { diagram } = parseSequence(source.trim());
  return buildSequenceDiagram(diagram!, { x: 0, y: 0 }).nodes as unknown as AnyNode[];
};

const roundTrip = (source: string) => {
  const emitted = sequenceToMermaid(build(source));
  expect(emitted, 'nothing came back').not.toBeNull();
  const reparsed = parseSequence(emitted!);
  expect(reparsed.error, `re-parse failed: ${reparsed.error}`).toBeNull();
  return reparsed.diagram!;
};

const SAMPLE = `
sequenceDiagram
    actor User as End user
    participant App as Single-page app
    participant API as Resource API

    User->>App: Click sign in
    App->>API: GET /me
    API-->>App: Profile
    Note over App,API: The token never leaves the tab
    App-xUser: Bounced
`;

describe('telling the two kinds apart', () => {
  it('recognises a sequence diagram by its lifelines', () => {
    expect(isSequenceDiagram(build(SAMPLE))).toBe(true);
  });

  it('does not claim an ordinary selection', () => {
    // The check that decides whether `diagramToMermaid` is allowed to run.
    const plain = [
      { id: 'a', type: 'shape', x: 0, y: 0, width: 10, height: 10, geometry: { kind: 'rect' } },
    ] as unknown as AnyNode[];
    expect(isSequenceDiagram(plain)).toBe(false);
  });

  it('answers nothing for a board with no sequence diagram on it', () => {
    expect(sequenceToMermaid([])).toBeNull();
  });
});

describe('the round trip', () => {
  it('keeps every participant, in order', () => {
    const back = roundTrip(SAMPLE);
    expect(back.participants.map((p) => p.key)).toEqual(['User', 'App', 'API']);
  });

  it('keeps their labels', () => {
    const back = roundTrip(SAMPLE);
    expect(back.participants.map((p) => p.label)).toEqual([
      'End user',
      'Single-page app',
      'Resource API',
    ]);
  });

  it('remembers which one was an actor', () => {
    // Recovered from the corner radius that drew it as a pill — there is no
    // other record, so this is the assertion that keeps the two in step.
    const back = roundTrip(SAMPLE);
    expect(back.participants.map((p) => p.actor)).toEqual([true, false, false]);
  });

  it('keeps every message, in the order they were written', () => {
    const back = roundTrip(SAMPLE);
    const messages = back.steps.filter((s) => s.kind === 'message');
    expect(messages.map((m) => (m.kind === 'message' ? [m.from, m.to, m.label] : []))).toEqual([
      ['User', 'App', 'Click sign in'],
      ['App', 'API', 'GET /me'],
      ['API', 'App', 'Profile'],
      ['App', 'User', 'Bounced'],
    ]);
  });

  it('keeps a dotted reply dotted', () => {
    const back = roundTrip(SAMPLE);
    const reply = back.steps.find((s) => s.kind === 'message' && s.label === 'Profile');
    expect(reply).toMatchObject({ line: 'dotted', head: 'arrow' });
  });

  it('keeps a lost message lost', () => {
    // `-x` is drawn with a bar, because there is no cross cap. It has to come
    // back as `-x` rather than as an ordinary arrow.
    const back = roundTrip(SAMPLE);
    const lost = back.steps.find((s) => s.kind === 'message' && s.label === 'Bounced');
    expect(lost).toMatchObject({ head: 'cross' });
  });

  it('keeps an open arrow open', () => {
    const back = roundTrip('sequenceDiagram\n  A->B: plain');
    expect(back.steps[0]).toMatchObject({ head: 'open', line: 'solid' });
  });

  it('keeps the note and what it covers', () => {
    const back = roundTrip(SAMPLE);
    const note = back.steps.find((s) => s.kind === 'note');
    expect(note).toMatchObject({
      kind: 'note',
      over: ['App', 'API'],
      text: 'The token never leaves the tab',
    });
  });

  it('puts the note back between the messages it sat between', () => {
    const back = roundTrip(SAMPLE);
    const kinds = back.steps.map((s) => s.kind);
    expect(kinds).toEqual(['message', 'message', 'message', 'note', 'message']);
  });

  it('keeps a self-message on itself', () => {
    const back = roundTrip('sequenceDiagram\n  A->>A: think\n  A->>B: go');
    expect(back.steps[0]).toMatchObject({ from: 'A', to: 'A' });
  });

  it('survives a second trip unchanged', () => {
    /**
     * The property that matters for editing: open, apply, open again. If the
     * emitter and the builder disagreed even slightly, a diagram would drift a
     * little further from itself every time somebody looked at it.
     */
    const once = sequenceToMermaid(build(SAMPLE))!;
    const twice = sequenceToMermaid(build(once))!;
    expect(twice).toBe(once);
  });
});

describe('what is known not to survive', () => {
  it('brings an async message back as an ordinary one', () => {
    /**
     * Recorded rather than hidden. `-)` and `->>` are drawn with the same
     * arrowhead because every cap in this vocabulary is filled and there is no
     * open one to spend on async, so the distinction is gone by the time the
     * board holds it. Somebody will notice their `-)` became `->>`, and this
     * is where the answer is.
     */
    const back = roundTrip('sequenceDiagram\n  A-)B: fire and forget');
    expect(back.steps[0]).toMatchObject({ head: 'arrow' });
  });
});
