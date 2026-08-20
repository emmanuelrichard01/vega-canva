import { describe, expect, it, vi } from 'vitest';
import { inlineImageSources, isSelfContained } from './inlineImages';

/**
 * Whether an exported SVG survives being sent to somebody else.
 *
 * Media lives in object storage and the document holds only a URL, which is the
 * right architecture and the wrong thing to write into a file that leaves the
 * app. The failure is invisible from the exporting machine — the file opens and
 * the images are there — and total on any other one.
 *
 * The fetcher is injected so this runs in Node with no network and no canvas.
 */

/** Stands in for a fetched image; the contents never matter here. */
const blobOf = (text: string) => new Blob([text], { type: 'image/png' });

/** Deterministic stand-in for FileReader, which jsdom-less Node lacks. */
const fakeDataUri = async (blob: Blob) => `data:${blob.type};base64,${await blob.text()}`;

describe('isSelfContained', () => {
  it('recognises a data URI as needing nothing', () => {
    expect(isSelfContained('data:image/png;base64,AAAA')).toBe(true);
  });

  it('treats every remote scheme as needing fetching', () => {
    expect(isSelfContained('https://cdn.example.com/a.png')).toBe(false);
    expect(isSelfContained('http://localhost:9000/vega/a.png')).toBe(false);
    expect(isSelfContained('/uploads/a.png')).toBe(false);
  });
});

describe('inlineImageSources', () => {
  it('replaces a remote URL with its bytes', async () => {
    const fetcher = vi.fn(async () => blobOf('PIXELS'));
    const { embedded, failed } = await inlineImageSources(['https://x/a.png'], fetcher, fakeDataUri);

    expect(failed).toEqual([]);
    expect(embedded.get('https://x/a.png')).toBe('data:image/png;base64,PIXELS');
  });

  /**
   * The same photo placed six times must be one request and one copy of the
   * bytes. Without this, a moodboard exports at six times the size it needs and
   * makes six round trips to produce it.
   */
  it('fetches each distinct source once, however often it is used', async () => {
    const fetcher = vi.fn(async (url: string) => blobOf(url));
    const sources = ['https://x/a.png', 'https://x/a.png', 'https://x/b.png', 'https://x/a.png'];

    const { embedded } = await inlineImageSources(sources, fetcher, fakeDataUri);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(embedded.size).toBe(2);
  });

  it('leaves a data URI alone rather than fetching it', async () => {
    const fetcher = vi.fn(async () => blobOf('nope'));
    const { embedded, failed } = await inlineImageSources(
      ['data:image/png;base64,AAAA'],
      fetcher,
      fakeDataUri
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(embedded.size).toBe(0);
    expect(failed).toEqual([]);
  });

  it('skips empty sources without calling the fetcher', async () => {
    const fetcher = vi.fn(async () => blobOf('x'));
    await inlineImageSources(['', ''], fetcher, fakeDataUri);
    expect(fetcher).not.toHaveBeenCalled();
  });

  /**
   * A CORS refusal or a dead link must degrade the export, not lose it. The
   * URL stays in the file, which is exactly as good as the behaviour before
   * inlining existed.
   */
  it('reports a source it could not read instead of throwing', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('CORS');
    });

    const { embedded, failed } = await inlineImageSources(['https://x/a.png'], fetcher, fakeDataUri);

    expect(embedded.size).toBe(0);
    expect(failed).toEqual(['https://x/a.png']);
  });

  it('keeps the images it could read when another one fails', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('bad.png')) throw new Error('404');
      return blobOf('OK');
    });

    const { embedded, failed } = await inlineImageSources(
      ['https://x/good.png', 'https://x/bad.png'],
      fetcher,
      fakeDataUri
    );

    expect(embedded.get('https://x/good.png')).toContain('OK');
    expect(failed).toEqual(['https://x/bad.png']);
  });

  it('survives a reader that rejects as well as a fetch that does', async () => {
    const fetcher = vi.fn(async () => blobOf('x'));
    const badReader = async () => {
      throw new Error('unreadable');
    };

    const { failed } = await inlineImageSources(['https://x/a.png'], fetcher, badReader);
    expect(failed).toEqual(['https://x/a.png']);
  });

  it('returns empty results for an empty document', async () => {
    const fetcher = vi.fn(async () => blobOf('x'));
    const { embedded, failed } = await inlineImageSources([], fetcher, fakeDataUri);
    expect(embedded.size).toBe(0);
    expect(failed).toEqual([]);
  });
});
