// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { overflowsSideways, sidewaysOffenders } from './overflowCheck';

/** jsdom has no layout, so each element is given the box it would have. */
function box(el: HTMLElement, left: number, width: number) {
  el.getBoundingClientRect = () =>
    ({ left, right: left + width, width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function panel(width: number, scrollWidth: number) {
  const el = document.createElement('div');
  box(el, 0, width);
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth });
  return el;
}

describe('the panel at 240px', () => {
  it('passes when its content is no wider than itself', () => {
    expect(overflowsSideways(panel(240, 240))).toBe(false);
  });

  it('fails when its content is wider, and names the row that sticks out', () => {
    const root = panel(240, 258);
    const row = document.createElement('div');
    row.className = 'pg-row';
    box(row, 16, 208);
    const control = document.createElement('div');
    control.className = 'slider';
    box(control, 108, 150);
    row.appendChild(control);
    root.appendChild(row);

    expect(overflowsSideways(root)).toBe(true);
    expect(sidewaysOffenders(root)).toEqual([control]);
  });

  it('leaves a real data grid scrolling inside its own scroller alone', () => {
    const root = panel(240, 240);
    const grid = document.createElement('div');
    grid.style.overflowX = 'auto';
    box(grid, 16, 208);
    const table = document.createElement('div');
    box(table, 16, 409);
    grid.appendChild(table);
    root.appendChild(grid);

    expect(sidewaysOffenders(root)).toEqual([]);
  });
});
