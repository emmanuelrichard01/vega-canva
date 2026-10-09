/**
 * Where the line tool reports its live length and angle.
 *
 * The board's heads-up displays have one owner, and the tool should not grow a
 * second readout style beside them. So the tool talks to this interface only:
 * when a HUD has installed a sink, the reading goes there; until then the tool
 * draws a small fallback tag in its own overlay. Swapping one for the other
 * changes no tool code.
 */

import type { Point } from '../model/schema';

export interface LineReading {
  /** World units along the run, end to end. */
  length: number;
  /** Degrees, counter-clockwise from the positive x-axis — see `measureRun`. */
  angle: number;
  /** The world point the reading belongs beside: the end under the pointer. */
  at: Point;
  /**
   * `connect` when the run is about to become a connector. Its length is then
   * the router's to decide, so a HUD shows the state rather than a number.
   */
  mode: 'measure' | 'connect';
}

export interface LineReadoutSink {
  show(reading: LineReading): void;
  hide(): void;
}

let installed: LineReadoutSink | null = null;

export const lineReadout = {
  /** Install a sink. Returns the uninstaller, which only removes this sink. */
  install(sink: LineReadoutSink): () => void {
    installed = sink;
    return () => {
      if (installed === sink) installed = null;
    };
  },
  /** The installed sink, or `null` while the tool should draw its own. */
  current(): LineReadoutSink | null {
    return installed;
  },
};
