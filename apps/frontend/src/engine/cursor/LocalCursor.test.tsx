// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useStore', () => ({
  useStore: (select: (s: { eraserSize: number }) => unknown) => select({ eraserSize: 20 }),
}));

import { LocalCursor } from './LocalCursor';
import { cursorOverride } from './cursorOverride';
import { cursorHint } from './cursorHint';
import { watchPresentingCursor } from './presentingCursor';
import { setPresenting } from '../tools/presenting';
import { drawSettings } from '../tools/drawSettings';
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

describe('claims are released by the world, not by their owners', () => {
  const held = () => container!.style.getPropertyValue('--cursor-claim');

  it.each([
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['a cancelled pointer', () => window.dispatchEvent(new Event('pointercancel'))],
    ['the window losing focus', () => window.dispatchEvent(new Event('blur'))],
    ['the pointer leaving the page', () => document.documentElement.dispatchEvent(new Event('mouseleave'))],
    ['a finished drag', () => window.dispatchEvent(new Event('dragend'))],
  ])('on %s', (_name, fire) => {
    render(<Harness mode="pointer" tool="select" />);
    act(() => cursorOverride.claim('handle', 'ew-resize'));
    expect(held()).toBe('ew-resize');
    act(() => {
      fire();
    });
    expect(held()).toBe('');
  });

  it('on a tool switch', () => {
    const { rerender } = render(<Harness mode="pointer" tool="select" />);
    act(() => cursorOverride.claim('handle', 'ew-resize'));
    rerender(<Harness mode="draw" tool="shape-rect" />);
    expect(held()).toBe('');
  });

  it('on unmount, so a claim cannot outlive the board', () => {
    render(<Harness mode="pointer" tool="select" />);
    act(() => cursorOverride.claim('handle', 'ew-resize'));
    cleanup();
    expect(cursorOverride.get()).toBeNull();
  });
});

describe('states that outlive a press', () => {
  it('shows the recording dot over the armed tool, and gives the tool back', () => {
    render(<Harness mode="place" tool="audio" />);
    const tool = decode(container!.style.getPropertyValue('--cursor-tool'));
    act(() => cursorHint.set('recording'));
    const recording = decode(container!.style.getPropertyValue('--cursor-tool'));
    expect(recording).toContain('#D92D20');
    expect(recording).not.toBe(tool);
    act(() => cursorHint.set('idle'));
    expect(decode(container!.style.getPropertyValue('--cursor-tool'))).toBe(tool);
  });

  it('survives a press ending, unlike a claim', () => {
    render(<Harness mode="place" tool="audio" />);
    act(() => cursorHint.set('recording'));
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(decode(container!.style.getPropertyValue('--cursor-tool'))).toContain('#D92D20');
    act(() => cursorHint.set('idle'));
  });

  it('draws the lasso for the lasso eraser, and the ring for the brush', () => {
    drawSettings.set({ eraser: 'lasso' });
    render(<Harness mode="erase" tool="eraser" />);
    const lasso = decode(container!.style.getPropertyValue('--cursor-tool'));
    const alt = decode(container!.style.getPropertyValue('--cursor-alt'));
    expect(lasso).toContain('stroke-dasharray="3 2.6"');
    expect(alt).toContain('r="10"');
    drawSettings.set({ eraser: 'brush' });
  });
});

describe('the presenting pointer', () => {
  it('hides when still, shows on movement, and never outside a presentation', () => {
    vi.useFakeTimers();
    try {
      const stop = watchPresentingCursor(1000);
      const root = document.documentElement;
      vi.advanceTimersByTime(1500);
      expect(root.dataset.cursorIdle).toBeUndefined();

      setPresenting(true);
      vi.advanceTimersByTime(1100);
      expect(root.dataset.cursorIdle).toBe('true');

      // The presenter's own surface: the gate lets its pointer events through.
      const slide = document.body.appendChild(document.createElement('div'));
      slide.className = 'fp-root';
      slide.dispatchEvent(new Event('pointermove', { bubbles: true }));
      slide.remove();
      expect(root.dataset.cursorIdle).toBeUndefined();
      vi.advanceTimersByTime(1100);
      expect(root.dataset.cursorIdle).toBe('true');

      setPresenting(false);
      expect(root.dataset.cursorIdle).toBeUndefined();
      stop();
    } finally {
      setPresenting(false);
      vi.useRealTimers();
    }
  });
});
