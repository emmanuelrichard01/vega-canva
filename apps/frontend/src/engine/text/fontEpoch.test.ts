import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * These cover the failure that made stickies land wrong on a cold load: the
 * epoch moved once, early, against a face nobody had asked for, and never
 * moved again when the real one arrived.
 */

type Load = (spec: string) => Promise<unknown[]>;

/**
 * A fresh copy of the module with a stubbed font system.
 *
 * Fresh because the "asked" set is module scope and the whole point of it is
 * that it persists. `ready` is a promise that never settles, so the backstops
 * stay out of the way and each test observes only what it triggered.
 */
async function withFonts(load: Load) {
  vi.resetModules();
  (globalThis as unknown as { document: unknown }).document = {
    fonts: { load, ready: new Promise<void>(() => {}), addEventListener: () => {} },
  };
  return import('./fontEpoch');
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe('fontEpoch', () => {
  it('asks the font system for the face it was given', async () => {
    const load = vi.fn<Load>(() => Promise.resolve([{}]));
    const { requestFont } = await withFonts(load);

    requestFont('600 16px Caveat');

    expect(load).toHaveBeenCalledWith('600 16px Caveat');
  });

  it('asks once per face however many times it is requested', async () => {
    // The dedupe is not only politeness: a bump re-renders subscribers, and a
    // subscriber that requests a font while rendering would otherwise request
    // it again on the render its own request caused.
    const load = vi.fn<Load>(() => Promise.resolve([{}]));
    const { requestFont } = await withFonts(load);

    requestFont('600 16px Caveat');
    requestFont('600 16px Caveat');
    requestFont('16px Lora');
    requestFont('600 16px Caveat');

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('moves the epoch when the face actually arrives, invalidating before notifying', async () => {
    let settle: (faces: unknown[]) => void = () => {};
    const load = vi.fn<Load>(() => new Promise<unknown[]>((res) => { settle = res; }));
    const { requestFont, fontEpoch, onFontsChanged } = await withFonts(load);

    const order: string[] = [];
    onFontsChanged(() => order.push('invalidate'));
    fontEpoch.subscribe(() => order.push('notify'));

    const before = fontEpoch.get();
    requestFont('600 16px Caveat');

    // Nothing has landed yet, so nothing has changed.
    expect(fontEpoch.get()).toBe(before);
    expect(order).toEqual([]);

    settle([{}]);
    await vi.waitFor(() => expect(order.length).toBe(2));

    expect(fontEpoch.get()).toBe(before + 1);
    // A subscriber re-measures, so every cache it might read has to have been
    // thrown away first.
    expect(order).toEqual(['invalidate', 'notify']);
  });

  it('leaves the epoch alone when no face matched', async () => {
    // A generic family, or one we do not ship. The fallback is already what is
    // drawn, so the measurements against it are correct and re-running them
    // would only throw away good work.
    const load = vi.fn<Load>(() => Promise.resolve([]));
    const { requestFont, fontEpoch } = await withFonts(load);

    const seen: number[] = [];
    fontEpoch.subscribe(() => seen.push(fontEpoch.get()));

    requestFont('16px cursive');
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual([]);
    expect(fontEpoch.get()).toBe(0);
  });

  it('survives a load the font system refuses', async () => {
    const load = vi.fn<Load>(() => Promise.reject(new Error('bad shorthand')));
    const { requestFont, fontEpoch } = await withFonts(load);

    expect(() => requestFont('nonsense')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(fontEpoch.get()).toBe(0);
  });

  it('does nothing at all where there is no font system', async () => {
    vi.resetModules();
    delete (globalThis as unknown as { document?: unknown }).document;
    const { requestFont, fontEpoch } = await import('./fontEpoch');

    expect(() => requestFont('600 16px Caveat')).not.toThrow();
    expect(fontEpoch.get()).toBe(0);
  });
});
