import { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider } from './hooks/AuthContext';
import { PerformanceOverlay } from './components/PerformanceOverlay';
import { TooltipLayer } from './components/ui/TooltipLayer';
import { useStore } from './hooks/useStore';

const Room = lazy(() => import('./Room'));
const Home = lazy(() => import('./Home').then((m) => ({ default: m.Home })));

function RouteFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        background: 'var(--surface-primary)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
      }}
    >
      Loading…
    </div>
  );
}

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
  useEffect(() => {
    document.body.classList.toggle('dark-theme', darkTheme);
    document.documentElement.style.colorScheme = darkTheme ? 'dark' : 'light';
  }, [darkTheme]);

  return (
    <AuthProvider>
      <Suspense fallback={<RouteFallback />}>
        {path.startsWith('/room/') ? <Room /> : <Home />}
      </Suspense>
      <PerformanceOverlay />
      {/* At the app root, outside every panel — which is the whole point.
          A tooltip rendered inside a scrolling panel is clipped by it, and no
          z-index can lift it out. See `TooltipLayer`. */}
      <TooltipLayer />
    </AuthProvider>
  );
}

export default App;
