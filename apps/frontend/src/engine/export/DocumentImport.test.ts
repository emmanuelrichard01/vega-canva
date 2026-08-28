import { describe, expect, it } from 'vitest';
import {
  describeImport,
  describeOrigin,
  isSameRoom,
  parseDocumentExport,
  SUPPORTED_IMPORT_VERSION,
} from './DocumentImport';
import { roomFingerprint } from '../room/roomCode';

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

describe('what a backup says about itself', () => {
  /**
   * The exporter did not record any of this, so restoring offered "142
   * objects" and nothing else -- which does not answer the question somebody
   * actually has in front of two files in a downloads folder.
   */
  const ROOM = 'aBc123XyZ0';
  const withOrigin = (over: Record<string, unknown> = {}) =>
    parseDocumentExport(
      validExport({ title: 'Q3 planning wall', room: { fingerprint: roomFingerprint(ROOM) }, ...over })
    );

  it('carries the board name and a fingerprint of where it came from', () => {
    const result = withOrigin();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.title).toBe('Q3 planning wall');
    expect(describeOrigin(result.document)).toBe('Q3 planning wall');
  });

  it('never carries the room id itself', () => {
    // The id is the capability to edit the live board, and an export is a file
    // people attach to tickets and commit to repositories. A backup must not
    // be a key.
    const file = validExport({ title: 'Q3 planning wall', room: { fingerprint: roomFingerprint(ROOM) } });

    expect(file).not.toContain(ROOM);

    // And a file that names one anyway -- hand-written, or from some future
    // build that got this wrong -- is not read as provenance.
    const smuggled = parseDocumentExport(validExport({ room: { id: ROOM } }));
    expect(smuggled.ok).toBe(true);
    if (!smuggled.ok) return;
    expect(smuggled.document.room).toBeNull();
  });

  it('knows whether the file is this board or another one', () => {
    const result = withOrigin();
    if (!result.ok) return;

    // Rolling a board back to its own backup, versus overwriting it with a
    // different board. Both are "replace", and only one of them is a surprise.
    expect(isSameRoom(result.document, ROOM)).toBe(true);
    expect(isSameRoom(result.document, 'somethingElse')).toBe(false);
    expect(isSameRoom(result.document, '')).toBe(false);
  });

  it('says nothing rather than guessing, for a file written before this existed', () => {
    const result = parseDocumentExport(validExport());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.title).toBeNull();
    expect(result.document.room).toBeNull();
    expect(describeOrigin(result.document)).toBeNull();
    // No room recorded is not the same as a room that does not match.
    expect(isSameRoom(result.document, 'anything')).toBe(false);
  });

  it('says nothing when the file records a room but no name', () => {
    // A fingerprint is not something to show anybody. It answers one yes/no
    // question and is meaningless as a label.
    const result = withOrigin({ title: undefined });
    if (!result.ok) return;
    expect(describeOrigin(result.document)).toBeNull();
    expect(isSameRoom(result.document, ROOM)).toBe(true);
  });

  it('ignores a provenance block that is the wrong shape', () => {
    for (const room of [42, 'aBc123XyZ0', [], {}, { id: ROOM }, { fingerprint: '' }, { fingerprint: 7 }, null]) {
      const result = withOrigin({ room });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.document.room, JSON.stringify(room)).toBeNull();
    }
  });

  it('treats a blank or whitespace title as no title', () => {
    for (const title of ['', '   ', 0, false, null]) {
      const result = withOrigin({ title });
      if (!result.ok) continue;
      expect(result.document.title, JSON.stringify(title)).toBeNull();
    }
  });
});
