import { describe, expect, it } from 'vitest';
import { atPath, fromRecords, parseRemotePayload } from './chartSync';

/**
 * The shape-guessing, which is the part most likely to be wrong.
 *
 * All of this lived inline in a modal, so none of it was tested -- and it is
 * a pile of judgements about what somebody's JSON probably means, which is
 * exactly the kind of code that is wrong in ways nobody notices until a chart
 * comes out labelled with UUIDs.
 */

describe('atPath', () => {
  it('walks objects', () => {
    expect(atPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
  });

  /**
   * The reduce version this replaced could not index an array, so every
   * payload shaped `{ results: [ { series: [...] } ] }` -- which is a great
   * many of them -- resolved to undefined and reported "no table found".
   */
  it('indexes into arrays', () => {
    expect(atPath({ results: [{ rows: [1] }] }, 'results.0.rows')).toEqual([1]);
  });

  it('returns the whole payload for an empty path', () => {
    const payload = [1, 2];
    expect(atPath(payload, undefined)).toBe(payload);
  });

  it('gives up rather than throwing on a path that does not exist', () => {
    expect(atPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(atPath(null, 'a')).toBeUndefined();
    expect(atPath({ list: [] }, 'list.notanindex')).toBeUndefined();
  });
});

describe('fromRecords', () => {
  it('reads a records array as labels and numeric columns', () => {
    const data = fromRecords([
      { month: 'Jan', revenue: 12, cost: 8 },
      { month: 'Feb', revenue: 15, cost: 9 },
    ]);
    expect(data).toEqual({
      categories: ['Jan', 'Feb'],
      series: [
        { name: 'revenue', values: [12, 15] },
        { name: 'cost', values: [8, 9] },
      ],
    });
  });

  /**
   * The columns were read off `rows[0]` alone, so a first record missing a
   * field dropped that field from the whole table -- silently, and most often
   * on exactly the sparse real-world payload this is for.
   */
  it('gathers columns across every row, not just the first', () => {
    const data = fromRecords([
      { name: 'a', x: 1 },
      { name: 'b', x: 2, y: 9 },
    ]);
    expect(data?.series.map((s) => s.name)).toEqual(['x', 'y']);
    expect(data?.series[1].values).toEqual([null, 9]);
  });

  /**
   * "First string column" chose `id` on any payload that carries one, so a
   * chart of monthly revenue came out labelled with UUIDs.
   */
  it('labels by a name-ish column rather than by whichever came first', () => {
    const data = fromRecords([
      { id: 'f3a9-01', name: 'Jan', revenue: 12 },
      { id: 'c7b2-04', name: 'Feb', revenue: 15 },
    ]);
    expect(data?.categories).toEqual(['Jan', 'Feb']);
  });

  // Numbering beats a column of empty strings, which is what falling back to
  // a hard-coded `'id'` key produced.
  it('numbers the rows when nothing names them', () => {
    const data = fromRecords([{ v: 1 }, { v: 2 }]);
    expect(data?.categories).toEqual(['Row 1', 'Row 2']);
  });

  it('reads numbers that arrived as strings', () => {
    const data = fromRecords([{ name: 'a', v: '1,200' }]);
    expect(data?.series[0].values).toEqual([1200]);
  });

  it('declines a payload with nothing to plot', () => {
    expect(fromRecords([{ a: 'x' }, { a: 'y' }])).toBeNull();
    expect(fromRecords([])).toBeNull();
    expect(fromRecords(['not an object'])).toBeNull();
  });
});

describe('parseRemotePayload', () => {
  it('reads a bare JSON array', () => {
    const res = parseRemotePayload('[{"name":"a","v":1}]');
    expect(res.ok && res.rows).toBe(1);
  });

  it('reads CSV through the same parser the paste box uses', () => {
    const res = parseRemotePayload('Month,Revenue\nJan,12\nFeb,15');
    expect(res.ok && res.data.categories).toEqual(['Jan', 'Feb']);
  });

  it('finds the records inside a wrapper object', () => {
    const res = parseRemotePayload('{"data":{"rows":[{"name":"a","v":1}]}}', 'data.rows');
    expect(res.ok).toBe(true);
  });

  /**
   * Every failure names what went wrong and, where it can, what to do -- an
   * endpoint returning a shape nobody expected is the normal case here, and
   * "no valid categories recognized in payload" told nobody anything.
   */
  it('says why, rather than that something failed', () => {
    expect(parseRemotePayload('')).toEqual({ ok: false, error: 'The response was empty.' });

    const bad = parseRemotePayload('{oops');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('JSON');

    const wrapped = parseRemotePayload('{"rows":[{"name":"a","v":1}]}');
    expect(wrapped.ok).toBe(false);
    expect(!wrapped.ok && wrapped.error).toContain('data path');

    const missing = parseRemotePayload('{"rows":[]}', 'nope.here');
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain('nope.here');
  });
});
