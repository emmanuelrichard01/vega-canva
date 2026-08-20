import { describe, expect, it } from 'vitest';
import { affords, resolveAffordances, selectionFacts } from './affordances';
import type { AnyNode } from '../model/schema';

/**
 * What a selection offers, and in what order.
 *
 * The behaviour these pin is the one that was missing: a selection with an
 * obvious subject should lead with that subject's own controls. Five connectors
 * got group, align and opacity, because no surface had a "these are all
 * connectors" branch — even though routing and end caps are the only reasons
 * anyone selects five connectors at once.
 */

const node = (over: Record<string, unknown> = {}): AnyNode =>
  ({ id: Math.random().toString(36).slice(2), type: 'shape', ...over }) as unknown as AnyNode;

const shape = (kind: string, over: Record<string, unknown> = {}) =>
  node({ type: 'shape', geometry: { kind }, ...over });

const ids = (nodes: AnyNode[], surface?: 'toolbar' | 'panel' | 'menu') =>
  resolveAffordances(nodes, { surface }).map((a) => a.id);

describe('selectionFacts', () => {
  it('reports a uniform type only when there is one', () => {
    expect(selectionFacts([node({ type: 'connector' }), node({ type: 'connector' })]).uniformType)
      .toBe('connector');
    expect(selectionFacts([node({ type: 'connector' }), node({ type: 'text' })]).uniformType)
      .toBeNull();
  });

  it('calls a group whole only when nothing outside it is left behind', () => {
    const a = node({ id: 'a', parentId: 'g1' });
    const b = node({ id: 'b', parentId: 'g1' });
    const stray = node({ id: 'c', parentId: 'g1' });

    const all = { a, b, c: stray } as unknown as Record<string, AnyNode>;
    // Two of three members selected: ungrouping would dissolve the third too.
    expect(selectionFacts([a, b], all).isWholeGroup).toBe(false);
    expect(selectionFacts([a, b, stray], all).isWholeGroup).toBe(true);
  });

  it('is locked only when every member is', () => {
    expect(selectionFacts([node({ locked: true }), node({ locked: true })]).locked).toBe(true);
    expect(selectionFacts([node({ locked: true }), node({})]).locked).toBe(false);
  });

  it('reports nothing for an empty selection', () => {
    const f = selectionFacts([]);
    expect(f.count).toBe(0);
    expect(f.uniformType).toBeNull();
  });
});

describe('resolveAffordances', () => {
  it('offers nothing for an empty selection', () => {
    expect(resolveAffordances([])).toEqual([]);
  });

  /**
   * The case that motivated the whole thing.
   */
  describe('a selection of connectors', () => {
    const connectors = [
      node({ type: 'connector' }),
      node({ type: 'connector' }),
      node({ type: 'connector' }),
    ];

    it('offers routing and ends', () => {
      const offered = ids(connectors);
      expect(offered).toContain('routing');
      expect(offered).toContain('ends');
    });

    it('leads with them, ahead of the generic set', () => {
      const offered = ids(connectors, 'toolbar');
      expect(offered[0]).toBe('routing');
      expect(offered.indexOf('routing')).toBeLessThan(offered.indexOf('group'));
      expect(offered.indexOf('ends')).toBeLessThan(offered.indexOf('align'));
    });

    it('still offers sketch, which connectors have', () => {
      expect(ids(connectors)).toContain('sketch');
    });

    it('does not offer fill, which they do not', () => {
      expect(ids(connectors)).not.toContain('fill');
    });
  });

  it('drops routing the moment the selection stops being uniform', () => {
    // One rectangle joins them and there is no subject any more, only an
    // intersection.
    const mixed = [node({ type: 'connector' }), shape('rect')];
    expect(ids(mixed)).not.toContain('routing');
    expect(ids(mixed)).toContain('sketch');
  });

  it('offers a line its profile and ends, and a rectangle its corners', () => {
    expect(ids([shape('line'), shape('arrow')])).toContain('line-profile');
    expect(ids([shape('line')])).toContain('ends');
    expect(ids([shape('rect'), shape('rect')])).toContain('corner-radius');
    // A rectangle has no ends and a line has no corner radius.
    expect(ids([shape('rect')])).not.toContain('ends');
    expect(ids([shape('line')])).not.toContain('corner-radius');
  });

  it('offers corners only when every shape is a rectangle', () => {
    expect(ids([shape('rect'), shape('ellipse')])).not.toContain('corner-radius');
  });

  describe('structure', () => {
    it('offers group for several loose objects and ungroup for a whole group', () => {
      expect(ids([node(), node()])).toContain('group');
      expect(ids([node(), node()])).not.toContain('ungroup');

      const a = node({ id: 'a', parentId: 'g' });
      const b = node({ id: 'b', parentId: 'g' });
      const all = { a, b } as unknown as Record<string, AnyNode>;
      const grouped = resolveAffordances([a, b], { allObjects: all }).map((x) => x.id);
      expect(grouped).toContain('ungroup');
      expect(grouped).not.toContain('group');
    });

    it('offers distribute only from three objects', () => {
      // Two are already evenly spaced; the control would do nothing.
      expect(ids([node(), node()])).not.toContain('distribute');
      expect(ids([node(), node(), node()])).toContain('distribute');
    });

    it('offers combine only when everything can become a path', () => {
      expect(ids([shape('rect'), shape('ellipse')])).toContain('boolean');
      expect(ids([shape('rect'), node({ type: 'image' })])).not.toContain('boolean');
      // And never for one object, which has nothing to combine with.
      expect(ids([shape('rect')])).not.toContain('boolean');
    });

    it('offers align only once there are two things to align', () => {
      expect(ids([node()])).not.toContain('align');
      expect(ids([node(), node()])).toContain('align');
    });
  });

  describe('surfaces', () => {
    it('keeps panel-only sections out of the toolbar', () => {
      const sel = [shape('rect')];
      expect(ids(sel, 'panel')).toContain('effects');
      expect(ids(sel, 'toolbar')).not.toContain('effects');
    });

    it('keeps continuous controls out of the menu', () => {
      const sel = [shape('rect')];
      expect(ids(sel, 'menu')).not.toContain('opacity');
      expect(ids(sel, 'menu')).toContain('delete');
    });

    it('gives every surface the same order for the same selection', () => {
      // One resolver means the three surfaces cannot disagree about what a
      // selection affords or which part of it matters most.
      const sel = [node({ type: 'connector' }), node({ type: 'connector' })];
      const toolbar = ids(sel, 'toolbar');
      const menu = ids(sel, 'menu');
      const shared = toolbar.filter((id) => menu.includes(id));
      expect(shared).toEqual(menu.filter((id) => toolbar.includes(id)));
    });
  });

  it('returns a stable, descending ranking', () => {
    const offered = resolveAffordances([node({ type: 'connector' })]);
    for (let i = 1; i < offered.length; i += 1) {
      expect(offered[i - 1].weight).toBeGreaterThanOrEqual(offered[i].weight);
    }
  });

  it('never offers two contradictory things at once', () => {
    // Group and Ungroup are the pair that would be nonsense together.
    for (const sel of [
      [node(), node()],
      [node({ id: 'a', parentId: 'g' }), node({ id: 'b', parentId: 'g' })],
      [node()],
    ]) {
      const offered = ids(sel as AnyNode[]);
      expect(offered.includes('group') && offered.includes('ungroup')).toBe(false);
    }
  });
});

describe('affords', () => {
  it('answers a single question without building the list', () => {
    expect(affords([node({ type: 'connector' })], 'routing')).toBe(true);
    expect(affords([node({ type: 'text' })], 'routing')).toBe(false);
  });
});

/**
 * The rules that were promoted here from a surface that had them right.
 *
 * Each of these is a case where two surfaces disagreed, and the resolver's
 * first draft happened to agree with the wrong one. Pinned so the merge is not
 * silently undone by whichever copy is edited next.
 */
describe('rules promoted from the surfaces', () => {
  const path = (kind: string) => node({ type: 'path', geometry: { kind } });

  it('sketches a freehand path', () => {
    // The properties panel already allowed this and the toolbar did not, so
    // whether a pencil stroke could be sketched depended on which control you
    // reached for. `perfect-freehand` renders it as a smooth tapered ribbon;
    // sketching redraws it from its centreline, which is a different way to
    // draw rather than a filter over the first.
    expect(affords([path('freehand')], 'sketch')).toBe(true);
  });

  it('sketches a flowchart: shapes and the connectors joining them', () => {
    expect(affords([shape('rect'), node({ type: 'connector' })], 'sketch')).toBe(true);
  });

  it('does not sketch a pen or boolean path', () => {
    // Their renderer strokes a curve and has no centreline to go over, so the
    // control would promise something with nothing behind it.
    for (const kind of ['pen', 'boolean']) {
      expect(affords([path(kind)], 'sketch')).toBe(false);
    }
  });

  it('does not sketch a freehand path mixed with a pen one', () => {
    expect(affords([path('freehand'), path('pen')], 'sketch')).toBe(false);
  });

  it('does not offer fill on an image', () => {
    // The toolbar's own list said images were fillable. The registry declares
    // `supportsFill` on shape, path and frame only, and an image's pixels are
    // not a fill you can set.
    expect(affords([node({ type: 'image' })], 'fill')).toBe(false);
    expect(affords([shape('rect')], 'fill')).toBe(true);
  });
});

/**
 * Every affordance a surface is offered has somewhere to be rendered.
 *
 * This is the failure mode the resolver introduces if nobody watches it: a rule
 * declares `surfaces: ['menu']`, the menu has no command for it, and the
 * resolver is quietly promising something no surface delivers — the same class
 * of defect as three surfaces disagreeing, arrived at from the other direction.
 *
 * Held here rather than in the menu's own file because it is a statement about
 * the *table*, and the table is what would be edited.
 */
describe('surface declarations', () => {
  const MENU_RENDERS = new Set([
    'group', 'ungroup', 'order', 'lock', 'visibility', 'delete', 'align', 'distribute',
  ]);

  it('offers the menu only what the menu can run', () => {
    const everything = [
      [shape('rect'), shape('ellipse')],
      [node({ type: 'connector' }), node({ type: 'connector' })],
      [node({ type: 'image' })],
      [node({ type: 'sticky' }), node({ type: 'text' })],
      [node({ id: 'a', parentId: 'g' }), node({ id: 'b', parentId: 'g' })],
    ];
    for (const sel of everything) {
      for (const id of ids(sel as AnyNode[], 'menu')) {
        expect(MENU_RENDERS.has(id), `menu is offered "${id}" and cannot run it`).toBe(true);
      }
    }
  });
});
