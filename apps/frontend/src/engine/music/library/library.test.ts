import { describe, expect, it } from 'vitest';
import { categoryLabel, formatDuration, parseManifest, resolveMediaUrl } from './manifest';
import { advance, createQueue, currentId, cycleRepeat, jumpTo, nextIndex, peekNext, previous, setShuffle, shuffled } from './queue';
import { equalPowerGains, fadeLength } from './crossfade';

const BASE = 'https://media.example.com/music/manifest.json';
const track = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  category: 'piano',
  title: 'Morning Light',
  artist: 'Ana Ruiz',
  duration: 184.2,
  url: 'piano/morning-light.mp3',
  artwork: 'piano/morning-light.jpg',
  licence: 'CC BY 4.0, Ana Ruiz',
  ...over,
});

describe('manifest', () => {
  it('parses and resolves against the manifest location', () => {
    const m = parseManifest({ version: 1, tracks: [track()] }, BASE);
    expect(m.problems).toEqual([]);
    expect(m.tracks[0]).toEqual({
      id: 't1',
      category: 'piano',
      title: 'Morning Light',
      artist: 'Ana Ruiz',
      duration: 184.2,
      url: 'https://media.example.com/music/piano/morning-light.mp3',
      artwork: 'https://media.example.com/music/piano/morning-light.jpg',
      licence: 'CC BY 4.0, Ana Ruiz',
    });
    expect(m.categories).toEqual(['piano']);
  });

  it('requires a licence', () => {
    const m = parseManifest({ tracks: [track({ licence: '' }), track({ id: 't2', licence: undefined, license: 'CC0' })] }, BASE);
    expect(m.tracks.map((t) => t.id)).toEqual(['t2']);
    expect(m.problems[0]).toMatch(/licence/);
  });

  it('skips bad entries without losing the rest', () => {
    const m = parseManifest(
      {
        tracks: [
          track({ id: 'a' }),
          null,
          track({ id: 'b', url: 'javascript:alert(1)' }),
          track({ id: 'c', duration: -1 }),
          track({ id: 'd', category: 'Lo Fi!' }),
          track({ id: 'e', title: '' }),
          track({ id: 'f', category: 'lofi' }),
        ],
      },
      BASE
    );
    expect(m.tracks.map((t) => t.id)).toEqual(['a', 'f']);
    expect(m.problems).toHaveLength(5);
    expect(m.categories).toEqual(['piano', 'lofi']);
  });

  it('renames duplicate ids', () => {
    const m = parseManifest({ tracks: [track(), track(), track()] }, BASE);
    expect(m.tracks.map((t) => t.id)).toEqual(['t1', 't1~2', 't1~3']);
  });

  it('drops unsafe artwork but keeps the track', () => {
    const m = parseManifest({ tracks: [track({ artwork: 'data:image/png;base64,AAAA' })] }, BASE);
    expect(m.tracks[0].artwork).toBeNull();
    expect(m.problems[0]).toMatch(/artwork/);
  });

  it('rejects a manifest without tracks', () => {
    expect(parseManifest({}, BASE).problems).toEqual(['The manifest has no "tracks" array.']);
    expect(parseManifest('nope', BASE).tracks).toEqual([]);
  });

  it('allows http media only from an http base', () => {
    expect(resolveMediaUrl('http://cdn.example.com/a.mp3', 'https://site.example/m.json')).toBeNull();
    expect(resolveMediaUrl('a.mp3', 'http://127.0.0.1:9000/music/m.json')).toBe('http://127.0.0.1:9000/music/a.mp3');
  });

  it('labels and formats', () => {
    expect(categoryLabel('lofi')).toBe('Lo-fi');
    expect(categoryLabel('rainy-day')).toBe('Rainy Day');
    expect(formatDuration(184.9)).toBe('3:04');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('queue', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('plays in order and repeats all by default', () => {
    let q = createQueue(ids, { startId: 'c' });
    expect(currentId(q)).toBe('c');
    q = advance(q, true)!;
    expect(currentId(q)).toBe('d');
    q = advance(q, true)!;
    expect(currentId(q)).toBe('a');
  });

  it('stops at the end when repeat is off, but Next still wraps', () => {
    const q = createQueue(ids, { startId: 'd', repeat: 'off' });
    expect(advance(q, true)).toBeNull();
    expect(currentId(advance(q, false)!)).toBe('a');
    expect(peekNext(q)).toBeNull();
  });

  it('repeats one track on its own, not when skipped', () => {
    const q = createQueue(ids, { startId: 'b', repeat: 'one' });
    expect(nextIndex(q, true)).toBe(q.index);
    expect(currentId(advance(q, false)!)).toBe('c');
    expect(peekNext(q)).toBe('b');
  });

  it('shuffles deterministically, starting from the chosen track', () => {
    const a = createQueue(ids, { shuffle: true, seed: 9, startId: 'c' });
    const b = createQueue(ids, { shuffle: true, seed: 9, startId: 'c' });
    expect(a.order).toEqual(b.order);
    expect(a.order[0]).toBe('c');
    expect([...a.order].sort()).toEqual(ids);
  });

  it('keeps the current track when shuffle is toggled', () => {
    const q = createQueue(ids, { startId: 'b' });
    const s = setShuffle(q, true, ids, 3);
    expect(currentId(s)).toBe('b');
    const back = setShuffle(s, false, ids, 3);
    expect(back.order).toEqual(ids);
    expect(currentId(back)).toBe('b');
  });

  it('restarts after a few seconds, otherwise steps back', () => {
    const q = createQueue(ids, { startId: 'b' });
    expect(previous(q, 10).restart).toBe(true);
    const p = previous(q, 1);
    expect(p.restart).toBe(false);
    expect(currentId(p.queue)).toBe('a');
    expect(currentId(previous(createQueue(ids, { startId: 'a' }), 0).queue)).toBe('d');
  });

  it('cycles repeat modes and jumps', () => {
    expect(cycleRepeat('all')).toBe('one');
    expect(cycleRepeat('one')).toBe('off');
    expect(cycleRepeat('off')).toBe('all');
    expect(currentId(jumpTo(createQueue(ids), 'd'))).toBe('d');
    expect(currentId(jumpTo(createQueue(ids), 'zz'))).toBe('a');
  });

  it('shuffles every item exactly once', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(shuffled(items, 1).sort((x, y) => x - y)).toEqual(items);
    expect(shuffled(items, 1)).not.toEqual(items);
  });
});

describe('crossfade', () => {
  it('keeps power constant through the fade', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const g = equalPowerGains(p);
      expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1);
    }
    expect(equalPowerGains(0)).toEqual({ out: 1, in: 0 });
    expect(equalPowerGains(1).in).toBeCloseTo(1);
  });

  it('shortens the fade for short tracks', () => {
    expect(fadeLength(240, 200)).toBe(5);
    expect(fadeLength(9, 200)).toBe(3);
    expect(fadeLength(240, 200, 6)).toBe(6);
  });
});
