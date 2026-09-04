import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMermaid, SHAPE_SPECS, type MermaidShape } from './mermaid';
import { looksLikeSequence, parseSequence } from './sequence';
import { looksLikePie, parsePie } from './pie';

/**
 * The templates are the first Mermaid most people here will ever read, and a
 * broken one is a worse first impression than no template at all -- it says
 * the feature does not work, using the feature's own words.
 *
 * Read out of the component source rather than imported, because they live
 * beside the dialog that offers them and exporting them only for a test would
 * be moving code to suit the test.
 */
const MODAL = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'components', 'MermaidModal.tsx'
);

interface Template {
  name: string;
  kind: 'flow' | 'sequence' | 'pie';
  source: string;
}

function templates(): Template[] {
  const src = readFileSync(MODAL, 'utf8');
  const start = src.indexOf('const TEMPLATES');
  const block = src.slice(start, src.indexOf('\n];', start));
  const re = /name: '([^']+)',\s*kind: '(flow|sequence|pie)',\s*source: `([\s\S]*?)`,/g;
  const out: Template[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out.push({ name: m[1], kind: m[2] as Template['kind'], source: m[3] });
  }
  return out;
}

const ALL = templates();
/**
 * The two engines are asserted separately because they are separate: a
 * sequence diagram has no `nodes` or `edges` to count and a flowchart has no
 * participants, so a single loop over everything could only test the
 * intersection -- which is nothing.
 */
const FLOWS = ALL.filter((t) => t.kind === 'flow');
const SEQUENCES = ALL.filter((t) => t.kind === 'sequence');
const PIES = ALL.filter((t) => t.kind === 'pie');

describe('the starter templates', () => {
  it('were all found', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(7);
  });

  it('offers all three engines', () => {
    // A set that was all flowcharts would leave the other two undiscoverable,
    // which is the same as not having built them.
    expect(FLOWS.length).toBeGreaterThanOrEqual(4);
    expect(SEQUENCES.length).toBeGreaterThanOrEqual(3);
    expect(PIES.length).toBeGreaterThanOrEqual(2);
  });

  it('declares the kind each one actually is', () => {
    // The label decides which parser runs, so a wrong one sends a perfectly
    // good template to an engine that cannot read it.
    for (const { name, kind, source } of ALL) {
      expect(looksLikeSequence(source), `${name} is labelled ${kind}`).toBe(kind === 'sequence');
      expect(looksLikePie(source), `${name} is labelled ${kind}`).toBe(kind === 'pie');
    }
  });

  it('every flowchart parses', () => {
    for (const { name, source } of FLOWS) {
      const { graph, error } = parseMermaid(source);
      expect(graph, `${name}: ${error}`).not.toBeNull();
    }
  });

  it('every one draws something worth looking at', () => {
    // A template that parses to two boxes teaches nothing about the tool.
    for (const { name, source } of FLOWS) {
      const graph = parseMermaid(source).graph!;
      expect(graph.nodes.length, name).toBeGreaterThanOrEqual(5);
      expect(graph.edges.length, name).toBeGreaterThanOrEqual(4);
    }
  });

  it('leaves no node stranded with no way in or out', () => {
    for (const { name, source } of FLOWS) {
      const graph = parseMermaid(source).graph!;
      const touched = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
      const stranded = graph.nodes.filter((n) => !touched.has(n.key)).map((n) => n.key);
      expect(stranded, `${name} has unreachable nodes`).toEqual([]);
    }
  });

  it('demonstrates the whole shape vocabulary between them', () => {
    /**
     * The point of the Shape Reference template. Fourteen shapes exist and
     * nothing else in the product tells you the syntax for them, so if the
     * templates do not show one, nobody will find it.
     */
    const seen = new Set<MermaidShape>();
    for (const { source } of FLOWS) {
      for (const node of parseMermaid(source).graph!.nodes) seen.add(node.shape);
    }
    const missing = (Object.keys(SHAPE_SPECS) as MermaidShape[]).filter((s) => !seen.has(s));
    expect(missing, 'shapes no template shows').toEqual([]);
  });

  it('demonstrates every line kind between them', () => {
    // Dotted and thick are the two things people ask for and do not guess.
    const lines = new Set(FLOWS.flatMap((t) => parseMermaid(t.source).graph!.edges.map((e) => e.line)));
    expect([...lines].sort()).toEqual(['dotted', 'solid', 'thick']);
  });

  it('shows how to style a diagram at least once', () => {
    const styled = FLOWS.some((t) => parseMermaid(t.source).graph!.nodes.some((n) => n.style));
    expect(styled, 'no template demonstrates classDef').toBe(true);
  });

  it('every sequence diagram parses', () => {
    for (const { name, source } of SEQUENCES) {
      const { diagram, error } = parseSequence(source);
      expect(diagram, `${name}: ${error}`).not.toBeNull();
    }
  });

  it('every sequence diagram is worth looking at', () => {
    for (const { name, source } of SEQUENCES) {
      const diagram = parseSequence(source).diagram!;
      expect(diagram.participants.length, name).toBeGreaterThanOrEqual(3);
      expect(diagram.steps.length, name).toBeGreaterThanOrEqual(6);
    }
  });

  it('uses nothing in a sequence template the parser has to skip', () => {
    /**
     * A template that triggers "previewing without line 4" is teaching the
     * reader that the feature is unreliable, in the feature's own words.
     */
    for (const { name, source } of SEQUENCES) {
      expect(parseSequence(source).skippedLines, `${name} has skipped lines`).toEqual([]);
    }
  });

  it('shows the arrow forms a sequence diagram has that a flowchart does not', () => {
    // Dotted replies, async and lost messages are the vocabulary somebody
    // would never guess. Between them the templates have to show each one.
    const heads = new Set(
      SEQUENCES.flatMap((t) =>
        parseSequence(t.source).diagram!.steps.flatMap((st) =>
          st.kind === 'message' ? [st.head] : []
        )
      )
    );
    expect([...heads].sort()).toEqual(['arrow', 'async', 'cross']);
  });

  it('every pie chart parses', () => {
    for (const { name, source } of PIES) {
      const { chart, error } = parsePie(source);
      expect(chart, `${name}: ${error}`).not.toBeNull();
    }
  });

  it('every pie chart is worth looking at', () => {
    for (const { name, source } of PIES) {
      const chart = parsePie(source).chart!;
      expect(chart.slices.length, name).toBeGreaterThanOrEqual(3);
      expect(chart.title, `${name} has no title`).not.toBe('');
    }
  });

  it('shows showData at least once', () => {
    // Nothing else in the product says the switch exists.
    expect(PIES.some((t) => parsePie(t.source).chart!.showData)).toBe(true);
  });

  it('demonstrates every block form between the sequence templates', () => {
    /**
     * `loop`, `alt`/`else`, `opt` and `par` are the constructs a sequence
     * diagram is mostly drawn *for*, and the syntax nobody guesses. If the
     * templates do not show one, nobody will find it.
     */
    const seen = new Set<string>();
    for (const { source } of SEQUENCES) {
      for (const step of parseSequence(source).diagram!.steps) {
        if (step.kind === 'block-start') seen.add(step.block);
      }
    }
    for (const block of ['loop', 'alt', 'opt', 'par']) {
      expect(seen.has(block), `no template shows ${block}`).toBe(true);
    }
  });

  it('explains itself in a comment', () => {
    // Each opens with `%%`. The template is the documentation -- there is
    // nowhere else in the product that says what any of this syntax does.
    for (const { name, source } of ALL) {
      expect(source.trimStart().startsWith('%%'), `${name} has no opening note`).toBe(true);
    }
  });
});
