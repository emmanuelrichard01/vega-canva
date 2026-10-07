// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BoardColumn, PEEK_DELAY_MS, PEEK_LINGER_MS } from './WorkspaceShell';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ initial = false, onPin }: { initial?: boolean; onPin?: () => void }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <BoardColumn
        side="left"
        open={open}
        onPin={() => {
          onPin?.();
          setOpen(true);
        }}
        panelLabel="Board and layers"
        pillLabel="Board"
        region={0}
        panelClassName="hierarchy-panel"
        pill={(toggle) => (
          <button
            ref={toggle?.ref}
            onClick={toggle?.onClick}
            onPointerEnter={toggle?.onPointerEnter}
            onPointerLeave={toggle?.onPointerLeave}
          >
            Show layers
          </button>
        )}
      >
        <button>Layer one</button>
        <button onClick={() => setOpen(false)}>Collapse</button>
      </BoardColumn>
      <button>Elsewhere</button>
    </>
  );
}

const hover = (el: HTMLElement) => fireEvent.pointerEnter(el, { pointerType: 'mouse' });

describe('a board column', () => {
  it('is a pill landmark until pinned, then the panel landmark', () => {
    render(<Harness />);
    expect(screen.getByRole('navigation', { name: 'Board' })).toBeTruthy();
    fireEvent.click(screen.getByText('Show layers'));
    expect(screen.getByRole('navigation', { name: 'Board and layers' })).toBeTruthy();
  });

  it('peeks the panel after the pointer rests on the toggle, without pinning it', () => {
    const onPin = vi.fn();
    render(<Harness onPin={onPin} />);
    hover(screen.getByText('Show layers'));
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS - 10));
    expect(screen.queryByText('Layer one')).toBeNull();
    act(() => vi.advanceTimersByTime(20));
    const panel = screen.getByRole('navigation', { name: 'Board and layers' });
    expect(panel.hasAttribute('data-peek')).toBe(true);
    expect(onPin).not.toHaveBeenCalled();
  });

  it('does not peek when the pointer passes over the toggle and leaves', () => {
    render(<Harness />);
    const toggle = screen.getByText('Show layers');
    hover(toggle);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerLeave(toggle, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
    expect(screen.queryByText('Layer one')).toBeNull();
  });

  it('pins a peek on a press inside it', () => {
    const onPin = vi.fn();
    render(<Harness onPin={onPin} />);
    hover(screen.getByText('Show layers'));
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
    fireEvent.pointerDown(screen.getByText('Layer one'));
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('navigation', { name: 'Board and layers' }).hasAttribute('data-peek')).toBe(false);
  });

  it('closes a peek on Escape, on a press elsewhere, and once the pointer has been away a beat', () => {
    render(<Harness />);
    const peek = () => {
      hover(screen.getByText('Show layers'));
      act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
      expect(screen.getByText('Layer one')).toBeTruthy();
    };
    peek();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Layer one')).toBeNull();

    peek();
    fireEvent.pointerDown(screen.getByText('Elsewhere'));
    expect(screen.queryByText('Layer one')).toBeNull();

    peek();
    fireEvent.pointerMove(screen.getByText('Elsewhere'));
    act(() => vi.advanceTimersByTime(PEEK_LINGER_MS - 10));
    expect(screen.getByText('Layer one')).toBeTruthy();
    fireEvent.pointerMove(screen.getByText('Layer one'));
    act(() => vi.advanceTimersByTime(PEEK_LINGER_MS));
    expect(screen.getByText('Layer one')).toBeTruthy();
    fireEvent.pointerMove(screen.getByText('Elsewhere'));
    act(() => vi.advanceTimersByTime(PEEK_LINGER_MS));
    expect(screen.queryByText('Layer one')).toBeNull();
  });

  it('hands focus to the pill when it collapses with focus inside', () => {
    render(<Harness initial />);
    const collapse = screen.getByText('Collapse');
    collapse.focus();
    fireEvent.click(collapse);
    expect(document.activeElement).toBe(screen.getByText('Show layers'));
  });

  it('hands focus into the panel when the focused toggle pins it', () => {
    render(<Harness />);
    const toggle = screen.getByText('Show layers');
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(screen.getByText('Layer one'));
  });
});
