import { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider } from './hooks/AuthContext';
import { PerformanceOverlay } from './components/PerformanceOverlay';
import { TooltipLayer } from './components/ui/TooltipLayer';
import { useStore } from './hooks/useStore';
import { RouteLoader } from './components/ui/Loading';
import { NoticeLayer } from './components/ui/NoticeLayer';
import { SpeedInsights } from '@vercel/speed-insights/react';

const Room = lazy(() => import('./Room'));
const Home = lazy(() => import('./Home').then((m) => ({ default: m.Home })));

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const darkTheme = useStore((s) => s.darkTheme);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Applied at the app root rather than inside Room, so the dashboard, the
  // onboarding screen and the editor all share one theme. Previously only Room
  // set this class, leaving the Home page permanently light whatever the user
  // had chosen. `color-scheme` additionally themes native UI — scrollbars,
  // form controls, the text caret — which stayed light-on-dark without it.
  //
  // The boot shell in `index.html` has already done this once, from the same
  // `localStorage` key, before the first frame was painted; that is what stops
  // a dark-theme session opening on a white page. This is what keeps it true
  // afterwards, when the preference changes.
  useEffect(() => {
    document.body.classList.toggle('dark-theme', darkTheme);
    document.documentElement.style.colorScheme = darkTheme ? 'dark' : 'light';
  }, [darkTheme]);

  return (
    <AuthProvider>
      <Suspense fallback={<RouteLoader />}>
        {path.startsWith('/room/') ? <Room /> : <Home />}
      </Suspense>
      <PerformanceOverlay />
      {/* At the root, which is what it always said it was for. It was mounted
          inside `Room`, so the library had no way to say anything -- including
          "removed, undo", which is the one place in this app where a click
          costs somebody the only copy of a board's address. */}
      <NoticeLayer />
      {/* At the app root, outside every panel — which is the whole point.
          A tooltip rendered inside a scrolling panel is clipped by it, and no
          z-index can lift it out. See `TooltipLayer`. */}
      <TooltipLayer />
      <SpeedInsights />
    </AuthProvider>
  );
}

export default App;
