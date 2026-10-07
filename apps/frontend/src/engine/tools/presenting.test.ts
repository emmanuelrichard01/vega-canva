// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPresenting, presenterKeyAction, setPresenterKeys, setPresenting } from './presenting';

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
