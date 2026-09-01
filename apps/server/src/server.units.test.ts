import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryBuffer, KnownRooms } from './historyBuffer';
import { checkRoomId, sanitizeRoomId } from './rooms';
import { isAllowedUpload, safeExtension, serveAs, ALLOWED_MIME_TYPES } from './media';

describe('room identifiers', () => {
  it('accepts the ids the client actually generates', () => {
    // nanoid(10) over the URL alphabet.
    for (const id of ['aBc123XyZ0', 'room_with-dashes', 'A1b2C3d4E5']) {
      expect(checkRoomId(id, 8), id).toEqual({ ok: true });
    }
  });

  it('rejects path traversal and anything outside the alphabet', () => {
    for (const id of ['../etc/passwd', 'room/../other', 'room id', 'room.id']) {
      expect(checkRoomId(id, 8).ok, id).toBe(false);
    }
  });

  it('refuses ids short enough to enumerate', () => {
    /**
     * The whole access model is "the room id is the capability", and the
     * validator used to be `{1,128}`. One character. Every board whose address
     * was short enough to have been typed by hand was reachable by walking a
     * few thousand ids.
     */
    for (const id of ['a', 'ab', 'abc', 'abcdefg']) {
      const check = checkRoomId(id, 8);
      expect(check.ok, id).toBe(false);
      // The message describes the rule and never the value.
      expect(check.reason).not.toContain(id);
    }
    expect(checkRoomId('abcdefgh', 8).ok).toBe(true);
  });

  it('rejects an absurdly long id', () => {
    expect(checkRoomId('a'.repeat(129), 8).ok).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    for (const id of [undefined, null, 42, {}, []]) {
      expect(checkRoomId(id, 8).ok).toBe(false);
    }
  });

  it('strips a room id down to something safe for a storage key', () => {
    expect(sanitizeRoomId('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeRoomId('good_id-123')).toBe('good_id-123');
    expect(sanitizeRoomId(undefined)).toBe('');
  });
});

describe('media allow-lists', () => {
  it('excludes SVG, which is a document and not an image', () => {
    expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);
    expect(isAllowedUpload('image/svg+xml', 'logo.svg')).toBe(false);
    // And an SVG wearing a PNG's type is refused by the extension.
    expect(isAllowedUpload('image/png', 'payload.svg')).toBe(false);
  });

  it('requires the type and the extension to agree that it is allowed', () => {
    expect(isAllowedUpload('image/png', 'a.png')).toBe(true);
    expect(isAllowedUpload('text/html', 'a.png')).toBe(false);
    expect(isAllowedUpload('image/png', 'a.html')).toBe(false);
  });

  it('never stores an extension it does not recognise', () => {
    expect(safeExtension('thing.png')).toBe('.png');
    expect(safeExtension('thing.PNG')).toBe('.png');
    expect(safeExtension('thing.php')).toBe('.bin');
    expect(safeExtension('noextension')).toBe('.bin');
  });

  it('serves a known extension as its own type and an unknown one as a download', () => {
    expect(serveAs('x.png')).toEqual({ type: 'image/png', render: true });
    expect(serveAs('x.m4a')).toEqual({ type: 'audio/mp4', render: true });
    // The important one: nothing is ever served as the type the client claimed.
    expect(serveAs('x.svg')).toEqual({ type: 'application/octet-stream', render: false });
    expect(serveAs('x.bin')).toEqual({ type: 'application/octet-stream', render: false });
  });
});

describe('KnownRooms', () => {
  it('reports a room as needing insertion exactly once', () => {
    const known = new KnownRooms();
    expect(known.needsInsert('a')).toBe(true);
    expect(known.needsInsert('a')).toBe(false);
    expect(known.needsInsert('b')).toBe(true);
  });

  it('forgets everything rather than growing without bound', () => {
    const known = new KnownRooms(3);
    known.needsInsert('a');
    known.needsInsert('b');
    known.needsInsert('c');
    // The fourth trips the limit, so the set is cleared and `a` is new again.
    expect(known.needsInsert('d')).toBe(true);
    expect(known.needsInsert('a')).toBe(true);
  });
});

describe('HistoryBuffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const bytes = (n: number) => new Uint8Array([n]);

  it('batches many updates into one write', async () => {
    // The point of the whole thing. onChange fires per Yjs transaction, which
    // during a drag is every few frames, and each one used to be two queries.
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 1000 });

    for (let i = 0; i < 30; i += 1) buffer.add('room', bytes(i));
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toHaveLength(30);
  });

  it('flushes early once the batch is large', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = new HistoryBuffer({ write, maxBatch: 5, flushIntervalMs: 60_000 });

    for (let i = 0; i < 5; i += 1) buffer.add('room', bytes(i));
    await vi.advanceTimersByTimeAsync(0);

    // Without this a burst would sit in memory for the whole interval.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('keeps order across rooms within a batch', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 10 });

    buffer.add('a', bytes(1));
    buffer.add('b', bytes(2));
    buffer.add('a', bytes(3));
    await vi.advanceTimersByTimeAsync(10);

    // Replay applies deltas in order; a reordered batch is a corrupt history.
    expect(write.mock.calls[0][0].map((u: any) => [u.roomId, u.update[0]])).toEqual([
      ['a', 1],
      ['b', 2],
      ['a', 3],
    ]);
  });

  it('puts a failed batch back, in front, and retries it', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 10, onError });

    buffer.add('a', bytes(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledOnce();

    buffer.add('a', bytes(2));
    await buffer.flush();

    // The retry carries the failed update first, so ordering survives.
    expect(write.mock.calls[1][0].map((u: any) => u.update[0])).toEqual([1, 2]);
  });

  it('drops the oldest rather than growing without bound', async () => {
    // Backpressure. If the database is unreachable the queue is the only thing
    // that grows, and running out of memory takes live sync down with it --
    // sync is the product, history is a convenience.
    const write = vi.fn().mockRejectedValue(new Error('still down'));
    const buffer = new HistoryBuffer({ write, maxQueue: 10, maxBatch: 1000, flushIntervalMs: 10 });

    for (let i = 0; i < 25; i += 1) buffer.add('a', bytes(i));

    expect(buffer.depth).toBeLessThanOrEqual(10);
    expect(buffer.dropped).toBeGreaterThan(0);
  });

  it('writes everything still queued when drained', async () => {
    // What makes batching safe across a deploy.
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 60_000 });

    buffer.add('a', bytes(1));
    await buffer.drain();

    expect(write).toHaveBeenCalledTimes(1);

    // And nothing is accepted afterwards, so a late transaction during
    // shutdown cannot be silently lost in a buffer nobody will flush.
    buffer.add('a', bytes(2));
    expect(buffer.depth).toBe(0);
  });

  it('does not run two writes at once', async () => {
    let release: () => void = () => {};
    const write = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; })
    );
    const buffer = new HistoryBuffer({ write, flushIntervalMs: 10 });

    buffer.add('a', bytes(1));
    void buffer.flush();
    buffer.add('a', bytes(2));
    void buffer.flush();

    // Two overlapping writers would interleave rows and lose the ordering
    // replay depends on.
    expect(write).toHaveBeenCalledTimes(1);
    release();
  });
});

// The two tests that stood here decoded a JWT they had just built and
// asserted against a `checkScope` helper defined three lines above -- neither
// touched the server. The real parser is now `connection.ts`, tested in
// `connection.test.ts` against the behaviour `onAuthenticate` actually has.
