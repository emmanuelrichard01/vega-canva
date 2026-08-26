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
