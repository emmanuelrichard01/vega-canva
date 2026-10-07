import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeOf, isEmojiLike, nativeOf } from './emojiCode';
import { buildIndex, lookupEmoji, searchEmoji, shortcodeOf } from './emojiIndex';
import { withTone } from './emojiPrefs';
import { applyShortcode, shortcodeAt } from './shortcode';
import { bucketFor, emojiBitmap, emojiCacheSize, resetEmojiCanvasForTests, type EmojiRasteriser } from './emojiCanvas';

const index = buildIndex({
  version: 't',
  categories: [
    { id: 'smileys', label: 'Smileys & emotion' },
    { id: 'people', label: 'People & body' },
    { id: 'animals', label: 'Animals & nature' },
  ],
  emoji: [
    { c: '1f600', u: '😀', n: 'grinning face', k: ['grin'], g: 0 },
    { c: '1f604', u: '😄', n: 'grinning face with smiling eyes', k: ['smile', 'happy'], g: 0 },
    { c: '1f44d', u: '👍', n: 'thumbs up', k: ['agree', '+1'], g: 1, s: ['1f44d-1f3fb', '1f44d-1f3fc', '1f44d-1f3fd', '1f44d-1f3fe', '1f44d-1f3ff'] },
    { c: '1f408', u: '🐈', n: 'cat', k: ['pet'], g: 2 },
    { c: '1f5e3', u: '🗣️', n: 'speaking head', k: ['communicate', 'talk'], g: 1 },
    { c: '2764', u: '❤️', n: 'red heart', k: ['love'], g: 0 },
    { c: 'bad code', u: 'x', n: 'hostile', k: [], g: 0 },
    { c: '1f9e1', u: '🧡', n: 'orange heart', k: 'not-a-list', g: 99 },
  ],
});

describe('emoji codes', () => {
  it('drops variation selectors so a glyph typed either way finds the same file', () => {
    expect(codeOf('❤️')).toBe('2764');
    expect(codeOf('❤')).toBe('2764');
    expect(codeOf('👍🏽')).toBe('1f44d-1f3fd');
    expect(nativeOf('1f44d-1f3fd')).toBe('👍🏽');
  });

  it('refuses a code that is not one', () => {
    expect(nativeOf('../../etc')).toBe('');
  });

  it('accepts emoji sequences and rejects text at the read boundary', () => {
    expect(isEmojiLike('🚀')).toBe(true);
    expect(isEmojiLike('👩🏽‍💻')).toBe(true);
    expect(isEmojiLike('🏳️‍🌈')).toBe(true);
    expect(isEmojiLike('hello')).toBe(false);
    expect(isEmojiLike('🚀 launch')).toBe(false);
    expect(isEmojiLike('<img src=x>')).toBe(false);
    expect(isEmojiLike('🚀'.repeat(20))).toBe(false);
    expect(isEmojiLike(42)).toBe(false);
  });
});

describe('the catalogue', () => {
  it('drops entries that are not the documented shape and clamps bad fields', () => {
    expect(index.emoji.find((e) => e.n === 'hostile')).toBeUndefined();
    const orange = index.emoji.find((e) => e.c === '1f9e1')!;
    expect(orange.k).toEqual([]);
    expect(orange.g).toBeLessThan(index.categories.length);
  });

  it('finds an emoji by glyph, by toned glyph and with or without its selector', () => {
    expect(lookupEmoji(index, '👍')?.n).toBe('thumbs up');
    expect(lookupEmoji(index, '👍🏿')?.n).toBe('thumbs up');
    expect(lookupEmoji(index, '❤')?.n).toBe('red heart');
  });

  it('names the shortcode people type', () => {
    expect(shortcodeOf({ n: 'thumbs up' })).toBe('thumbs_up');
    expect(shortcodeOf({ n: 'grinning face with smiling eyes' })).toBe('grinning_face_with_smiling_eyes');
  });

  it('gives a toned glyph only to emoji that have tones', () => {
    const thumbs = lookupEmoji(index, '👍')!;
    expect(withTone(thumbs, 3)).toEqual({ code: '1f44d-1f3fd', native: '👍🏽' });
    expect(withTone(lookupEmoji(index, '🐈')!, 3).native).toBe('🐈');
  });
});

describe('search', () => {
  it('matches word prefixes across name and keywords', () => {
    expect(searchEmoji(index, 'thu up').map((e) => e.u)).toEqual(['👍']);
    expect(searchEmoji(index, 'love').map((e) => e.u)).toEqual(['❤️']);
  });

  it('matches the start of a word, not the middle of one', () => {
    // "cat" must not find "communicate".
    expect(searchEmoji(index, 'cat').map((e) => e.u)).toEqual(['🐈']);
  });

  it('ranks an exact name and a name prefix above a keyword hit', () => {
    const results = searchEmoji(index, 'grinning').map((e) => e.u);
    expect(results[0]).toBe('😀');
    expect(searchEmoji(index, 'smile')[0].u).toBe('😄');
  });

  it('reads a leading colon as a shortcode and returns nothing for nothing', () => {
    expect(searchEmoji(index, ':thumbs_up').map((e) => e.u)).toEqual(['👍']);
    expect(searchEmoji(index, '   ')).toEqual([]);
  });
});

describe(':shortcode autocomplete', () => {
  it('opens on a colon that starts a word, after two characters', () => {
    expect(shortcodeAt('hi :sm', 6)).toEqual({ start: 3, end: 6, query: 'sm' });
    expect(shortcodeAt(':ro', 3)?.query).toBe('ro');
    expect(shortcodeAt('hi :s', 5)).toBeNull();
  });

  it('stays closed for times, URLs and closed codes', () => {
    expect(shortcodeAt('at 10:30', 8)).toBeNull();
    expect(shortcodeAt('https://example', 15)).toBeNull();
    expect(shortcodeAt('a:bc', 4)).toBeNull();
    expect(shortcodeAt(':smile:', 6)).toBeNull();
  });

  it('replaces the query and puts the caret after the emoji', () => {
    const q = shortcodeAt('go :roc now', 7)!;
    expect(applyShortcode('go :roc now', q, '🚀')).toEqual({ text: 'go 🚀 now', caret: 5 });
  });
});

describe('the canvas emoji cache', () => {
  afterEach(() => resetEmojiCanvasForTests());

  /** A rasteriser that records what it was asked for and resolves on demand. */
  function fakeRasteriser() {
    const loads: string[] = [];
    const rasters: number[] = [];
    const closed: number[] = [];
    let failOn: string | null = null;
    const r: EmojiRasteriser = {
      loadSource: async (url) => {
        loads.push(url);
        if (failOn && url.includes(failOn)) throw new Error('404');
        return {} as CanvasImageSource;
      },
      rasterise: async (_src, size) => {
        rasters.push(size);
        return { image: { size } as unknown as CanvasImageSource, close: () => closed.push(size) };
      },
    };
    return { r, loads, rasters, closed, fail: (code: string) => (failOn = code) };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('picks the smallest bucket that covers the pixels on screen', () => {
    expect(bucketFor(10)).toBe(16);
    expect(bucketFor(16)).toBe(16);
    expect(bucketFor(17)).toBe(24);
    expect(bucketFor(9999)).toBe(512);
    expect(bucketFor(NaN)).toBe(16);
  });

  it('loads an emoji once and shares the raster across every caller at that size', async () => {
    const fake = fakeRasteriser();
    resetEmojiCanvasForTests(fake.r);
    expect(emojiBitmap('1f44d', 32).image).toBeNull();
    expect(emojiBitmap('1f44d', 32).image).toBeNull();
    await flush();
    const a = emojiBitmap('1f44d', 32).image;
    expect(a).not.toBeNull();
    expect(emojiBitmap('1f44d', 32).image).toBe(a);
    expect(fake.loads).toHaveLength(1);
    expect(fake.rasters).toEqual([32]);
  });

  it('keeps drawing the nearest size while a new bucket rasterises, reusing the source', async () => {
    const fake = fakeRasteriser();
    resetEmojiCanvasForTests(fake.r);
    emojiBitmap('1f44d', 32);
    await flush();
    const zoomed = emojiBitmap('1f44d', 128);
    expect(zoomed.image).toBe(emojiBitmap('1f44d', 32).image);
    await flush();
    expect((emojiBitmap('1f44d', 128).image as unknown as { size: number }).size).toBe(128);
    expect(fake.loads).toHaveLength(1);
  });

  it('reports artwork that does not exist, so the glyph is drawn instead', async () => {
    const fake = fakeRasteriser();
    fake.fail('ffff');
    resetEmojiCanvasForTests(fake.r);
    emojiBitmap('ffff', 32);
    await flush();
    await flush();
    expect(emojiBitmap('ffff', 32)).toEqual({ image: null, failed: true });
  });

  it('is bounded, and closes what it evicts', async () => {
    const fake = fakeRasteriser();
    resetEmojiCanvasForTests(fake.r);
    for (let i = 0; i < 400; i++) emojiBitmap(`1f${(600 + i).toString(16)}`, 16);
    await flush();
    await flush();
    expect(emojiCacheSize()).toBeLessThanOrEqual(320);
    // Every raster that did not keep a slot was closed, not leaked.
    expect(fake.closed).toHaveLength(400 - 320);
  });
});

describe('the index loader', () => {
  it('retries after a failed fetch instead of remembering the failure', async () => {
    const { loadEmojiIndex, resetEmojiIndexForTests } = await import('./emojiIndex');
    resetEmojiIndexForTests();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 'v', categories: [], emoji: [] }) });
    await expect(loadEmojiIndex(fetcher as unknown as typeof fetch)).rejects.toThrow();
    await expect(loadEmojiIndex(fetcher as unknown as typeof fetch)).resolves.toMatchObject({ version: 'v' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    resetEmojiIndexForTests();
  });
});
