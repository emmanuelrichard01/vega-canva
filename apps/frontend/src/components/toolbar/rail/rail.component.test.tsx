// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { normalizeNode } from '../../../engine/document/normalize';
import type { AnyNode } from '../../../engine/model/schema';
import type { CanvasContextMenuActions } from '../../menu/canvasMenu';
import { Rail, RailButton, RailMenuButton } from '../RailBase';
import { RAIL_CONTROL_SELECTOR, railControls } from '../railControls';
import { RAIL_CONTROL_CAP } from './verbs';
import { MultiRail } from './MultiRail';
import { RAIL_SECTIONS } from './registry';
import { railSubjectOf, type RailSubjectKind } from './subject';

afterEach(cleanup);

// jsdom has no ResizeObserver; the popovers only construct one when opened.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const actions = new Proxy({}, { get: () => vi.fn() }) as CanvasContextMenuActions;

/** One object per subject, from the same normaliser the document uses. */
const FIXTURES: Record<Exclude<RailSubjectKind, 'other'>, AnyNode> = {
  shape: normalizeNode({ id: 's', type: 'shape', width: 100, height: 60, geometry: { kind: 'rect' }, text: 'Label' }),
  line: normalizeNode({ id: 'l', type: 'shape', geometry: { kind: 'line', vertices: [0, 0, 50, 0, 50, 50] } }),
  vector: normalizeNode({
    id: 'v',
    type: 'path',
    geometry: { kind: 'bezier', closed: true, segments: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }] },
  }),
  freehand: normalizeNode({ id: 'f', type: 'path', geometry: { kind: 'freehand', points: [0, 0, 10, 10, 20, 5] } }),
  connector: normalizeNode({ id: 'c', type: 'connector', from: { x: 0, y: 0 }, to: { x: 100, y: 50 } }),
  text: normalizeNode({ id: 't', type: 'text', text: 'Hello' }),
  sticky: normalizeNode({ id: 'k', type: 'sticky', text: 'Idea' }),
  image: normalizeNode({ id: 'i', type: 'image', src: 'https://example.com/a.png', width: 200, height: 100 }),
  audio: normalizeNode({ id: 'a', type: 'audio', src: 'https://example.com/a.webm', author: { name: 'Ana' } }),
  table: normalizeNode({ id: 'tb', type: 'table', width: 300, height: 120 }),
  grid: normalizeNode({ id: 'g', type: 'grid', width: 400, height: 300 }),
  chart: normalizeNode({ id: 'ch', type: 'chart', width: 320, height: 200 }),
  code: normalizeNode({ id: 'co', type: 'code', code: { source: 'graph TD\n  A-->B', language: 'mermaid' } }),
  link: normalizeNode({ id: 'li', type: 'link', link: { url: 'https://example.com' } }),
  frame: normalizeNode({ id: 'fr', type: 'frame', width: 800, height: 600 }),
};

const tail = (
  <>
    <RailButton label="Comment" onClick={() => {}}>
      C
    </RailButton>
    <RailMenuButton entries={() => []} />
  </>
);

/** What the rail puts in front of the user: its own controls, not what sits inside popovers. */
function countControls(root: HTMLElement): number {
  return Array.from(root.querySelectorAll<HTMLElement>(RAIL_CONTROL_SELECTOR)).filter(
    (el) => !el.closest('.ctx-popover, .cpx-popover')
  ).length;
}

describe('rail registry', () => {
  it('has a module for every subject, and every fixture resolves to its own', () => {
    for (const [subject, node] of Object.entries(FIXTURES)) {
      expect(railSubjectOf(node)).toBe(subject);
      expect(RAIL_SECTIONS[subject as RailSubjectKind]).toBeTypeOf('function');
    }
  });

  for (const [subject, node] of Object.entries(FIXTURES)) {
    it(`${subject}: renders inside the ${RAIL_CONTROL_CAP}-control cap and ends with the tail`, () => {
      const Section = RAIL_SECTIONS[subject as RailSubjectKind];
      const { container } = render(
        <div className="ctx-toolbar">
          <Section
            node={node}
            subject={subject as RailSubjectKind}
            menuActions={actions}
            conditional={null}
            tail={tail}
            tailControls={2}
          />
        </div>
      );
      const count = countControls(container);
      // Every subject has at least one thing of its own beside Comment and `⋯`.
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(RAIL_CONTROL_CAP);
      const tailGroup = container.querySelector('[data-slot="tail"]');
      expect(tailGroup?.querySelector('[aria-label="More actions"]')).not.toBeNull();
    });
  }

  it('drops the least important verbs, never the tail, when Paste style takes a seat', () => {
    const Section = RAIL_SECTIONS.text;
    const paste = (
      <RailButton label="Paste style" onClick={() => {}}>
        P
      </RailButton>
    );
    const { container } = render(
      <div className="ctx-toolbar">
        <Section node={FIXTURES.text} subject="text" menuActions={actions} conditional={paste} tail={tail} tailControls={2} />
      </div>
    );
    expect(countControls(container)).toBeLessThanOrEqual(RAIL_CONTROL_CAP);
    expect(container.querySelector('[aria-label="Paste style"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="More actions"]')).not.toBeNull();
  });
});

describe('multi-select rail', () => {
  const shapes = [0, 1, 2].map((i) =>
    normalizeNode({ id: `m${i}`, type: 'shape', x: i * 150, y: i * 7, width: 100, height: 60, geometry: { kind: 'rect' } })
  );

  it('offers arrangement, tidy and a live grid within the cap', () => {
    const { container, getByLabelText } = render(
      <div className="ctx-toolbar">
        <MultiRail nodes={shapes} ids={shapes.map((n) => n.id)} conditional={null} tail={<RailMenuButton entries={() => []} />} tailControls={1} />
      </div>
    );
    expect(getByLabelText('Align and distribute')).toBeTruthy();
    expect(getByLabelText('Tidy up')).toBeTruthy();
    expect(getByLabelText('Arrange in grid')).toBeTruthy();
    expect(countControls(container)).toBeLessThanOrEqual(RAIL_CONTROL_CAP);
  });

  it('leads with route and ends for a set of connectors', () => {
    const lines = [0, 1].map((i) =>
      normalizeNode({ id: `c${i}`, type: 'connector', from: { x: 0, y: i * 40 }, to: { x: 100, y: i * 40 } })
    );
    const { container } = render(
      <div className="ctx-toolbar">
        <MultiRail nodes={lines} ids={lines.map((n) => n.id)} conditional={null} tail={<RailMenuButton entries={() => []} />} tailControls={1} />
      </div>
    );
    const verbs = container.querySelector('[data-slot="verbs"]')!;
    const first = verbs.querySelector<HTMLElement>(RAIL_CONTROL_SELECTOR);
    expect(first?.getAttribute('aria-label')).toBe('Route');
    expect(countControls(container)).toBeLessThanOrEqual(RAIL_CONTROL_CAP);
  });
});

describe('rail keyboard', () => {
  function renderRail() {
    const anchorRef = React.createRef<HTMLDivElement>();
    return render(
      <Rail id="kb" placement="top" anchorRef={anchorRef} label="Test">
        <RailButton label="One" onClick={() => {}}>1</RailButton>
        <RailButton label="Two" onClick={() => {}}>2</RailButton>
        <RailButton label="Off" disabled onClick={() => {}}>x</RailButton>
        <RailButton label="Three" onClick={() => {}}>3</RailButton>
      </Rail>
    );
  }

  it('Alt+F10 puts the keyboard on the first control', () => {
    const { getByLabelText } = renderRail();
    act(() => {
      fireEvent.keyDown(window, { key: 'F10', altKey: true });
    });
    expect(document.activeElement).toBe(getByLabelText('One'));
  });

  it('arrows walk the controls, skipping disabled ones and wrapping', () => {
    const { getByLabelText } = renderRail();
    const one = getByLabelText('One');
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(getByLabelText('Two'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(getByLabelText('Three'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(getByLabelText('Three'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one, { key: 'End' });
    expect(document.activeElement).toBe(getByLabelText('Three'));
  });

  it('arrows do not reach the board, which would nudge the selection', () => {
    const { getByLabelText } = renderRail();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const one = getByLabelText('One');
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('Escape hands the keyboard back to the board without deselecting', () => {
    const { getByLabelText } = renderRail();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const two = getByLabelText('Two');
    two.focus();
    fireEvent.keyDown(two, { key: 'Escape' });
    window.removeEventListener('keydown', onWindowKey);
    expect(document.activeElement).not.toBe(two);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('counts swatch triggers as rail controls', () => {
    const div = document.createElement('div');
    div.innerHTML = '<button class="ctx-btn"></button><button class="fill-swatch"></button><div class="ctx-popover"><button class="ctx-btn"></button></div>';
    expect(railControls(div)).toHaveLength(2);
  });
});
