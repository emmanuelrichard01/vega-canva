import React from 'react';
import { RailPopover } from './RailPopover';
import { THEMES } from '../../engine/model/stickyThemes';
import { STICKY_THEMES, type StickyTheme } from '../../engine/model/schema';

export interface StickyPaletteProps {
  theme: StickyTheme;
  onPick: (theme: StickyTheme) => void;
}

export const StickyPalette: React.FC<StickyPaletteProps> = ({ theme, onPick }) => (
  <RailPopover
    label="Note colour"
    align="start"
    trigger={
      <span
        className="ctx-sticky-swatch"
        style={{ background: THEMES[theme]?.bg, borderColor: THEMES[theme]?.edge }}
      />
    }
  >
    <span className="ctx-popover__label">Note colour</span>
    <div className="ctx-sticky-grid">
      {STICKY_THEMES.map((id) => {
        const paper = THEMES[id];
        return (
          <button
            key={id}
            type="button"
            className="ctx-sticky-chip"
            aria-pressed={id === theme}
            aria-label={id}
            data-tooltip={id[0].toUpperCase() + id.slice(1)}
            onClick={() => onPick(id)}
            style={{ background: paper.bg, borderColor: paper.edge, color: paper.text }}
          >
            Aa
          </button>
        );
      })}
    </div>
  </RailPopover>
);
