import React, { useEffect, useState } from 'react';
import { Frame, X } from 'lucide-react';
import { useStore } from '../hooks/useStore';

/**
 * The one thing the tool dock cannot say for itself.
 *
 * ## Why this is not a tour of the dock
 *
 * Every button down there already carries a tooltip, a keyboard hint, and a
 * flyout marked with a corner dot where more is hidden. Walking someone through
 * thirteen icons teaches thirteen names and no judgment, and it has to be sat
 * through before the board can be touched.
 *
 * The judgment the dock genuinely cannot convey is the **fork it presents at
 * the very start**: this board can be an endless surface you scatter thinking
 * across, or it can hold a frame — a fixed, named, exportable region at a real
 * size. Both are first-class, the choice shapes everything that follows, and
 * nothing on screen suggests the second one exists until you happen to press
 * the frame button and find out what it does.
 *
 * So this asks the question once, offers both answers, and gets out of the way.
 * Choosing "keep the canvas" is a real answer, not a dismissal — it is recorded
 * the same as choosing a frame, and neither is asked again.
 */

const STORAGE_KEY = 'vega_dock_coach_v1';

export const DockCoach: React.FC<{ visible: boolean; onSettled: () => void }> = ({ visible, onSettled }) => {
  const objectCount = useStore((state) => Object.keys(state.objects).length);
  const [answered, setAnswered] = useState(() => localStorage.getItem(STORAGE_KEY) === 'answered');

  const settle = () => {
    localStorage.setItem(STORAGE_KEY, 'answered');
    setAnswered(true);
    // Told upward as well as remembered, so the first-run guide knows this
    // anchor is free without having to poll `localStorage`.
    onSettled();
  };

  const chooseFrame = () => {
    settle();
    // Arms the frame tool through the same event the dock dispatches, so there
    // is one way to change tool and no second path to drift from it.
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'frame' }));
  };

  useEffect(() => {
    if (answered || !visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * Asked once the board has something on it, and never on an empty one.
   *
   * On an empty board `CanvasEmptyState` is already speaking, and two pieces of
   * guidance on one screen is one too many. It is also the wrong moment: the
   * question is "should this work live in a frame", and there is no work yet.
   */
  if (answered || !visible || objectCount === 0) return null;

  return (
    <aside className="dock-coach" aria-label="Working in a frame">
      <button type="button" className="dock-coach__close" onClick={settle} aria-label="Dismiss">
        <X size={13} />
      </button>

      <span className="dock-coach__icon" aria-hidden="true">
        <Frame size={16} />
      </span>

      <div className="dock-coach__body">
        <p className="dock-coach__title">Want a fixed size to design into?</p>
        <p className="dock-coach__text">
          A frame is a region with real dimensions: a slide, a post, an A4 page.
          It clips what is inside it and exports on its own. Or keep going on the
          open canvas; nothing here needs one.
        </p>
        <div className="dock-coach__actions">
          <button type="button" className="dock-coach__primary" onClick={chooseFrame}>
            Add a frame
          </button>
          <button type="button" className="dock-coach__ghost" onClick={settle}>
            Keep the canvas
          </button>
        </div>
      </div>
    </aside>
  );
};
