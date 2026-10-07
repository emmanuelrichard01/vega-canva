// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NumberStepper } from './NumberStepper';

afterEach(cleanup);

const field = (container: HTMLElement) => container.querySelector('input') as HTMLInputElement;

describe('NumberStepper', () => {
  it('commits what was typed on blur', () => {
    const onChange = vi.fn();
    const { container } = render(<NumberStepper value={10} onChange={onChange} aria-label="Width" />);
    const input = field(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(42);
  });

  /**
   * A collaborator changing the same property arrives as a new `value` while
   * this person is typing. Their text must survive it.
   */
  it('keeps the text being typed when the value changes underneath it', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<NumberStepper value={10} onChange={onChange} aria-label="Width" />);
    const input = field(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '4' } });

    rerender(<NumberStepper value={99} onChange={onChange} aria-label="Width" />);
    expect(input.value).toBe('4');

    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it('does not write back a stale value when only tabbed through', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<NumberStepper value={10} onChange={onChange} aria-label="Width" />);
    const input = field(container);
    fireEvent.focus(input);
    // Someone else changes it while the field merely has focus.
    rerender(<NumberStepper value={25} onChange={onChange} aria-label="Width" />);
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('25');
  });

  it('follows the value when not focused', () => {
    const { container, rerender } = render(<NumberStepper value={10} onChange={() => {}} aria-label="Width" />);
    rerender(<NumberStepper value={12} onChange={() => {}} aria-label="Width" />);
    expect(field(container).value).toBe('12');
  });
});
