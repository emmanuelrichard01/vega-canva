import { ANGLE_STEP } from '../../engine/model/lineEnds';
import { lineReadout, type LineReading } from '../../engine/tools/lineReadout';
import { hud } from '../../engine/ui/hud';

/** The HUD channel the line tool's reading goes to. */
export const LINE_SOURCE = 'line';

/**
 * Whether an angle sits on the Shift grid, to the precision the tool computes it.
 *
 * The tool snaps by trigonometry, so a snapped 45° arrives as 44.99999…; the
 * tolerance is far below a whole degree, so a hand-drawn line has to be
 * genuinely on the grid to wear the tick.
 */
export function onLineSnap(angle: number, step = ANGLE_STEP): boolean {
  const off = Math.abs(angle / step - Math.round(angle / step)) * step;
  return off < 0.05;
}

/** The line tool's reading as a HUD readout: length and angle beside the pointer. */
export function showLineReading(reading: LineReading): void {
  if (reading.mode === 'connect') {
    // Its length is the router's to decide, so the state is the reading.
    hud.show({ source: LINE_SOURCE, kind: 'label', value: 'Connect', at: reading.at, placement: 'pointer' });
    return;
  }
  hud.show({
    source: LINE_SOURCE,
    kind: 'length',
    value: { length: reading.length, angle: reading.angle },
    at: reading.at,
    placement: 'pointer',
    snapped: onLineSnap(reading.angle),
  });
}

/**
 * Route the line tool's live reading into the HUD.
 *
 * The tool publishes through `lineReadout` and draws its own fallback tag
 * only while no sink is installed, so installing this one retires the
 * fallback without touching the tool. Returns the uninstaller.
 */
export function installLineReadout(): () => void {
  const uninstall = lineReadout.install({
    show: showLineReading,
    hide: () => hud.hide(LINE_SOURCE),
  });
  return () => {
    uninstall();
    hud.hide(LINE_SOURCE);
  };
}
