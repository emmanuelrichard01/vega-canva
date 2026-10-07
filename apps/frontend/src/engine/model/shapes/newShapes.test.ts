import { describe, expect, it } from 'vitest';
import { shapeToPath } from '../shapeToPath';
import { subpathsOf } from '../pathGeometry';
import { roughShape } from '../roughShape';
import { shapeFeatureContours } from './features';
import type { ShapeKind, ShapeNode } from '../schema';
import { normalizeNode } from '../../document/normalize';
import { SHAPE_BY_PRESET, SHAPE_CATEGORIES } from '../../../components/workspace/shapeCatalog';

/** The kinds that complete the ISO 5807 set, and the system-diagram glyphs. */
const ADDED: ShapeKind[] = [
  'multi_document',
  'off_page',
  'card',
  'loop_limit',
  'punched_tape',
  'collate',
  'sort',
  'merge',
  'stored_data',
  'sequential_access',
  'direct_access_storage',
  'display',
  'or_junction',
  'chat',
  'lock',
  'sliders',
];

const node = (kind: ShapeKind, sketch?: 'light' | 'medium' | 'heavy') =>
  ({
    id: `n-${kind}`,
    geometry: { kind },
    width: 160,
    height: 110,
    appearance: sketch ? { sketch } : {},
  }) as unknown as Pick<ShapeNode, 'geometry' | 'width' | 'height' | 'appearance'> & { id: string };

describe('the added shapes', () => {
  it.each(ADDED)('%s is a closed outline', (kind) => {
    for (const sub of subpathsOf(shapeToPath(node(kind)))) expect(sub.closed, kind).toBe(true);
  });

  it.each(ADDED)('%s draws by hand', (kind) => {
    const sketch = roughShape(node(kind, 'medium'), true);
    expect(sketch.outline.length, kind).toBeGreaterThan(0);
    expect(sketch.silhouette.length, kind).toBeGreaterThan(0);
  });

  it.each(ADDED)('%s survives the document boundary as itself', (kind) => {
    const stored = normalizeNode({ id: 'x', type: 'shape', x: 0, y: 0, width: 100, height: 80, geometry: { kind } });
    expect((stored as ShapeNode).geometry.kind).toBe(kind);
  });

  it('carries the detail that tells each symbol apart', () => {
    // A sort is a decision cut in half; an or-junction a circle with a plus;
    // a chat bubble has its dots, a lock its keyhole, a settings panel its knobs.
    for (const kind of ['sort', 'or_junction', 'chat', 'lock', 'sliders', 'multi_document', 'direct_access_storage'] as ShapeKind[]) {
      expect(shapeFeatureContours(node(kind)).length, kind).toBeGreaterThan(0);
    }
  });

  it('offers every added kind in the picker', () => {
    const offered = new Set(SHAPE_CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.presets)));
    for (const kind of ADDED) {
      const preset = Object.values(SHAPE_BY_PRESET).find((e) => e.geometry.kind === kind)?.preset;
      expect(preset, kind).toBeTruthy();
      expect(offered.has(preset as never), kind).toBe(true);
    }
  });

  it('names manual operation for the wide-top trapezoid ISO 5807 draws', () => {
    expect(SHAPE_BY_PRESET.manual_operation.geometry).toEqual({ kind: 'trapezoid', inset: -0.2 });
  });
});
