import { useEffect, useState } from 'react';
import { AuthProvider } from './hooks/AuthContext';
import Room from './Room';
import { Home } from './Home';
import { PerformanceOverlay } from './components/PerformanceOverlay';
import { useStore } from './hooks/useStore';

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
      {path.startsWith('/room/') ? <Room /> : <Home />}
      <PerformanceOverlay />
    </AuthProvider>
  );
}

export default App;
