import { describe, it, expect, beforeEach } from 'vitest';
import { ToolManager } from './ToolManager';
import { setRoomRole } from '../model/permissions';
import type { Tool, ToolContext } from './Tool';

/**
 * The gate that makes view mode mean something.
 *
 * `setActiveTool` is the single funnel every route to a tool goes through --
 * the dock, the keyboard shortcuts, the command palette, a lesson arming one
 * for you. Gating the dock buttons instead would have left the shortcuts
 * live, which is the usual way a disabled control turns out not to be.
 */

const noop = () => {};

function stubTool(id: string): Tool {
  return {
    id,
    cursor: 'default',
    onPointerDown: noop,
    onPointerMove: noop,
    onPointerUp: noop,
  };
}

function manager(...ids: string[]): ToolManager {
  const m = new ToolManager({} as ToolContext);
  for (const id of ids) m.registerTool(stubTool(id));
  return m;
}

describe('ToolManager tool gating', () => {
  beforeEach(() => setRoomRole('editor'));

  it('lets an editor pick up anything registered', () => {
    const m = manager('select', 'hand', 'pen', 'sticky');

    m.setActiveTool('pen');
    expect(m.getActiveTool()?.id).toBe('pen');

    m.setActiveTool('sticky');
    expect(m.getActiveTool()?.id).toBe('sticky');
  });

  it('refuses an editing tool in view mode and falls back to Select', () => {
    const m = manager('select', 'hand', 'pen');
    setRoomRole('viewer');

    m.setActiveTool('pen');

    // Not "nothing happened": a click that leaves the previous tool armed
    // reads as a broken button.
    expect(m.getActiveTool()?.id).toBe('select');
  });

  it('falls back from a tool that was armed before the mode changed', () => {
    const m = manager('select', 'hand', 'pen');
    m.setActiveTool('pen');
    expect(m.getActiveTool()?.id).toBe('pen');

    setRoomRole('viewer');
    m.setActiveTool('sticky'); // not registered -- rejected before the gate

    expect(m.getActiveTool()?.id).toBe('pen');
  });

  it('still allows the tools that move the view, not the document', () => {
    const m = manager('select', 'hand', 'pen');
    setRoomRole('viewer');

    m.setActiveTool('hand');
    expect(m.getActiveTool()?.id).toBe('hand');

    m.setActiveTool('select');
    expect(m.getActiveTool()?.id).toBe('select');
  });

  it('allows the comment tool for a commenter and not for a viewer', () => {
    const m = manager('select', 'hand', 'comment');

    setRoomRole('commenter');
    m.setActiveTool('comment');
    expect(m.getActiveTool()?.id).toBe('comment');

    setRoomRole('viewer');
    m.setActiveTool('comment');
    expect(m.getActiveTool()?.id).toBe('select');
  });

  it('does not recurse when Select itself is missing', () => {
    // A manager without a Select tool must refuse and stop, not loop.
    const m = manager('hand', 'pen');
    setRoomRole('viewer');

    expect(() => m.setActiveTool('pen')).not.toThrow();
    expect(m.getActiveTool()?.id).toBeUndefined();
  });

  it('does not fire activation hooks for a refused tool', () => {
    const m = new ToolManager({} as ToolContext);
    let activated = 0;
    m.registerTool(stubTool('select'));
    m.registerTool({ ...stubTool('pen'), onActivate: () => { activated += 1; } });

    setRoomRole('viewer');
    m.setActiveTool('pen');

    expect(activated).toBe(0);
  });
});
