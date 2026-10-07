import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorTool } from './ConnectorTool';
import { CONNECTOR_DEFAULTS, connectorDefaults } from './connectorDefaults';
import { useStore } from '../../hooks/useStore';
import type { ToolContext } from './Tool';

function shape(id: string, x: number, y: number) {
  return {
    id, type: 'shape', x, y, width: 100, height: 60, rotation: 0, scaleX: 1, scaleY: 1,
    zIndex: 0, hidden: false, locked: false, opacity: 1, geometry: { kind: 'rect' },
  };
}

/** A context whose camera is the identity, so screen and world agree. */
function context() {
  const created: Array<Record<string, unknown>> = [];
  const overlays: unknown[] = [];
  const ctx = {
    editor: {
      createNode: (node: Record<string, unknown>) => created.push(node),
      select: vi.fn(),
    },
    camera: { zoom: 1, screenToWorld: (x: number, y: number) => ({ x, y }) },
    setOverlayState: (s: unknown) => overlays.push(s),
  } as unknown as ToolContext;
  return { ctx, created, overlays };
}

/** A pointer event at a screen point, shaped the way the tool reads it. */
const at = (x: number, y: number) => ({ target: { getStage: () => ({ getPointerPosition: () => ({ x, y }) }) } });

/** Click in the middle of `a`, then in the middle of `b`. */
function draw(tool: ConnectorTool, ctx: ToolContext) {
  tool.onPointerDown(ctx, at(50, 30));
  tool.onPointerUp(ctx);
  tool.onPointerMove(ctx, at(450, 30));
  tool.onPointerDown(ctx, at(450, 30));
}

describe('ConnectorTool', () => {
  beforeEach(() => {
    useStore.setState({ objects: { a: shape('a', 0, 0), b: shape('b', 400, 0) } as never });
  });
  afterEach(() => {
    connectorDefaults.set({ ...CONNECTOR_DEFAULTS });
  });

  it('creates a connector from the connector defaults the shelf set', () => {
    connectorDefaults.set({ routing: 'curved', endStart: 'circle', endEnd: 'none', avoid: true });
    const { ctx, created } = context();
    draw(new ConnectorTool(), ctx);
    expect(created).toHaveLength(1);
    const node = created[0];
    expect(node.type).toBe('connector');
    expect(node.routing).toBe('curved');
    expect(node.endStart).toBe('circle');
    expect(node.endEnd).toBe('none');
    expect(node.avoid).toBe(true);
    expect(node.arrowEnd).toBeUndefined();
    expect((node.from as { nodeId: string }).nodeId).toBe('a');
    expect((node.to as { nodeId: string }).nodeId).toBe('b');
  });

  it('leaves avoidance off when the defaults turn it off, and for straight lines', () => {
    connectorDefaults.set({ routing: 'orthogonal', avoid: false });
    const first = context();
    draw(new ConnectorTool(), first.ctx);
    expect(first.created[0].avoid).toBeUndefined();

    connectorDefaults.set({ routing: 'straight', avoid: true });
    const second = context();
    draw(new ConnectorTool(), second.ctx);
    expect(second.created[0].routing).toBe('straight');
    expect(second.created[0].avoid).toBeUndefined();
  });

  it('shows ports only on objects near the pointer', () => {
    useStore.setState({
      objects: { a: shape('a', 0, 0), b: shape('b', 400, 0), far: shape('far', 2000, 2000) } as never,
    });
    const { ctx, overlays } = context();
    const tool = new ConnectorTool();
    tool.onPointerMove(ctx, at(50, 30));
    const last = overlays[overlays.length - 1] as { ports: Array<{ nodeId: string }> };
    const ids = new Set(last.ports.map((p) => p.nodeId));
    expect(ids.has('a')).toBe(true);
    expect(ids.has('far')).toBe(false);
  });
});
