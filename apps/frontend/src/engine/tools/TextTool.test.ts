// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextTool, seedWidth } from './TextTool';
import { ShapeTool } from './ShapeTool';
import { placedSize } from '../../components/workspace/shapeCatalog';
import { DEFAULT_TYPOGRAPHY } from '../model/schema';
import {
  TEXT_FACES,
  TEXT_STYLES,
  TEXT_STYLE_IDS,
  faceOf,
  nextText,
  readNextText,
  styleOf,
  stylePatch,
  typographyForNextText,
} from './TextToolStyles';
import type { ToolContext } from './Tool';
import { hud } from '../ui/hud';

/** A context whose camera is the identity, so screen and world agree. */
function context() {
  const created: Array<Record<string, any>> = [];
  const ctx = {
    editor: { createNode: (node: Record<string, unknown>) => created.push(node), select: vi.fn() },
    camera: { zoom: 1, screenToWorld: (x: number, y: number) => ({ x, y }) },
    setOverlayState: () => {},
  } as unknown as ToolContext;
  return { ctx, created };
}

const at = (x: number, y: number, evt: Partial<PointerEvent> = {}) => ({
  evt,
  target: { getStage: () => ({ getPointerPosition: () => ({ x, y }) }) },
});

afterEach(() => nextText.set({ style: 'body', face: 'sans' }));

describe('text styles', () => {
  it('runs from largest to smallest, so the scale reads as a hierarchy', () => {
    const sizes = TEXT_STYLE_IDS.map((id) => TEXT_STYLES[id].fontSize);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it('makes Body the document default, so existing text reads as Body', () => {
    expect(styleOf(DEFAULT_TYPOGRAPHY)).toBe('body');
  });

  it('recognises each style from what it sets, and nothing else as one', () => {
    for (const id of TEXT_STYLE_IDS) expect(styleOf(stylePatch(id))).toBe(id);
    expect(styleOf({ fontSize: 23, fontWeight: 400 })).toBeNull();
    expect(styleOf({ fontSize: 40, fontWeight: 400 })).toBeNull();
  });

  it('knows the two faces, and no others', () => {
    expect(faceOf(TEXT_FACES.sans.family)).toBe('sans');
    expect(faceOf(TEXT_FACES.hand.family)).toBe('hand');
    expect(faceOf('Georgia')).toBeNull();
  });

  it('reads a damaged stored choice field by field', () => {
    expect(readNextText(null)).toEqual({ style: 'body', face: 'sans' });
    expect(readNextText('{not json')).toEqual({ style: 'body', face: 'sans' });
    expect(readNextText('{"style":"heading","face":"crayon"}')).toEqual({ style: 'heading', face: 'sans' });
    expect(readNextText('{"style":"huge","face":"hand"}')).toEqual({ style: 'body', face: 'hand' });
  });

  it('builds the next box in the remembered style and face, keeping colour', () => {
    const t = typographyForNextText({ ...DEFAULT_TYPOGRAPHY, color: '#123456' }, { style: 'heading', face: 'hand' });
    expect(t).toMatchObject({ fontSize: 40, fontWeight: 700, fontFamily: 'Caveat', color: '#123456' });
  });

  it('tells its listeners only about a real change', () => {
    const fn = vi.fn();
    const off = nextText.subscribe(fn);
    nextText.set({ style: 'body' });
    expect(fn).not.toHaveBeenCalled();
    nextText.set({ style: 'title' });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('TextTool', () => {
  it('makes an auto-width box on a click, at the caret, in the remembered style', () => {
    nextText.set({ style: 'title' });
    const { ctx, created } = context();
    const tool = new TextTool();
    tool.onPointerDown(ctx, at(100, 200));
    tool.onPointerUp(ctx);
    expect(created).toHaveLength(1);
    const node = created[0];
    expect(node.resize).toBe('width');
    expect(node).toMatchObject({ x: 100, y: 200 });
    expect(node.typography.fontSize).toBe(64);
    // One line of a Title, and room for the placeholder at that size.
    expect(node.height).toBeGreaterThanOrEqual(64);
    expect(node.width).toBe(seedWidth(64));
    expect(seedWidth(64)).toBeGreaterThan(seedWidth(24));
  });

  it('makes a fixed-width box, wrapping, of the width dragged', () => {
    const { ctx, created } = context();
    const tool = new TextTool();
    tool.onPointerDown(ctx, at(300, 100));
    tool.onPointerMove(ctx, at(60, 180));
    tool.onPointerUp(ctx);
    const node = created[0];
    expect(node.resize).toBe('height');
    expect(node).toMatchObject({ x: 60, y: 100, width: 240, height: 80 });
  });

  it('treats a wobble under the threshold as a click', () => {
    const { ctx, created } = context();
    const tool = new TextTool();
    tool.onPointerDown(ctx, at(10, 10));
    tool.onPointerMove(ctx, at(14, 13));
    tool.onPointerUp(ctx);
    expect(created[0].resize).toBe('width');
  });
});

describe('ShapeTool, click against drag', () => {
  it('drops the shape at its natural size, centred on a click', () => {
    const { ctx, created } = context();
    const tool = new ShapeTool('capsule');
    tool.onPointerDown(ctx, at(500, 400));
    tool.onPointerUp(ctx);
    const natural = placedSize('capsule');
    expect(created[0]).toMatchObject({ width: natural.width, height: natural.height });
    expect(created[0].x + created[0].width / 2).toBeCloseTo(500);
    expect(created[0].y + created[0].height / 2).toBeCloseTo(400);
  });

  it('sizes the shape to a drag', () => {
    const { ctx, created } = context();
    const tool = new ShapeTool('rect');
    tool.onPointerDown(ctx, at(100, 100));
    tool.onPointerMove(ctx, at(260, 190));
    tool.onPointerUp(ctx);
    expect(created[0]).toMatchObject({ x: 100, y: 100, width: 160, height: 90 });
  });

  it('reports its size through the HUD while dragging, ticked under Shift, and clears it on release', () => {
    const show = vi.spyOn(hud, 'show');
    const hide = vi.spyOn(hud, 'hide');
    const { ctx } = context();
    const tool = new ShapeTool('rect');
    tool.onPointerDown(ctx, at(0, 0, { shiftKey: true }));
    tool.onPointerMove(ctx, at(120, 60, { shiftKey: true }));
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'shape', kind: 'size', value: { width: 120, height: 120 }, snapped: true })
    );
    tool.onPointerUp(ctx);
    expect(hide).toHaveBeenLastCalledWith('shape');
    show.mockRestore();
    hide.mockRestore();
  });

  it('keeps it proportional with Shift, and draws from the centre with Alt', () => {
    const { ctx, created } = context();
    const square = new ShapeTool('rect');
    square.onPointerDown(ctx, at(0, 0, { shiftKey: true }));
    square.onPointerMove(ctx, at(200, 80, { shiftKey: true }));
    square.onPointerUp(ctx);
    expect(created[0].width).toBe(created[0].height);

    const centred = new ShapeTool('rect');
    centred.onPointerDown(ctx, at(500, 500, { altKey: true }));
    centred.onPointerMove(ctx, at(560, 540, { altKey: true }));
    centred.onPointerUp(ctx);
    expect(created[1]).toMatchObject({ x: 440, y: 460, width: 120, height: 80 });
  });
});
