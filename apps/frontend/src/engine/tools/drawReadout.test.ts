// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShapeTool } from './ShapeTool';
import { FrameTool } from './FrameTool';
import { GridTool } from './GridTool';
import type { Tool, ToolContext } from './Tool';
import { hud } from '../ui/hud';

/** A context whose camera is the identity, so screen and world agree. */
function context() {
  return {
    editor: { createNode: vi.fn(), select: vi.fn() },
    camera: { zoom: 1, screenToWorld: (x: number, y: number) => ({ x, y }) },
    setOverlayState: () => {},
  } as unknown as ToolContext;
}

const at = (x: number, y: number) => ({
  evt: {},
  target: { getStage: () => ({ getPointerPosition: () => ({ x, y }), getRelativePointerPosition: () => ({ x, y }) }) },
});

afterEach(() => hud.clear());

const tools: Array<[string, string, () => Tool]> = [
  ['shape', 'shape', () => new ShapeTool('rect')],
  ['frame', 'frame', () => new FrameTool()],
  ['grid', 'grid', () => new GridTool()],
];

describe.each(tools)('the %s tool\'s size readout', (_, source, make) => {
  const drag = (tool: Tool, ctx: ToolContext) => {
    tool.onPointerDown?.(ctx, at(10, 10) as never);
    tool.onPointerMove?.(ctx, at(210, 130) as never);
  };

  it('shows the size of the box while dragging', () => {
    const tool = make();
    drag(tool, context());
    const entry = hud.get().get(source);
    expect(entry?.readout.kind).toBe('size');
    expect(entry?.readout.value).toEqual({ width: 200, height: 120 });
  });

  it('hides on Escape', () => {
    const tool = make();
    const ctx = context();
    drag(tool, ctx);
    tool.onKeyDown?.(ctx, new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hud.get().has(source)).toBe(false);
  });

  it('hides when the tool is deactivated mid-drag', () => {
    const tool = make();
    const ctx = context();
    drag(tool, ctx);
    tool.onDeactivate?.(ctx);
    expect(hud.get().has(source)).toBe(false);
  });

  it('hides when the gesture commits', () => {
    const tool = make();
    const ctx = context();
    drag(tool, ctx);
    tool.onPointerUp?.(ctx, at(210, 130) as never);
    expect(hud.get().has(source)).toBe(false);
  });
});
