import { describe, expect, it } from 'vitest';
import { expectedImages, pendingImages, waitForImages } from './imagesReady';

const loaded = () => ({ image: () => ({ complete: true }) });
const loading = () => ({ image: () => ({ complete: false }) });
const empty = () => ({ image: () => undefined });
const hidden = () => ({ image: () => ({ complete: false }), isVisible: () => false });
/** A canvas or a video frame: drawable the moment it is set. */
const notAnImageElement = () => ({ image: () => ({}) });

const stageOf = (nodes: Array<{ image: () => unknown }>) => ({ find: () => nodes as never });

describe('pendingImages', () => {
  it('is nothing to wait for when the export has no images', () => {
    expect(pendingImages(stageOf([loading()]), 0)).toBe(0);
  });

  it('waits for an element that has not finished loading', () => {
    expect(pendingImages(stageOf([loading()]), 1)).toBe(1);
    expect(pendingImages(stageOf([loaded()]), 1)).toBe(0);
  });

  it('waits for an image the stage does not have a node for yet', () => {
    /**
     * The gap this whole module exists for. Before `use-image` produces an
     * element there is nothing on the stage to listen to, so "every image node
     * is loaded" is trivially true at exactly the wrong moment -- and the
     * export captures an empty rectangle where the photograph should be.
     */
    expect(pendingImages(stageOf([]), 2)).toBe(2);
    expect(pendingImages(stageOf([loaded()]), 2)).toBe(1);
  });

  it('does not count a node whose element is not there yet', () => {
    expect(pendingImages(stageOf([empty()]), 1)).toBe(1);
  });

  it('treats a canvas or video frame as ready', () => {
    // `complete` is an HTMLImageElement thing. Its absence is not "loading".
    expect(pendingImages(stageOf([notAnImageElement()]), 1)).toBe(0);
  });

  it('ignores an image the isolation hid', () => {
    /**
     * An image outside the selection is hidden for the capture and will never
     * load if it is also off screen -- waiting for it would spend the entire
     * deadline on a picture that is not in the export.
     */
    expect(pendingImages(stageOf([hidden(), loaded()]), 1)).toBe(0);
  });

  it('never goes negative when the stage has more than the export needs', () => {
    expect(pendingImages(stageOf([loaded(), loaded()]), 1)).toBe(0);
  });
});

describe('waitForImages', () => {
  it('returns immediately when there is nothing to wait for', async () => {
    let scheduled = 0;
    await expect(
      waitForImages(stageOf([loaded()]), 1, 100, () => 0, () => { scheduled += 1; })
    ).resolves.toBe(true);
    expect(scheduled).toBe(0);
  });

  it('resolves once the last picture arrives', async () => {
    let complete = false;
    const stage = { find: () => [{ image: () => ({ complete }) }] as never };
    const run = waitForImages(stage, 1, 1000, () => 0, (fn) => setTimeout(fn, 0));
    setTimeout(() => { complete = true; }, 5);
    await expect(run).resolves.toBe(true);
  });

  it('gives up rather than hanging on an image that will never load', async () => {
    /**
     * A 404, an object store that is down, a data URI the browser refuses.
     * A missing picture is visible in the file; a hung export button is not
     * visible anywhere.
     */
    let clock = 0;
    const result = await waitForImages(
      stageOf([loading()]), 1, 50,
      () => (clock += 20),
      (fn) => fn()
    );
    expect(result).toBe(false);
  });
});

describe('expectedImages', () => {
  it('counts the images an export will contain', () => {
    expect(expectedImages([
      { type: 'image', src: 'a' },
      { type: 'sticky' },
      { type: 'image', src: 'b' },
    ])).toBe(2);
  });

  it('does not wait for an image nobody will see', () => {
    // Hidden from the Layers panel, so it is not in the export either.
    expect(expectedImages([{ type: 'image', src: 'a', hidden: true }])).toBe(0);
  });

  it('does not wait for an image with no source', () => {
    // It will never produce an element, so the wait would time out on every
    // export that contained one.
    expect(expectedImages([{ type: 'image' }])).toBe(0);
  });
});
