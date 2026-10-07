// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useStore', () => ({
  useStore: (select: (s: { eraserSize: number }) => unknown) => select({ eraserSize: 20 }),
}));

import { LocalCursor } from './LocalCursor';
import { cursorOverride } from './cursorOverride';
import { HAND_CLOSED, HAND_OPEN } from './cursorVisual';
import type { CursorMode } from './toolCursor';

/** The SVG inside a `url("data:…")` cursor value. */
function decode(value: string): string {
  const match = value.match(/url\("data:image\/svg\+xml,([^"]+)"\)/);
  return match ? decodeURIComponent(match[1]) : '';
}

let container: HTMLDivElement | null = null;

function Harness({ mode, tool }: { mode: CursorMode; tool: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={(el) => {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      container = el;
    }}>
      <LocalCursor mode={mode} containerRef={ref} activeTool={tool} />
    </div>
  );
}

// jsdom has no matchMedia; the cursor asks whether the pointer is coarse.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  cursorOverride.releaseAll();
  container = null;
});

describe('the hand tool, as the cursor values the board actually gets', () => {
  it('rests on the open hand alone, and presses into the closed hand alone', () => {
    render(<Harness mode="pan" tool="hand" />);
    const rest = decode(container!.style.getPropertyValue('--cursor-tool'));
    const pressed = decode(container!.style.getPropertyValue('--cursor-grab'));

    expect(rest).toContain(HAND_OPEN);
    expect(rest).not.toContain(HAND_CLOSED);
    expect(pressed).toContain(HAND_CLOSED);
    expect(pressed).not.toContain(HAND_OPEN);
  });

  it('releases a claimed cursor when the pointer comes up, wherever it comes up', () => {
    render(<Harness mode="pan" tool="hand" />);
    act(() => cursorOverride.claim('drag', 'grabbing'));
    expect(container!.style.getPropertyValue('--cursor-claim')).toBe('grabbing');

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(container!.style.getPropertyValue('--cursor-claim')).toBe('');
    expect(cursorOverride.get()).toBeNull();
  });
});
