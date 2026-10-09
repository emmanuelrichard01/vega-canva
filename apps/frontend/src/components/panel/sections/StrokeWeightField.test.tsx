// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrokeWeightField } from './StrokeWeightField';
import {
  MIN_STROKE_WEIGHT,
  STROKE_WEIGHTS,
  clampWeight,
  formatWeight,
} from '../../toolbar/rail/strokeDefaults';

afterEach(cleanup);

const input = (c: HTMLElement) => c.querySelector('input') as HTMLInputElement;

describe('StrokeWeightField', () => {
  it('steps a quarter with the arrows and a whole unit with Shift', () => {
    const onChange = vi.fn();
    const { container } = render(<StrokeWeightField value={1} onChange={onChange} />);
    fireEvent.keyDown(input(container), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(1.25, { commit: true });
    fireEvent.keyDown(input(container), { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(2, { commit: true });
    fireEvent.keyDown(input(container), { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(0.25, { commit: true });
  });

  it('keeps a typed hairline exactly, and never goes below a quarter', () => {
    const onChange = vi.fn();
    const { container } = render(<StrokeWeightField value={1} onChange={onChange} />);
    const field = input(container);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '0.3' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith(0.3, { commit: true });

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '0.1' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith(MIN_STROKE_WEIGHT, { commit: true });
  });

  it('says px, and says Mixed for a selection that disagrees', () => {
    const { container, rerender } = render(<StrokeWeightField value={0.5} onChange={() => undefined} />);
    expect(container.textContent).toContain('px');
    expect(input(container).value).toBe('0.5');
    rerender(<StrokeWeightField value="mixed" onChange={() => undefined} />);
    expect(input(container).placeholder).toBe('Mixed');
  });

  it('offers the scale behind its chevron', () => {
    const { getByRole } = render(<StrokeWeightField value={1} onChange={() => undefined} />);
    expect(getByRole('button', { name: 'Stroke weight presets' })).toBeTruthy();
  });
});

describe('the stroke scale', () => {
  it('runs from quarter-unit hairlines up, in order', () => {
    expect(STROKE_WEIGHTS.slice(0, 4)).toEqual([0.25, 0.5, 0.75, 1]);
    for (let i = 1; i < STROKE_WEIGHTS.length; i++) expect(STROKE_WEIGHTS[i]).toBeGreaterThan(STROKE_WEIGHTS[i - 1]);
  });

  it('formats and clamps without float noise', () => {
    expect(formatWeight(0.1 + 0.2)).toBe('0.3');
    expect(formatWeight(2)).toBe('2');
    expect(clampWeight(0)).toBe(MIN_STROKE_WEIGHT);
    expect(clampWeight(0.333333)).toBe(0.33);
    expect(clampWeight(1e9)).toBe(100);
  });
});
