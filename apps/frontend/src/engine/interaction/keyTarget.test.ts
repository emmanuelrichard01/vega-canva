// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { keyBelongsToFocus } from './keyTarget';

function focusNew(html: string, selector: string): HTMLElement {
  document.body.innerHTML = html;
  const el = document.querySelector<HTMLElement>(selector)!;
  el.focus();
  return el;
}

describe('keyBelongsToFocus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives the board every key when nothing has focus', () => {
    expect(keyBelongsToFocus('Backspace', document.body)).toBe(false);
  });

  it('keeps every key inside fields and selects', () => {
    expect(keyBelongsToFocus('Backspace', focusNew('<input />', 'input'))).toBe(true);
    expect(keyBelongsToFocus('Delete', focusNew('<select><option>a</option></select>', 'select'))).toBe(true);
    expect(keyBelongsToFocus('Backspace', focusNew('<div role="textbox" tabindex="0"></div>', 'div'))).toBe(true);
  });

  it('keeps every key inside a dialog', () => {
    expect(keyBelongsToFocus('Delete', focusNew('<div role="dialog"><button>x</button></div>', 'button'))).toBe(true);
  });

  it('lets a focused button keep Enter and Space but not Delete', () => {
    const button = focusNew('<button>Bold</button>', 'button');
    expect(keyBelongsToFocus('Enter', button)).toBe(true);
    expect(keyBelongsToFocus(' ', button)).toBe(true);
    expect(keyBelongsToFocus('Delete', button)).toBe(false);
  });
});
