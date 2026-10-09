// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setPresenting } from '../../engine/tools/presenting';
import { claimCursor, cursorOverride } from '../../engine/cursor/cursorOverride';

/**
 * While a presentation runs, nothing but the slide and the show is on screen.
 *
 * The slide is the live board seen through a hole in the letterbox, so every
 * piece of chrome that floats over the board would show through it. The gate
 * is one attribute set by `setPresenting` and one rule in the presenter's
 * stylesheet, so this builds the page's real surfaces (by the classes they
 * render with), switches presenting on, and asks the browser what is visible.
 */

const css = readFileSync(resolve(__dirname, 'framePresenter.css'), 'utf8');

/** The chrome that has to disappear, by the markup each surface renders. */
const CHROME = [
  ['left column and its pill', '<aside class="board-column hierarchy-panel panel-surface"><div class="board-pill">Board</div></aside>'],
  ['right column', '<aside class="board-column properties-panel panel-surface"></aside>'],
  ['the dock and a flyout', '<div class="tool-dock"><div class="dock-flyout">Shapes</div></div>'],
  ['the contextual rail', '<div class="object-context-toolbar"><button class="ctx-btn">Fill</button></div>'],
  ['heads-up readouts', '<div class="hud-layer"><span class="hud-chip">240 × 120</span></div>'],
  ['onboarding and hints', '<div class="onboarding-layer"><div class="empty-board-hints">Drag to draw</div></div>'],
  ['the lesson coach', '<div class="lesson-coach" role="dialog">Try the pen</div>'],
  ['an info notice', '<div class="notice-layer toasts"><div class="notice notice--info">Copied</div></div>'],
  ['presence', '<div class="presence-roster"></div><div class="remote-cursor"></div><div class="presence-edge-marker"></div>'],
  ['comment pins', '<div class="comments-overlay"><button class="comment-pin">2</button></div>'],
  ['rulers', '<div class="rulers"><canvas></canvas></div>'],
  ['the radar and zoom', '<div class="radar-collapsed"><button class="radar-summon">Radar</button><div class="zoom-control">100%</div></div>'],
  ['group isolation bar', '<div class="group-isolation-bar">Editing group</div>'],
  ['the replay bar', '<div class="time-travel-bar">Replay</div>'],
] as const;

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
});

afterEach(() => {
  setPresenting(false);
  document.body.replaceChildren();
});

function buildPage() {
  document.body.innerHTML = `
    <div class="app-container">
      ${CHROME.map(([, html]) => html).join('')}
      <div class="canvas-container"><div class="konvajs-content"><canvas id="content"></canvas><canvas id="chrome-layer"></canvas></div></div>
      <div class="notice-layer"><div class="notice notice--error" role="alert"><span id="error-text">Connection lost</span></div></div>
    </div>
    <div class="fp-root"><button class="fp-btn" id="next">Next</button></div>
    <div class="pv" data-presenter-ui=""><textarea id="notes"></textarea></div>`;
}

const visible = (el: Element) => getComputedStyle(el).visibility !== 'hidden';

describe('presenting hides the chrome', () => {
  it('leaves the page alone when nothing is being presented', () => {
    buildPage();
    for (const el of document.body.querySelectorAll('.app-container *')) expect(visible(el)).toBe(true);
  });

  it('hides every chrome surface, and the stage chrome layer, while presenting', () => {
    buildPage();
    setPresenting(true);
    const wrapper = document.createElement('div');
    for (const [name, html] of CHROME) {
      wrapper.innerHTML = html;
      const sel = `.${wrapper.firstElementChild!.className.split(' ').join('.')}`;
      for (const el of document.body.querySelectorAll(`${sel}, ${sel} *`)) {
        expect(visible(el), `${name}: ${el.className || el.tagName}`).toBe(false);
      }
    }
    expect(visible(document.getElementById('chrome-layer')!)).toBe(false);
  });

  it('keeps the slide, the show, the presenter view and error alerts', () => {
    buildPage();
    setPresenting(true);
    for (const id of ['content', 'next', 'notes', 'error-text']) expect(visible(document.getElementById(id)!), id).toBe(true);
  });

  it('brings everything back when the show ends', () => {
    buildPage();
    setPresenting(true);
    setPresenting(false);
    expect(visible(document.querySelector('.tool-dock')!)).toBe(true);
    expect(visible(document.getElementById('chrome-layer')!)).toBe(true);
  });
});

describe('presenting lets go of interaction state', () => {
  it('releases cursor claims and takes focus out of a field', () => {
    claimCursor('transformer', 'nwse-resize');
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    expect(document.activeElement).toBe(field);
    setPresenting(true);
    expect(cursorOverride.get()).toBeNull();
    expect(document.activeElement).not.toBe(field);
  });
});
