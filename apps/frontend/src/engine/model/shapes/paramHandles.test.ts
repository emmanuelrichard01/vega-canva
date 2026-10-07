import { describe, expect, it } from 'vitest';
import { handlePosition, handleValue, paramHandles } from './paramHandles';
import { SHAPE_KIND_VALUES, type ShapeGeometry, type ShapeKind } from '../schema';
import { SHAPE_PARAMS } from '../shapeParams';

const KINDS = SHAPE_KIND_VALUES.filter((k) => paramHandles(k).length > 0);

describe('shape parameter handles', () => {
  it('covers the shapes whose form is a dial', () => {
    for (const kind of ['parallelogram', 'trapezoid', 'cylinder', 'database', 'document', 'arrow_block', 'stored_data', 'off_page'] as ShapeKind[]) {
      expect(paramHandles(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it.each(KINDS)('%s: a knob dragged to where a value sits reads back as that value', (kind) => {
    for (const handle of paramHandles(kind)) {
      const declared = SHAPE_PARAMS[kind]!.params.find((p) => p.field === handle.field)!;
      expect(declared, `${kind}.${handle.field} has a dial`).toBeTruthy();
      for (const [w, h] of [
        [200, 120],
        [90, 160],
      ]) {
        for (const t of [0.15, 0.5, 0.85]) {
          const value = declared.min + (declared.max - declared.min) * t;
          const geometry = { kind, [handle.field]: value } as ShapeGeometry;
          const at = handlePosition(geometry, handle, w, h);
          // A knob sits on the shape, never out in the board around it.
          expect(at.x, `${kind} x`).toBeGreaterThanOrEqual(-0.5);
          expect(at.x, `${kind} x`).toBeLessThanOrEqual(w + 0.5);
          expect(at.y, `${kind} y`).toBeGreaterThanOrEqual(-0.5);
          expect(at.y, `${kind} y`).toBeLessThanOrEqual(h + 0.5);
          const back = handleValue(geometry, handle, w, h, at);
          expect(back, `${kind}.${handle.field} at ${w}x${h}, ${value}`).toBeCloseTo(value, 1);
        }
      }
    }
  });

  it('clamps a knob dragged past either end to the dial\'s range', () => {
    const [handle] = paramHandles('parallelogram');
    const geometry = { kind: 'parallelogram' } as ShapeGeometry;
    expect(handleValue(geometry, handle, 200, 100, { x: 400, y: 0 })).toBe(0.45);
    expect(handleValue(geometry, handle, 200, 100, { x: 400, y: 100 })).toBe(-0.45);
  });

  it('flips a slant by dragging the knob to the other edge', () => {
    const [handle] = paramHandles('parallelogram');
    const geometry = { kind: 'parallelogram' } as ShapeGeometry;
    expect(handleValue(geometry, handle, 200, 100, { x: 40, y: 2 })).toBeCloseTo(0.2, 5);
    expect(handleValue(geometry, handle, 200, 100, { x: 40, y: 98 })).toBeCloseTo(-0.2, 5);
  });
});
