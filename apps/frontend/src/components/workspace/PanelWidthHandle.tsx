import React, { useCallback, useEffect, useRef, useState } from 'react';
import { storageGet, storageSet } from '../../utils/safeStorage';

/** The same range the properties panel takes, so the two columns match. */
const MIN_W = 240;
const MAX_W = 400;
const DEFAULT_W = 260;
const KEY = 'vega.panel.left.width';

const clamp = (w: number) => (Number.isFinite(w) ? Math.round(Math.min(MAX_W, Math.max(MIN_W, w))) : DEFAULT_W);

/**
 * The left panel's right edge, dragged to set its width (240–400px), published
 * as `--layers-w` on the root so the panel, the radar under it and the insets
 * all read one number. Remembered per browser; arrow keys move it by 8px.
 */
export const PanelWidthHandle: React.FC = () => {
  const [width, setWidth] = useState(() => clamp(Number(storageGet(KEY) ?? DEFAULT_W)));
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--layers-w', `${width}px`);
  }, [width]);

  const commit = useCallback((w: number) => {
    const next = clamp(w);
    setWidth(next);
    storageSet(KEY, String(next));
  }, []);

  return (
    <div
      className="panel-resize panel-resize--right"
      role="separator"
      aria-orientation="vertical"
      aria-label="Layers panel width"
      aria-valuemin={MIN_W}
      aria-valuemax={MAX_W}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setWidth(clamp(drag.current.w + (e.clientX - drag.current.x)));
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        commit(width);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => commit(DEFAULT_W)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          commit(width + 8);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          commit(width - 8);
        }
      }}
    />
  );
};
