// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Every renderer that draws text with a webfont has to do two things, and
 * doing one is worse than doing neither: subscribe to `fontEpoch` so the
 * drawing is redone when the real face lands, and request that face so
 * something actually loads it. Subscribing without requesting waits for an
 * event nobody triggered; requesting without subscribing gets the event and
 * ignores it.
 *
 * jsdom has no `document.fonts`, so one is installed here before the font
 * modules load: `load` is recorded and resolved on demand, which is what
 * lets a test say when the face "arrives".
 */
const fonts = vi.hoisted(() => {
  const pending: Array<() => void> = [];
  const load = vi.fn(
    (_spec: string) =>
      new Promise<unknown[]>((resolve) => {
        pending.push(() => resolve([{}]));
      })
  );
  const api = {
    load,
    ready: new Promise<void>(() => {}),
    addEventListener: () => {},
    /** Deliver every face requested so far. */
    arrive() {
      pending.splice(0).forEach((done) => done());
    },
  };
  Object.defineProperty(globalThis.document, 'fonts', { value: api, configurable: true });
  return api;
});

import { createElement } from 'react';
import { act, cleanup } from '@testing-library/react';
import type Konva from 'konva';
import { nodesOf, renderInStage } from '../../../test/konvaHarness';
import { fontEpoch } from '../../../engine/text/fontEpoch';
import { normalizeNode } from '../../../engine/document/normalize';
import { ShapeRenderer } from './ShapeRenderer';
import { TextRenderer } from './TextRenderer';
import { StickyRenderer } from './StickyRenderer';
import type { ShapeNode, StickyNode, TextNode } from '../../../engine/model/schema';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const shapeNode = normalizeNode({
  id: 'label-probe',
  type: 'shape',
  x: 0,
  y: 0,
  width: 220,
  height: 120,
  geometry: { kind: 'rect' },
  text: 'A labelled shape',
  typography: { fontFamily: 'Inter', fontSize: 18, fontWeight: 700 },
}) as ShapeNode;

const textNode = normalizeNode({
  id: 'text-probe',
  type: 'text',
  x: 0,
  y: 0,
  width: 240,
  height: 40,
  text: 'Some words',
  typography: { fontFamily: 'Inter', fontSize: 18 },
}) as TextNode;

const stickyNode = normalizeNode({
  id: 'sticky-probe',
  type: 'sticky',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  text: 'A note',
}) as StickyNode;

/** Each renderer, and the face it must ask for: family and drawn weight. */
const RENDERERS = [
  ['ShapeRenderer', () => createElement(ShapeRenderer, { node: shapeNode, showLabel: true }), ['700', 'Inter']],
  ['TextRenderer', () => createElement(TextRenderer, { node: textNode, visible: true }), ['400', 'Inter']],
  [
    'StickyRenderer',
    () => createElement(StickyRenderer, { node: stickyNode, showText: true, myAuthorId: 'me' }),
    ['600', 'Caveat'],
  ],
] as const;

/**
 * Requests are deduplicated per spec for the life of the module, so this asks
 * whether the face was ever requested, not whether this render requested it.
 */
const requested = (parts: readonly string[]) =>
  fonts.load.mock.calls.some(([spec]) => parts.every((p) => spec.includes(p)));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('renderers that draw a webfont', () => {
  it.each(RENDERERS)('%s subscribes to the font epoch', (_name, element) => {
    const subscribe = vi.spyOn(fontEpoch, 'subscribe');
    renderInStage(element());
    expect(subscribe).toHaveBeenCalled();
  });

  it.each(RENDERERS)('%s asks for the face it is going to measure', async (_name, element, face) => {
    renderInStage(element());
    await flush();
    const specs = fonts.load.mock.calls.map(([spec]) => spec);
    expect(requested(face), `no request for ${face.join(' ')} in: ${specs.join(' | ')}`).toBe(true);
  });

  it('rebuilds the shape label when the face arrives', async () => {
    // Konva measures a string once and keeps the result. On a font swap none of
    // the attributes it watches change, so the node has to be rebuilt for the
    // measurement to be taken again.
    const stage = renderInStage(RENDERERS[0][1]());
    await flush();
    const label = (s: Konva.Stage) =>
      nodesOf<Konva.Text>(s, 'Text').find((t) => t.text() === 'A labelled shape');
    const before = label(stage);
    expect(before).toBeDefined();

    // Control: with no face arriving, the same node stays, so the identity
    // check below measures the epoch and nothing else.
    await flush();
    expect(label(stage)).toBe(before);

    const epoch = fontEpoch.get();
    await act(async () => {
      fonts.arrive();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fontEpoch.get()).toBeGreaterThan(epoch);

    const after = label(stage);
    expect(after).toBeDefined();
    expect(after, 'the label node must be replaced, not reused').not.toBe(before);
  });
});
