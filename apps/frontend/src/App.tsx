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
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        background: 'var(--surface-primary, #0B0F17)',
        color: 'var(--text-primary, #F8FAFC)',
        fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Inter", sans-serif)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle radial ambient backdrop glow */}
      <div
        style={{
          position: 'absolute',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(37, 99, 235, 0.14) 0%, rgba(139, 92, 246, 0.05) 50%, transparent 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.25rem',
          zIndex: 1,
          padding: '2.5rem',
          borderRadius: '1.25rem',
          background: 'rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* Glowing Monogram Emblem */}
        <div
          style={{
            position: 'relative',
            width: '56px',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <defs>
              <linearGradient id="vega-loader-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="50%" stopColor="#6366F1" />
                <stop offset="100%" stopColor="#EC4899" />
              </linearGradient>
            </defs>
            <path
              d="M12 12L24 36L36 12"
              stroke="url(#vega-loader-grad)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="24" cy="36" r="3" fill="#EC4899" />
          </svg>
        </div>

        {/* Status Copy & Shimmering Progress Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem' }}>
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              letterSpacing: '0.02em',
              color: 'var(--text-secondary, #94A3B8)',
            }}
          >
            Initializing workspace…
          </span>

          <div
            style={{
              width: '140px',
              height: '3px',
              borderRadius: '9999px',
              background: 'rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: '40%',
                background: 'linear-gradient(90deg, transparent, #3B82F6, #6366F1, transparent)',
                borderRadius: '9999px',
                animation: 'indeterminate-bar 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
              }}
            />
          </div>
        </div>
      </div>
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
