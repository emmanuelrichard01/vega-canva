import { describe, it, expect } from 'vitest';
import {
  expireNotices,
  hasExpiring,
  MAX_VISIBLE,
  NOTICE_LIFETIME,
  pushNotice,
  type Notice,
} from './notices';

const T0 = 1_000_000;

/** Push a run of messages onto an empty list, each one millisecond apart. */
function push(inputs: Parameters<typeof pushNotice>[1][], from = T0): Notice[] {
  return inputs.reduce<Notice[]>((list, input, i) => pushNotice(list, input, from + i), []);
}

describe('pushNotice', () => {
  it('gives each tone the lifetime it deserves, not the caller’s guess', () => {
    const [info] = push([{ message: 'a', tone: 'info' }]);
    const [warn] = push([{ message: 'a', tone: 'warning' }]);
    expect(info.expiresAt).toBe(T0 + NOTICE_LIFETIME.info!);
    expect(warn.expiresAt).toBe(T0 + NOTICE_LIFETIME.warning!);
  });

  it('never puts an expiry on an error', () => {
    /**
     * The rule the old single-toast system got wrong: "That SVG could not be
     * read" was given the same 3.2 seconds as "Copied", so the only message
     * worth reading was the one most likely to be missed.
     */
    const [error] = push([{ message: 'broke', tone: 'error' }]);
    expect(error.expiresAt).toBeNull();
  });

  it('lets a caller override the lifetime when it genuinely knows better', () => {
    const [pinned] = push([{ message: 'a', tone: 'info', duration: null }]);
    expect(pinned.expiresAt).toBeNull();
  });

  it('defaults to info when no tone is given', () => {
    const [n] = push([{ message: 'a' }]);
    expect(n.tone).toBe('info');
  });

  it('folds a repeat into a count rather than stacking a copy', () => {
    let list = push([{ message: 'That SVG could not be read', tone: 'error' }]);
    list = pushNotice(list, { message: 'That SVG could not be read', tone: 'error' }, T0 + 500);
    list = pushNotice(list, { message: 'That SVG could not be read', tone: 'error' }, T0 + 900);
    expect(list).toHaveLength(1);
    expect(list[0].repeats).toBe(3);
  });

  it('treats the same sentence in a different tone as a different notice', () => {
    // "Placed 9 images" as a success and as a warning are two outcomes that
    // happen to share a sentence; folding them would hide the one that mattered.
    let list = push([{ message: 'Placed 9 images', tone: 'success' }]);
    list = pushNotice(list, { message: 'Placed 9 images', tone: 'warning' }, T0 + 100);
    expect(list).toHaveLength(2);
  });

  it('stops folding once the repeat window has passed', () => {
    let list = push([{ message: 'Copied', tone: 'success' }]);
    list = pushNotice(list, { message: 'Copied', tone: 'success' }, T0 + 60_000);
    expect(list).toHaveLength(2);
  });

  it('restarts the clock on a repeat, because it has just happened again', () => {
    let list = push([{ message: 'Copied', tone: 'success' }]);
    list = pushNotice(list, { message: 'Copied', tone: 'success' }, T0 + 3000);
    expect(list[0].expiresAt).toBe(T0 + 3000 + NOTICE_LIFETIME.success!);
  });

  it('shows no more than the cap', () => {
    const list = push([
      { message: 'a' },
      { message: 'b' },
      { message: 'c' },
      { message: 'd' },
      { message: 'e' },
    ]);
    expect(list).toHaveLength(MAX_VISIBLE);
  });

  it('drops the oldest when it is over the cap', () => {
    const list = push([{ message: 'a' }, { message: 'b' }, { message: 'c' }, { message: 'd' }]);
    expect(list.map((n) => n.message)).toEqual(['b', 'c', 'd']);
  });

  it('never evicts an error to make room for chatter', () => {
    /**
     * The property that makes the cap safe. An error is in the list because it
     * is waiting for a person; if the cap could take it, then a burst of
     * "Copied" would silently carry away the one thing that needed reading.
     */
    let list = push([{ message: 'broke', tone: 'error' }]);
    for (const message of ['a', 'b', 'c', 'd', 'e']) {
      list = pushNotice(list, { message, tone: 'success' }, T0 + 100);
    }
    expect(list).toHaveLength(MAX_VISIBLE);
    expect(list.some((n) => n.tone === 'error')).toBe(true);
  });

  it('keeps the newest when every notice is an error', () => {
    // Nothing is evictable, so the cap has to fall back to trimming rather
    // than growing without bound.
    let list: Notice[] = [];
    for (const message of ['a', 'b', 'c', 'd', 'e']) {
      list = pushNotice(list, { message, tone: 'error' }, T0);
    }
    expect(list).toHaveLength(MAX_VISIBLE);
    expect(list.map((n) => n.message)).toEqual(['c', 'd', 'e']);
  });

  it('carries an action across a fold, so a repeat does not lose its button', () => {
    const run = () => {};
    let list = push([{ message: 'Deleted 3 objects', tone: 'info' }]);
    list = pushNotice(
      list,
      { message: 'Deleted 3 objects', tone: 'info', action: { label: 'Undo', run } },
      T0 + 200
    );
    expect(list[0].action?.label).toBe('Undo');
  });

  it('gives every notice its own id', () => {
    const list = push([{ message: 'a' }, { message: 'b' }, { message: 'c' }]);
    expect(new Set(list.map((n) => n.id)).size).toBe(3);
  });
});

describe('expireNotices', () => {
  it('takes away what is past its time and leaves the rest', () => {
    const list = push([
      { message: 'gone', tone: 'success' },
      { message: 'staying', tone: 'error' },
    ]);
    const after = expireNotices(list, T0 + NOTICE_LIFETIME.success! + 1);
    expect(after.map((n) => n.message)).toEqual(['staying']);
  });

  it('treats the deadline as the moment it goes, not the last moment it stays', () => {
    /**
     * A boundary nobody can perceive, pinned only so the two halves agree: the
     * scheduler aims a timer at `expiresAt` and this must remove the notice
     * when that timer lands, or the tick fires, finds nothing to do, and
     * re-aims at the same instant forever.
     */
    const list = push([{ message: 'a', tone: 'success' }]);
    const deadline = T0 + NOTICE_LIFETIME.success!;
    expect(expireNotices(list, deadline - 1)).toHaveLength(1);
    expect(expireNotices(list, deadline)).toHaveLength(0);
  });
});

describe('hasExpiring', () => {
  it('is false when nothing is on a timer, so no tick is scheduled', () => {
    expect(hasExpiring(push([{ message: 'a', tone: 'error' }]))).toBe(false);
    expect(hasExpiring([])).toBe(false);
  });

  it('is true as soon as anything is', () => {
    expect(hasExpiring(push([{ message: 'a', tone: 'error' }, { message: 'b' }]))).toBe(true);
  });
});
