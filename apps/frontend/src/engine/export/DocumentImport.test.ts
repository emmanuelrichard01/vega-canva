import { describe, expect, it } from 'vitest';
import { describeImport, parseDocumentExport, SUPPORTED_IMPORT_VERSION } from './DocumentImport';

const validExport = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    exportedAt: '2026-08-13T10:30:00.000Z',
    objects: {
      a: { id: 'a', type: 'shape', x: 10, y: 20, width: 100, height: 50 },
      b: { id: 'b', type: 'sticky', x: 0, y: 0, width: 80, height: 80 },
    },
    comments: [],
    ...over,
  });

describe('parseDocumentExport', () => {
  it('reads a well-formed export', () => {
    const result = parseDocumentExport(validExport());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.document.nodes)).toEqual(['a', 'b']);
    expect(result.warnings).toEqual([]);
  });

  it('rejects text that is not JSON, without throwing', () => {
    const result = parseDocumentExport('<html>nope</html>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The message has to tell someone what to do instead — this is the error
    // people hit by picking the wrong file, which is the commonest mistake.
    expect(result.error).toMatch(/not valid JSON/i);
  });

  it('rejects valid JSON that is not one of our exports', () => {
    const result = parseDocumentExport(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no objects/i);
  });

  it('refuses a file from a newer build rather than half-reading it', () => {
    // Attempting it would silently drop fields this version does not know,
    // and a restore that loses half the document is worse than one that stops.
    const result = parseDocumentExport(validExport({ version: SUPPORTED_IMPORT_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/newer version/i);
  });

  it('skips unusable objects but keeps the rest, and names what it skipped', () => {
    const result = parseDocumentExport(
      JSON.stringify({
        version: 1,
        objects: {
          good: { id: 'good', type: 'shape', x: 0, y: 0, width: 10, height: 10 },
          alien: { id: 'alien', type: 'hologram', x: 0, y: 0 },
          nowhere: { id: 'nowhere', type: 'shape', x: 'NaN', y: null },
        },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.document.nodes)).toEqual(['good']);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/hologram/);
    // Named, not counted: "2 skipped" does not tell you whether the thing you
    // cared about survived.
    expect(result.warnings.join(' ')).toMatch(/nowhere/);
  });

  it('fails when nothing at all is restorable', () => {
    const result = parseDocumentExport(
      JSON.stringify({ version: 1, objects: { x: { type: 'hologram', x: 0, y: 0 } } })
    );
    expect(result.ok).toBe(false);
  });

  it('treats a missing version as v1 rather than refusing', () => {
    const result = parseDocumentExport(
      JSON.stringify({ objects: { a: { id: 'a', type: 'shape', x: 0, y: 0 } } })
    );
    expect(result.ok).toBe(true);
  });
});

describe('describeImport', () => {
  it('counts objects and dates the file', () => {
    const result = parseDocumentExport(validExport());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(describeImport(result.document)).toMatch(/^2 objects, exported /);
  });

  it('falls back to the count when there is no usable timestamp', () => {
    const result = parseDocumentExport(validExport({ exportedAt: 'not a date' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(describeImport(result.document)).toBe('2 objects');
  });
});
