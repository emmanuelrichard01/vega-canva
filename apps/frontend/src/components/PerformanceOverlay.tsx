import React, { Suspense, lazy, useEffect, useState } from 'react';

/**
 * Ctrl+Shift+P, and nothing else until it is pressed.
 *
 * This component is mounted at the app root on every screen, so whatever it
 * imports ships with the first chunk the browser parses. It used to import the
 * canvas engine directly for its metrics, which put `CanvasEngine`,
 * `CameraSystem`, `SpatialIndex` and rbush in front of the dashboard -- a
 * screen with no canvas on it -- for a readout nobody has asked to see yet.
 *
 * What is left here is a keyboard listener. The readout itself is fetched the
 * first time somebody turns it on, and a developer reaching for a performance
 * HUD can wait a frame for it.
 */
const PerformanceHud = lazy(() =>
  import('./PerformanceHud').then((m) => ({ default: m.PerformanceHud }))
);

export const PerformanceOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle HUD with Ctrl+Shift+P
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!visible) return null;

  return (
    <Suspense fallback={null}>
      <PerformanceHud />
    </Suspense>
  );
};
