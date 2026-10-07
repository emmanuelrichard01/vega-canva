// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

function Dialog({ onEscape }: { onEscape: () => void }) {
  const ref = useFocusTrap(true, onEscape);
  return (
    <div ref={ref}>
      <button type="button">Close</button>
      <textarea aria-label="source" />
    </div>
  );
}

// jsdom does no layout, so `offsetParent` is always null and the trap's
// "is it rendered" filter would find nothing to focus. Treat attached
// elements as rendered.
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return (this as HTMLElement).parentElement;
    },
  });
});
afterAll(() => {
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
});
afterEach(cleanup);

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', () => {
    const { getByText } = render(<Dialog onEscape={() => {}} />);
    expect(document.activeElement).toBe(getByText('Close'));
  });

  /**
   * Callers pass inline closures, so any re-render of the opener hands the hook
   * a new `onEscape`. That must not tear the trap down and refocus the first
   * control: a collaborator's edit would pull focus out of the field the user
   * is typing in, and their next Enter would press Close.
   */
  it('keeps focus where it is when re-rendered with a new onEscape', () => {
    const { getByLabelText, rerender } = render(<Dialog onEscape={() => {}} />);
    const field = getByLabelText('source');
    field.focus();
    expect(document.activeElement).toBe(field);

    rerender(<Dialog onEscape={() => {}} />);
    rerender(<Dialog onEscape={() => {}} />);

    expect(document.activeElement).toBe(field);
  });

  it('calls the latest onEscape, not the one it was opened with', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Dialog onEscape={first} />);
    rerender(<Dialog onEscape={latest} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('hands focus back to the opener when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<Dialog onEscape={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
