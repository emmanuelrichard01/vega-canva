// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberField, PanelSubjectContext, Section } from './index';
import { resetSectionCache, SECTIONS_KEY } from './sectionState';

afterEach(() => cleanup());

// jsdom has no PointerEvent, so React would see pointer events without
// coordinates. A MouseEvent carrying a pointerId is all the field reads.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

// Node ships its own `localStorage`, which shadows jsdom's and has no
// backing file in tests; a plain in-memory Storage stands in for both.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}
const storage = memoryStorage();
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

describe('NumberField scrubbing', () => {
  it('writes once at the end of a scrub, with previews before it', () => {
    const onChange = vi.fn();
    render(<NumberField label="Width" glyph="W" value={100} onChange={onChange} />);
    const handle = screen.getByText('W');
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 20, pointerId: 1 });

    const commits = onChange.mock.calls.filter(([, change]) => change.commit);
    const previews = onChange.mock.calls.filter(([, change]) => !change.commit);
    expect(commits).toHaveLength(1);
    expect(commits[0][0]).toBe(110);
    expect(previews.map(([v]) => v)).toEqual([105, 110]);
  });

  it('scrubs ten times faster with Shift', () => {
    const onChange = vi.fn();
    render(<NumberField label="X" glyph="X" value={0} onChange={onChange} />);
    const handle = screen.getByText('X');
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 4, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(handle, { clientX: 4, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(20, { commit: true });
  });

  it('does not write when a scrub is cancelled', () => {
    const onChange = vi.fn();
    render(<NumberField label="Y" glyph="Y" value={7} onChange={onChange} />);
    const handle = screen.getByText('Y');
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 30, pointerId: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onChange.mock.calls.filter(([, c]) => c.commit)).toHaveLength(0);
  });

  it('shows Mixed and steps relatively on a mixed field', () => {
    const onChange = vi.fn();
    const onNudge = vi.fn();
    render(<NumberField label="Rotation" glyph="R" value="mixed" onChange={onChange} onNudge={onNudge} />);
    const input = screen.getByLabelText('Rotation') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Mixed');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onNudge).toHaveBeenCalledWith(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits typed values on Enter and reverts on Escape', () => {
    const onChange = vi.fn();
    render(<NumberField label="Height" glyph="H" value={40} onChange={onChange} />);
    const input = screen.getByLabelText('Height') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '64' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('40');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '64' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(64, { commit: true });
  });
});

describe('Section', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSectionCache();
  });

  it('remembers a fold per subject and section', () => {
    const { rerender } = render(
      <PanelSubjectContext.Provider value="shape">
        <Section id="text" title="Text" collapsible>
          <p>Body</p>
        </Section>
      </PanelSubjectContext.Provider>
    );
    expect(screen.getByText('Body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Text/ }));
    expect(screen.queryByText('Body')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SECTIONS_KEY)!)).toEqual({ 'shape:text': false });

    // A different subject keeps its own state.
    rerender(
      <PanelSubjectContext.Provider value="text">
        <Section id="text" title="Text" collapsible>
          <p>Body</p>
        </Section>
      </PanelSubjectContext.Provider>
    );
    expect(screen.getByText('Body')).toBeTruthy();

    // And the first one survives a remount.
    cleanup();
    resetSectionCache();
    render(
      <PanelSubjectContext.Provider value="shape">
        <Section id="text" title="Text" collapsible>
          <p>Body</p>
        </Section>
      </PanelSubjectContext.Provider>
    );
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('shrinks an empty list to its header and +', () => {
    const onAdd = vi.fn();
    render(
      <Section id="fill" title="Fill" empty onAdd={onAdd} addLabel="Add fill">
        <p>Paint</p>
      </Section>
    );
    expect(screen.queryByText('Paint')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add fill' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
