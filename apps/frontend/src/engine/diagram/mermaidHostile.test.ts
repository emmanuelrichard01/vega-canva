import { describe, expect, it } from 'vitest';
import { parseMermaid, parseMermaidLenient, MAX_STATEMENT_LENGTH } from './mermaid';
import { parseSequence } from './sequence';

/**
 * Diagram source is pasted from anywhere and reparsed on every settled edit;
 * the lenient parse may run it a dozen more times. Each input below is shaped
 * against one pattern, at the longest statement the parser accepts.
 */
const N = MAX_STATEMENT_LENGTH - 64;

const fast = (fn: () => unknown) => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

describe('mermaid parsing is linear in the statement', () => {
  const cases: Record<string, string> = {
    inlineLabelSpaces: 'A -- x' + ' '.repeat(N) + 'y',
    inlineLabelDashes: 'A -- x' + '-'.repeat(N),
    pipedSpaces: 'A -->|' + ' '.repeat(N),
    classSpaces: 'class a' + ' '.repeat(N) + '!',
    classList: 'class ' + 'a,'.repeat(N / 2) + ' !',
    subgraphSpaces: 'subgraph s [' + ' '.repeat(N),
    connectors: 'A ' + '-'.repeat(N) + '> B',
  };
  for (const [name, statement] of Object.entries(cases)) {
    it(name, () => {
      const source = `flowchart TD\n${statement}`;
      expect(fast(() => parseMermaidLenient(source))).toBeLessThan(500);
    });
  }

  it('a statement past the limit is an error, not a parse', () => {
    const r = parseMermaid(`flowchart TD\nA --> ${'B'.repeat(MAX_STATEMENT_LENGTH)}`);
    expect(r.graph).toBeNull();
    expect(r.errorLine).toBe(2);
  });
});

describe('mermaid reports what it cannot read', () => {
  it('trailing text after a chain is an error, not silently dropped', () => {
    const r = parseMermaid('flowchart TD\nA --> B !!! C');
    expect(r.graph).toBeNull();
    expect(r.error).toMatch(/Line 2/);
  });

  it('ordinary chains and labels still parse', () => {
    const r = parseMermaid('flowchart LR\nA[Start] -- yes --> B{Ok?} -->|no| C\nB --> D;');
    expect(r.error).toBeNull();
    expect(r.graph!.edges.map((e) => [e.from, e.to, e.label ?? ''])).toEqual([
      ['A', 'B', 'yes'],
      ['B', 'C', 'no'],
      ['B', 'D', ''],
    ]);
  });

  it('class lists with spaces around commas still apply', () => {
    const r = parseMermaid('flowchart TD\nA --> B\nclassDef hot fill:#f00\nclass A , B hot');
    expect(r.error).toBeNull();
    for (const n of r.graph!.nodes) expect(n.style?.fill).toBe('#f00');
  });

  it('a style colour that is not a colour is dropped', () => {
    const r = parseMermaid('flowchart TD\nA --> B\nstyle A fill:red" onmouseover="alert(1),stroke:rgb(1,2,3)');
    expect(r.error).toBeNull();
    const a = r.graph!.nodes.find((n) => n.key === 'A')!;
    expect(a.style?.fill).toBeUndefined();
    expect(a.style?.stroke).toBe('rgb(1,2,3)');
  });
});

describe('sequence parsing is linear', () => {
  it('a note target of spaces', () => {
    const source = `sequenceDiagram\nnote over${' '.repeat(N)}`;
    expect(fast(() => parseSequence(source))).toBeLessThan(500);
  });
});

describe('an arrow with no target', () => {
  it('is an error on its own line, not a silent success', async () => {
    const { parseMermaid } = await import('./mermaid');
    const result = parseMermaid('flowchart TD\n  A --> B\n  B -->');
    expect(result.graph).toBeNull();
    expect(result.errorLine).toBe(3);
    expect(result.error).toMatch(/needs a box to point to/);
  });

  it('still accepts a complete edge with a label', async () => {
    const { parseMermaid } = await import('./mermaid');
    expect(parseMermaid('flowchart TD\n  A -->|yes| B').graph).not.toBeNull();
  });
});
