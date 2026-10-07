import { describe, expect, it } from 'vitest';
import { highlightMermaid, highlightMermaidLine } from './mermaidHighlight';
import { MERMAID_TEMPLATES } from './mermaidTemplates';
import { thumbFor } from './templateThumb';
import { DIAGRAM_THEMES, themeForBoard } from './mermaid';

const joined = (line: string) => highlightMermaidLine(line).map((t) => t.text).join('');
const kindOf = (line: string, text: string) => highlightMermaidLine(line).find((t) => t.text.includes(text))?.kind;

describe('highlightMermaidLine', () => {
  it('gives back every character, in order, whatever the line', () => {
    for (const t of MERMAID_TEMPLATES) {
      for (const line of t.source.split('\n')) expect(joined(line)).toBe(line);
    }
    for (const hostile of ['A[unclosed', '|||', '-->-->', '"', '%%', '   ', '<script>alert(1)</script>', 'A((((x']) {
      expect(joined(hostile)).toBe(hostile);
    }
  });

  it('names the parts of a flowchart line', () => {
    expect(kindOf('flowchart LR', 'flowchart')).toBe('keyword');
    expect(kindOf('flowchart LR', 'LR')).toBe('direction');
    expect(kindOf('  A[Start] -->|yes| B(Done)', '-->')).toBe('arrow');
    expect(kindOf('  A[Start] -->|yes| B(Done)', 'Start')).toBe('label');
    expect(kindOf('  A[Start] -->|yes| B(Done)', 'yes')).toBe('label');
    expect(kindOf('  A[Start] -->|yes| B(Done)', 'A')).toBe('id');
  });

  it('reads messages and comments', () => {
    expect(kindOf('  Alice->>Bob: Hello there', '->>')).toBe('arrow');
    expect(kindOf('  Alice->>Bob: Hello there', 'Hello')).toBe('label');
    expect(kindOf('  %% a note to self', 'note')).toBe('comment');
    expect(kindOf('  "Dogs" : 42', '42')).toBe('number');
    expect(kindOf('  A:::hot', ':::')).toBe('punct');
  });

  it('answers a repeated source from memory', () => {
    expect(highlightMermaid('graph TD')).toBe(highlightMermaid('graph TD'));
  });
});

describe('template thumbnails', () => {
  it('draws every template from its real layout', () => {
    for (const t of MERMAID_TEMPLATES) {
      const thumb = thumbFor(t);
      expect(thumb, t.id).not.toBeNull();
      expect(thumb!.width).toBeGreaterThan(0);
      expect(thumb!.boxes.length + thumb!.wedges.length).toBeGreaterThan(0);
    }
  });
});

describe('themeForBoard', () => {
  it('offers the night palette on a dark board and keeps a chosen light one on a light board', () => {
    expect(themeForBoard(true)).toBe('night');
    expect(themeForBoard(false)).toBe('indigo');
    expect(DIAGRAM_THEMES.night.textColor).toBeTruthy();
  });
});
