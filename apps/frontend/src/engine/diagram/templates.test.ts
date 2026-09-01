import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMermaid, SHAPE_SPECS, type MermaidShape } from './mermaid';

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

function templates(): Array<{ name: string; source: string }> {
  const src = readFileSync(MODAL, 'utf8');
  const start = src.indexOf('const TEMPLATES');
  const block = src.slice(start, src.indexOf('\n];', start));
  const re = /name: '([^']+)',\s*source: `([\s\S]*?)`,/g;
  const out: Array<{ name: string; source: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push({ name: m[1], source: m[2] });
  return out;
}

const ALL = templates();

describe('the starter templates', () => {
  it('were all found', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(7);
  });

  it('every one parses', () => {
    for (const { name, source } of ALL) {
      const { graph, error } = parseMermaid(source);
      expect(graph, `${name}: ${error}`).not.toBeNull();
    }
  });

  it('every one draws something worth looking at', () => {
    // A template that parses to two boxes teaches nothing about the tool.
    for (const { name, source } of ALL) {
      const graph = parseMermaid(source).graph!;
      expect(graph.nodes.length, name).toBeGreaterThanOrEqual(5);
      expect(graph.edges.length, name).toBeGreaterThanOrEqual(4);
    }
  });

  it('leaves no node stranded with no way in or out', () => {
    for (const { name, source } of ALL) {
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
    for (const { source } of ALL) {
      for (const node of parseMermaid(source).graph!.nodes) seen.add(node.shape);
    }
    const missing = (Object.keys(SHAPE_SPECS) as MermaidShape[]).filter((s) => !seen.has(s));
    expect(missing, 'shapes no template shows').toEqual([]);
  });

  it('demonstrates every line kind between them', () => {
    // Dotted and thick are the two things people ask for and do not guess.
    const lines = new Set(ALL.flatMap((t) => parseMermaid(t.source).graph!.edges.map((e) => e.line)));
    expect([...lines].sort()).toEqual(['dotted', 'solid', 'thick']);
  });

  it('shows how to style a diagram at least once', () => {
    const styled = ALL.some((t) => parseMermaid(t.source).graph!.nodes.some((n) => n.style));
    expect(styled, 'no template demonstrates classDef').toBe(true);
  });

  it('explains itself in a comment', () => {
    // Each opens with `%%`. The template is the documentation -- there is
    // nowhere else in the product that says what any of this syntax does.
    for (const { name, source } of ALL) {
      expect(source.trimStart().startsWith('%%'), `${name} has no opening note`).toBe(true);
    }
  });
});
