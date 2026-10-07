import React from 'react';
import { SegmentedControl } from '../../panel/grammar';
import { drawSettings, type EraserMode } from '../../../engine/tools/drawSettings';
import { useDrawSettings } from './useDrawSettings';
import './draw.css';

const MODE_GLYPH: Record<EraserMode, React.ReactNode> = {
  brush: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  lasso: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 3.2c3.2 0 5.4 1.5 5.4 3.6S11 10.5 8 10.5 2.6 9 2.6 6.8 4.8 3.2 8 3.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeDasharray="2.2 1.8"
      />
      <path d="M5.2 10c-.4 1.4.1 2.6 1.2 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
};

/**
 * The eraser's tray: wipe with the nib, or draw a loop around what should go.
 * Alt held at the press swaps to the other mode for one gesture.
 */
export const EraserTray: React.FC = () => {
  const settings = useDrawSettings();
  return (
    <div className="draw-tray" role="group" aria-label="Eraser options">
      <SegmentedControl
        ariaLabel="Eraser mode"
        value={settings.eraser}
        onChange={(v) => drawSettings.set({ eraser: v as EraserMode })}
        segments={[
          { value: 'brush', icon: MODE_GLYPH.brush, label: 'Brush', hint: 'Wipe away what the eraser passes over' },
          { value: 'lasso', icon: MODE_GLYPH.lasso, label: 'Lasso', hint: 'Draw a loop; what it encloses is removed' },
        ]}
      />
      <span className="draw-tray__hint">Hold Alt to swap</span>
    </div>
  );
};
