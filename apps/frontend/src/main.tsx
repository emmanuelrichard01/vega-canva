import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/contrast.css';
import App from './App.tsx';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { initFrontendObservability } from './utils/observability';
import { reloadForNewVersion } from './components/ui/chunkError';
import { initContrast } from './engine/ui/contrast';
import { installDeviceSignal } from './engine/ui/device';

initFrontendObservability();
// Before the first render, so nothing paints at the wrong contrast.
initContrast();
// `data-pointer` and `data-device` on <html>, before the first paint too.
installDeviceSignal();

/**
 * A lazy chunk that will not load, usually because a deploy replaced it while
 * this tab was open. Reload once to pick up the new build; if that already
 * happened moments ago the error is let through, and the nearest boundary says
 * a new version is available instead of the page reloading in a loop.
 */
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
