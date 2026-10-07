import React, { Suspense, lazy, useEffect } from 'react';
import { openIconBrowser, useIconBrowser } from '../../engine/icons/iconStore';

/**
 * Mounts the icon browser when something asks for it, and not before.
 *
 * This file is all that ships with the board: the browser, its stylesheet and
 * every icon pack load only after `openIconBrowser` has been called. It also
 * answers the shapes flyout's "Icons" entry, which asks by event so that
 * surface does not need to import the engine.
 */
const IconBrowser = lazy(() => import('./IconBrowser').then((m) => ({ default: m.IconBrowser })));

export const IconBrowserHost: React.FC = () => {
  const { open } = useIconBrowser();

  useEffect(() => {
    const onOpen = () => openIconBrowser();
    window.addEventListener('vega:open-icon-library', onOpen);
    return () => window.removeEventListener('vega:open-icon-library', onOpen);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <IconBrowser />
    </Suspense>
  );
};
