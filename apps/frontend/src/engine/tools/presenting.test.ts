// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPresenterKeys, DIGIT_TIMEOUT_MS, isPresenting, presenterKeyAction, setPresenterKeys, setPresenting } from './presenting';

afterEach(() => setPresenting(false));

const press = (key: string, type: 'keydown' | 'keyup' = 'keydown') =>
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));

describe('presenting gate', () => {
  it('keeps every key from board listeners while presenting, whatever their phase', () => {
    const board = vi.fn();
    const boardCapture = vi.fn();
    // Registered after the module, as every component effect is.
    window.addEventListener('keydown', boardCapture, true);
    window.addEventListener('keydown', board);
    try {
      setPresenting(true);
      for (const key of ['1', 'Delete', 'z', 'v', 'Backspace']) press(key);
      expect(board).not.toHaveBeenCalled();
      expect(boardCapture).not.toHaveBeenCalled();

      setPresenting(false);
      press('Delete');
      expect(boardCapture).toHaveBeenCalledTimes(1);
      expect(board).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', boardCapture, true);
      window.removeEventListener('keydown', board);
    }
  });

  it('hands keydown, but not keyup, to the presenter', () => {
    const presenter = vi.fn();
    setPresenting(true);
    setPresenterKeys(presenter);
    press('ArrowRight');
    press('ArrowRight', 'keyup');
    expect(presenter).toHaveBeenCalledTimes(1);
  });

  it('swallows board pointer and wheel input but lets the presenter take clicks', () => {
    const board = vi.fn();
    document.body.addEventListener('pointerdown', board);
    const mask = document.createElement('div');
    mask.className = 'fp-root';
    const inner = document.createElement('button');
    mask.appendChild(inner);
    document.body.append(mask);
    const onControl = vi.fn();
    inner.addEventListener('pointerdown', onControl);
    try {
      setPresenting(true);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(board).not.toHaveBeenCalled();
      inner.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(onControl).toHaveBeenCalledTimes(1);
      const wheel = new Event('wheel', { bubbles: true, cancelable: true });
      inner.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
    } finally {
      document.body.removeEventListener('pointerdown', board);
      mask.remove();
    }
  });

  it('marks the root and clears the mark', () => {
    setPresenting(true);
    expect(isPresenting()).toBe(true);
    expect(document.documentElement.dataset.presenting).toBe('true');
    setPresenting(false);
    expect(document.documentElement.dataset.presenting).toBeUndefined();
  });
});

describe('presenterKeyAction', () => {
  const free = { focusOwnsKey: false, onControl: false };

  it('maps the show keys', () => {
    expect(presenterKeyAction(' ', free)).toBe('next');
    expect(presenterKeyAction('ArrowLeft', free)).toBe('previous');
    expect(presenterKeyAction('Home', free)).toBe('first');
    expect(presenterKeyAction('End', free)).toBe('last');
    expect(presenterKeyAction('x', free)).toBeNull();
  });

  it('leaves Space and Enter to a focused field, but Escape always ends the show', () => {
    const typing = { focusOwnsKey: true, onControl: false };
    expect(presenterKeyAction(' ', typing)).toBeNull();
    expect(presenterKeyAction('Enter', typing)).toBeNull();
    expect(presenterKeyAction('Escape', typing)).toBe('stop');
  });

  it('leaves Enter and Space to a focused presenter button, arrows still move', () => {
    const onButton = { focusOwnsKey: false, onControl: true };
    expect(presenterKeyAction('Enter', onButton)).toBeNull();
    expect(presenterKeyAction(' ', onButton)).toBeNull();
    expect(presenterKeyAction('ArrowRight', onButton)).toBe('next');
  });
});

describe('the presenter keyboard', () => {
  const free = { focusOwnsKey: false, onControl: false };

  it('jumps to a typed slide number on Enter', () => {
    const keys = createPresenterKeys();
    expect(keys.interpret('1', free, 0)).toEqual({ type: 'typing', digits: '1' });
    expect(keys.interpret('2', free, 100)).toEqual({ type: 'typing', digits: '12' });
    expect(keys.interpret('Backspace', free, 200)).toEqual({ type: 'typing', digits: '1' });
    expect(keys.interpret('Enter', free, 300)).toEqual({ type: 'goto', number: 1 });
    // Without a number waiting, Enter and Backspace move as before.
    expect(keys.interpret('Enter', free, 400)).toEqual({ type: 'next' });
    expect(keys.interpret('Backspace', free, 500)).toEqual({ type: 'previous' });
  });

  it('forgets a number left half-typed', () => {
    const keys = createPresenterKeys();
    keys.interpret('4', free, 0);
    expect(keys.interpret('Enter', free, DIGIT_TIMEOUT_MS + 10)).toEqual({ type: 'next' });
  });

  it('lets Escape abandon a number before it ends the show', () => {
    const keys = createPresenterKeys();
    keys.interpret('7', free, 0);
    expect(keys.interpret('Escape', free, 10)).toEqual({ type: 'typing', digits: '' });
    expect(keys.interpret('Escape', free, 20)).toEqual({ type: 'stop' });
  });

  it('blanks, lights the laser, and still moves through the show', () => {
    const keys = createPresenterKeys();
    expect(keys.interpret('b', free, 0)).toEqual({ type: 'blank', blank: 'black' });
    expect(keys.interpret('.', free, 0)).toEqual({ type: 'blank', blank: 'black' });
    expect(keys.interpret('W', free, 0)).toEqual({ type: 'blank', blank: 'white' });
    expect(keys.interpret('l', free, 0)).toEqual({ type: 'laser' });
    expect(keys.interpret('PageDown', free, 0)).toEqual({ type: 'next' });
    expect(keys.interpret('Home', free, 0)).toEqual({ type: 'first' });
  });

  it('stays out of a field being typed in and of shortcuts, but Escape still leaves', () => {
    const keys = createPresenterKeys();
    const typing = { focusOwnsKey: true, onControl: false };
    expect(keys.interpret('b', typing, 0)).toBeNull();
    expect(keys.interpret('3', typing, 0)).toBeNull();
    expect(keys.interpret('c', { ...free, mod: true }, 0)).toBeNull();
    expect(keys.interpret('Escape', typing, 0)).toEqual({ type: 'stop' });
  });

  it('leaves digits to a focused presenter button, which has no use for them', () => {
    const keys = createPresenterKeys();
    expect(keys.interpret('5', { focusOwnsKey: false, onControl: true }, 0)).toBeNull();
  });
});
