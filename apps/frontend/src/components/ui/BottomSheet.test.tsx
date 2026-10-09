// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomSheet, SHEET_SETTLE_MS } from './BottomSheet';

function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const Harness: React.FC<{ onClosed?: () => void }> = ({ onClosed }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <BottomSheet
        open={open}
        label="Properties"
        snaps={['peek', 'half', 'full']}
        initialSnap="half"
        onClose={() => {
          setOpen(false);
          onClosed?.();
        }}
      >
        <button>First</button>
        <button>Last</button>
      </BottomSheet>
    </>
  );
};

describe('BottomSheet', () => {
  it('is a labelled modal dialog that takes focus and gives it back', () => {
    mockReducedMotion(true);
    render(<Harness />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Properties' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.dataset.snap).toBe('half');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside', () => {
    mockReducedMotion(true);
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const last = screen.getByText('Last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resize Properties' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('steps through its snaps from the handle and closes below the lowest', () => {
    mockReducedMotion(true);
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    fireEvent.click(screen.getByText('Open'));
    const handle = screen.getByRole('button', { name: 'Resize Properties' });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(dialog.dataset.snap).toBe('full');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(dialog.dataset.snap).toBe('peek');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('under reduced motion moves without travelling and closes at once', () => {
    mockReducedMotion(true);
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    fireEvent.click(screen.getByText('Open'));
    expect(document.querySelector('.bsheet-root')?.hasAttribute('data-reduced')).toBe(true);
    expect(screen.getByRole('dialog').dataset.state).toBe('open');
    fireEvent.click(screen.getByRole('button', { name: 'Close Properties' }));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('with motion, lowers itself before closing', () => {
    mockReducedMotion(false);
    vi.useFakeTimers();
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    fireEvent.click(screen.getByText('Open'));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close Properties' }));
    expect(screen.getByRole('dialog').dataset.state).toBe('closing');
    expect(screen.getByRole('dialog').style.height).toBe('0px');
    expect(onClosed).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SHEET_SETTLE_MS);
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
