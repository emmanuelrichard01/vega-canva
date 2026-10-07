import { describe, expect, it } from 'vitest';
import { CURSOR_INVENTORY } from './cursorInventory';
import { CURSOR_MODES, cursorModeForTool } from './toolCursor';
import { FALLBACK } from './cursorCss';
import { TOOL_SHORTCUTS } from '../tools/shortcuts';
import { FORCE_IDS } from '../physics/forces';
import { cursorVisual, forceVisual, lassoVisual, portVisual, stateVisual } from './cursorVisual';

/** Every other tool id the app arms, beyond those with a shortcut. */
const OTHER_TOOLS = [
  'shape-arrow', 'shape-rect', 'shape-ellipse', 'shape-triangle', 'shape-hexagon', 'shape-star', 'link', 'code',
];

describe('the cursor inventory', () => {
  const byTool = new Map(CURSOR_INVENTORY.filter((e) => e.tool).map((e) => [e.tool!, e]));

  it('covers every tool with a shortcut, every other armed tool and every force', () => {
    for (const id of [...Object.keys(TOOL_SHORTCUTS), ...OTHER_TOOLS, ...FORCE_IDS]) {
      expect(byTool.has(id), `no inventory entry for tool "${id}"`).toBe(true);
    }
  });

  it('has unique ids and a reason for every decision', () => {
    const ids = CURSOR_INVENTORY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CURSOR_INVENTORY) expect(e.why.length, e.id).toBeGreaterThan(10);
  });

  it('produces real art for every custom entry, hot inside its box', () => {
    for (const e of CURSOR_INVENTORY) {
      if (e.decision.kind !== 'custom') continue;
      const v = e.decision.art();
      expect(v.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), e.id).toBe(true);
      expect(-v.offsetX, e.id).toBeGreaterThanOrEqual(0);
      expect(-v.offsetY, e.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every tool its own art, so no two tools look the same', () => {
    const seen = new Map<string, string>();
    for (const e of CURSOR_INVENTORY) {
      if (e.decision.kind !== 'custom' || e.group === 'handle' || e.id === 'shape') continue;
      const svg = e.decision.art().svg;
      expect(seen.get(svg), `${e.id} repeats ${seen.get(svg)}`).toBeUndefined();
      seen.set(svg, e.id);
    }
  });

  it('names a keyword fallback for every mode', () => {
    for (const m of CURSOR_MODES) expect(FALLBACK[m], m).toBeTruthy();
  });
});

describe('forces', () => {
  it('aims every force, including swirl, which the mode table once missed', () => {
    for (const id of FORCE_IDS) expect(cursorModeForTool(id), id).toBe('aim');
  });

  it('draws each force differently', () => {
    const art = FORCE_IDS.map((id) => forceVisual(id, '#F3A024').svg);
    expect(new Set(art).size).toBe(FORCE_IDS.length);
  });

  it('tells attract from repel by the direction of the chevrons', () => {
    expect(forceVisual('magnet', '#F3A024').svg).toContain('M11.5 6.6 14 9.4');
    expect(forceVisual('repel', '#F3A024').svg).toContain('M11.5 9.2 14 6.4');
  });
});

describe('the states', () => {
  it('draws recording in the record colour, and puts port and lasso hotspots where they act', () => {
    expect(stateVisual('recording').svg).toContain('#D92D20');
    expect(-portVisual('#F3A024').offsetX).toBe(14);
    expect({ x: -lassoVisual().offsetX, y: -lassoVisual().offsetY }).toEqual({ x: 4, y: 24 });
  });

  it('swaps the eraser for the lasso by setting', () => {
    const brush = cursorVisual('erase', 'eraser', '#F3A024', false, { eraserMode: 'brush' });
    const lasso = cursorVisual('erase', 'eraser', '#F3A024', false, { eraserMode: 'lasso' });
    expect(brush.id).not.toBe(lasso.id);
  });
});
