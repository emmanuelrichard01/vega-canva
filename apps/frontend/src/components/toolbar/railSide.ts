import React from 'react';

/**
 * Which side of the selection the contextual rail is on.
 *
 * A popover should open *away* from the artwork, and only the rail knows which
 * way that is. Passing it down through twenty call sites would mean twenty
 * chances to forget; a context makes every popover on the rail side-aware at
 * once, and a popover used anywhere else keeps the plain default.
 *
 * The value is the rail's *own* side rather than its opposite: a rail above the
 * object means the object is below the rail, so the popover opens upward.
 *
 * Its own module because a file that exports both a component and a context
 * cannot be hot-reloaded — Fast Refresh only tracks files that export
 * components alone.
 */
export const RailSideContext = React.createContext<'top' | 'bottom'>('bottom');

/**
 * Which of the rail's popovers is open, shared by all of them.
 *
 * Each popover used to own its open state, so the rail had no idea one was
 * open and nothing could behave like a menu bar: open Stroke, slide along to
 * Sketch, and Sketch should simply be open. With one owner for the answer, a
 * popover can ask "is one of my siblings open?" and take over from it as the
 * pointer or the arrow keys arrive — and opening one closes the other by
 * construction rather than by an outside-click race.
 *
 * `null` outside a rail, where a popover keeps its own state as before.
 */
export const RailPopoverGroup = React.createContext<{
  openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
} | null>(null);
