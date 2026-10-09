// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ToolWorkspace } from './ToolWorkspace';

// Resolved by path rather than `new URL`: under jsdom the global URL is not
// Node's, and `fileURLToPath` refuses it.
const HERE = dirname(fileURLToPath(import.meta.url));
const DOCK_CSS = readFileSync(join(HERE, '../dock/dock.css'), 'utf8');

// The dock draws every shape glyph from its contour on first render.
vi.setConfig({ testTimeout: 20000 });

beforeAll(() => {
  // jsdom has neither; the dock's placement and long-press read both.
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const dock = () => document.querySelector<HTMLElement>('.tool-dock')!;
const seat = (id: string) => document.querySelector<HTMLElement>(`[data-seat="${id}"]`);

/** A `--name: value;` declaration's value in a stylesheet, as a number. */
function cssNumber(css: string, name: string): number {
  const m = css.match(new RegExp(`${name}:\\s*(-?\\d+)`));
  if (!m) throw new Error(`${name} is not declared`);
  return Number(m[1]);
}

describe('the dock', () => {
  it('has no seat of its own for the sticky note, which lives on the Draw tray', () => {
    render(<ToolWorkspace activeToolId="select" />);
    expect(seat('sticky')).toBeNull();
    expect(document.querySelector('[aria-label^="Sticky note"].dock-btn')).toBeNull();
  });

  it('lets the Draw seat hold the note while it is armed', () => {
    render(<ToolWorkspace activeToolId="sticky" />);
    const draw = seat('draw')!.querySelector<HTMLButtonElement>('.dock-btn')!;
    expect(draw.getAttribute('aria-pressed')).toBe('true');
    expect(draw.getAttribute('aria-label')).toContain('Sticky note');
  });

  it('marks itself while a menu is open, and only then', () => {
    render(<ToolWorkspace activeToolId="select" />);
    expect(dock().hasAttribute('data-menu-open')).toBe(false);
    const caret = seat('shape')!.querySelector<HTMLButtonElement>('.dock-caret')!;
    act(() => { fireEvent.click(caret); });
    expect(document.querySelector('.dock-flyout')).not.toBeNull();
    expect(dock().hasAttribute('data-menu-open')).toBe(true);
    act(() => { fireEvent.click(caret); });
    expect(dock().hasAttribute('data-menu-open')).toBe(false);
  });

  it('arms the tool and opens its flyout on one click, and closes it on a second, keeping the tool', () => {
    const armed: string[] = [];
    const onTool = (e: Event) => armed.push((e as CustomEvent).detail);
    window.addEventListener('legacy_tool_change', onTool);
    const { rerender } = render(<ToolWorkspace activeToolId="select" />);
    const button = () => seat('frame')!.querySelector<HTMLButtonElement>('.dock-btn')!;
    act(() => { fireEvent.click(button()); });
    expect(armed).toEqual(['frame']);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    rerender(<ToolWorkspace activeToolId="frame" />);
    act(() => { fireEvent.click(button()); });
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(armed).toEqual(['frame']);
    window.removeEventListener('legacy_tool_change', onTool);
  });

  it('keeps the flyout open when an option is picked', () => {
    const { rerender } = render(<ToolWorkspace activeToolId="select" />);
    act(() => { fireEvent.click(seat('shape')!.querySelector('.dock-btn')!); });
    rerender(<ToolWorkspace activeToolId="shape-rect" />);
    act(() => { fireEvent.click(document.querySelector('.seat-menu__tile[aria-label="Ellipse"]')!); });
    expect(dock().hasAttribute('data-menu-open')).toBe(true);
  });

  it('opens the armed tool’s flyout on a second press of its key', () => {
    render(<ToolWorkspace activeToolId="frame" />);
    act(() => { fireEvent.keyDown(window, { key: 'f' }); });
    expect(seat('frame')!.querySelector('.dock-btn')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('hugs a seat menu’s row rather than stretching it to the step', () => {
    const css = DOCK_CSS;
    expect(css).toMatch(/:has\(> \.seat-menu\):not\(:has\(\.seat-menu__sheet\)\)\s*\{[^}]*width:\s*max-content/);
    expect(css).not.toMatch(/seat-menu__rule:nth-last-child\(3\)\s*\{[^}]*margin-left:\s*auto/);
  });

  it('fades the dock while the board is being worked on, without moving it', () => {
    const css = DOCK_CSS;
    const rule = css.match(/\.tool-dock\[data-receding\]\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/opacity/);
    expect(rule?.[1]).not.toMatch(/transform|translate/);
  });

  it('keeps the Shapes library open over a press inside it', () => {
    render(<ToolWorkspace activeToolId="select" />);
    act(() => { fireEvent.click(seat('shape')!.querySelector('.dock-caret')!); });
    act(() => { fireEvent.click(document.querySelector('.seat-menu__more')!); });
    const tile = document.querySelector<HTMLElement>('.shape-lib__tile')!;
    act(() => { fireEvent.pointerDown(tile); });
    expect(document.querySelector('.shape-lib')).not.toBeNull();
  });
});

describe('the menu layer', () => {
  const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');
  const index = read('../../index.css');
  const dockCss = read('../dock/dock.css');

  it('lifts an open menu above every floating layer that used to cover it', () => {
    // The regression: menus drew inside the dock's chrome layer, under the
    // object rail (z 200) and the get-started card (the coach layer).
    const rule = dockCss.match(/\.tool-dock\[data-menu-open\]\s*\{[^}]*z-index:\s*var\((--[\w-]+)\)/);
    expect(rule).not.toBeNull();
    const menuLayer = cssNumber(index, rule![1]);
    expect(menuLayer).toBeGreaterThan(cssNumber(index, '--z-chrome'));
    expect(menuLayer).toBeGreaterThan(cssNumber(index, '--z-coach'));
    expect(menuLayer).toBeGreaterThan(cssNumber(index, '--z-toast'));
    const rail = index.match(/\.ctx-toolbar\s*\{[^}]*z-index:\s*(\d+)/);
    expect(rail).not.toBeNull();
    expect(menuLayer).toBeGreaterThan(Number(rail![1]));
    // Still under the walkthrough, dialogs and tooltips.
    expect(menuLayer).toBeLessThan(cssNumber(index, '--z-tour'));
  });

  it('lifts the focus-mode dock with it', () => {
    expect(dockCss).toMatch(/\.focus-dock:has\(\.tool-dock\[data-menu-open\]\)\s*\{[^}]*z-index/);
  });
});
