// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog, DialogBody, DialogHeader } from './Dialog';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const Harness: React.FC<{ onClosed?: () => void; nested?: boolean }> = ({ onClosed, nested }) => {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Dialog
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
        >
          <DialogHeader title="Settings" description="What this is" />
          <DialogBody>
            <button>First</button>
            <input data-autofocus aria-label="Name" />
            <button onClick={() => setInner(true)}>Last</button>
          </DialogBody>
          {nested && inner && (
            <Dialog role="alertdialog" size="sm" onClose={() => setInner(false)} ariaLabel="Sure?">
              <button>Yes</button>
            </Dialog>
          )}
        </Dialog>
      )}
    </>
  );
};

/** The exit animation never reports in jsdom; the ceiling closes it. */
const finishExit = () => act(() => vi.advanceTimersByTime(300));

describe('Dialog', () => {
  it('is named by its header and focuses the autofocus field', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Settings');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('What this is');
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('keeps Tab inside, wrapping at both ends', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const close = screen.getByLabelText('Close');
    const last = screen.getByText('Last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape after its exit, and gives focus back', () => {
    vi.useFakeTimers();
    const closed = vi.fn();
    render(<Harness onClosed={closed} />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('closing');
    expect(closed).not.toHaveBeenCalled();
    finishExit();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a press on the scrim, not on the panel', () => {
    vi.useFakeTimers();
    const closed = vi.fn();
    render(<Harness onClosed={closed} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    finishExit();
    expect(closed).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!);
    finishExit();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('lets only the topmost dialog answer Escape', () => {
    vi.useFakeTimers();
    const closed = vi.fn();
    render(<Harness onClosed={closed} nested />);
    fireEvent.click(screen.getByText('Open'));
    // A real click focuses the button; jsdom's does not.
    screen.getByText('Last').focus();
    fireEvent.click(screen.getByText('Last'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText('Yes'));
    fireEvent.keyDown(document, { key: 'Escape' });
    finishExit();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(closed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });
});
