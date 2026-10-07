import React from 'react';
import { SegmentedControl, Switch } from '../../panel/grammar';
import { drawSettings, HIGHLIGHT_SWATCHES, INK_SWATCHES } from '../../../engine/tools/drawSettings';
import type { Brush } from '../../../engine/tools/brushes';
import { useDrawSettings } from './useDrawSettings';
import './draw.css';

/** Hand-drawn brush glyphs, 16px, stroked in the current text colour. */
const BRUSH_GLYPH: Record<Brush, React.ReactNode> = {
  pen: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 13.2c2.6-.4 3.6-2.3 5.1-4.6 1.3-2 2.6-4 4.9-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 13.2 2.4 14" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  marker: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 11.5c3-1 5.5-2.8 11-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  highlighter: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="6" width="12" height="5" rx="0.5" fill="currentColor" opacity="0.45" />
      <path d="M4 8.5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
};

const BRUSH_NAME: Record<Brush, string> = {
  pen: 'Pen',
  marker: 'Marker',
  highlighter: 'Highlighter',
};

const BRUSH_HINT: Record<Brush, string> = {
  pen: 'Pressure-sensitive ink that tapers where you lift',
  marker: 'An even felt-tip line',
  highlighter: 'A wide translucent band that keeps text readable',
};

export interface DrawTrayProps {
  /**
   * The theme's ink, shown as the first swatch for the pen and marker. Pass
   * the board's current body-text colour so the swatch matches what draws.
   */
  themeInk: string;
}

/**
 * The freehand tool's tray: which brush, which ink, and whether a held stroke
 * snaps to a shape. Every choice applies to the next stroke, not to strokes
 * already on the board.
 */
export const DrawTray: React.FC<DrawTrayProps> = ({ themeInk }) => {
  const settings = useDrawSettings();
  const highlighting = settings.brush === 'highlighter';
  const swatches = highlighting
    ? HIGHLIGHT_SWATCHES
    : [{ color: themeInk, name: 'Ink' }, ...INK_SWATCHES];
  const current = highlighting ? settings.highlight : settings.ink ?? themeInk;

  const pickInk = (color: string) => {
    if (highlighting) drawSettings.set({ highlight: color });
    else drawSettings.set({ ink: color === themeInk ? null : color });
  };

  return (
    <div className="draw-tray" role="group" aria-label="Drawing options">
      <SegmentedControl
        ariaLabel="Brush"
        value={settings.brush}
        onChange={(v) => drawSettings.set({ brush: v as Brush })}
        segments={(['pen', 'marker', 'highlighter'] as Brush[]).map((b) => ({
          value: b,
          icon: BRUSH_GLYPH[b],
          hint: `${BRUSH_NAME[b]} · ${BRUSH_HINT[b]}`,
        }))}
      />
      <span className="draw-tray__divider" aria-hidden="true" />
      <div className="draw-tray__swatches" role="radiogroup" aria-label={highlighting ? 'Highlighter colour' : 'Ink colour'}>
        {swatches.map((s) => {
          const selected = s.color.toLowerCase() === current.toLowerCase();
          return (
            <button
              key={s.name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={s.name}
              title={s.name}
              className="draw-tray__swatch"
              data-selected={selected || undefined}
              onClick={() => pickInk(s.color)}
            >
              <span className="draw-tray__chip" style={{ background: s.color }} />
            </button>
          );
        })}
      </div>
      <span className="draw-tray__divider" aria-hidden="true" />
      <Switch
        checked={settings.recognizeShapes && !highlighting}
        onChange={(checked) => drawSettings.set({ recognizeShapes: checked })}
        label="Snap to shapes"
        tooltip={
          highlighting
            ? 'The highlighter always draws freehand'
            : 'Hold still at the end of a stroke to turn it into a clean line, arrow, circle or box'
        }
      />
    </div>
  );
};
