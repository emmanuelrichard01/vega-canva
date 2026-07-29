import React, { useState, useEffect } from 'react';
import { useAuth } from './hooks/AuthContext';
import { nanoid } from 'nanoid';
import { Plus, LayoutTemplate, LayoutList, LayoutGrid, LogOut } from 'lucide-react';
import { WorkspaceCover } from './components/WorkspaceCover';
import { AuthModal } from './components/AuthModal';

interface RecentWorkspace {
  id: string;
  name: string;
  lastAccessed: number;
}

export const Home: React.FC = () => {
  const { user, logout } = useAuth();
  const [joinLink, setJoinLink] = useState('');
  const [recentRooms, setRecentRooms] = useState<RecentWorkspace[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('recentWorkspaces') || '[]');
      setRecentRooms(saved);
    } catch { /* corrupt localStorage entry — not worth surfacing */ }
  }, []);

  const handleCreate = () => {
    const newRoomId = nanoid(10);
    window.location.href = `/room/${newRoomId}`;
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    // Was checking joinLink.trim() for the empty case but then extracting
    // from the untrimmed value — a pasted link with trailing whitespace or
    // a newline (routine when copying out of chat apps/email) silently
    // became part of the room id, landing on a different, brand-new empty
    // room instead of the one that was shared. Also stripped any trailing
    // slash/query string/hash a pasted full URL might carry.
    const trimmed = joinLink.trim();
    if (!trimmed) return;

    let roomId = trimmed;
    if (trimmed.includes('/room/')) {
      roomId = trimmed.split('/room/')[1] || '';
    }
    roomId = roomId.split(/[/?#]/)[0].trim();
    if (!roomId) return;

    window.location.href = `/room/${roomId}`;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    if (Date.now() - ts < 86400000) return 'Today at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
  };

  // Was its own separate "enter your name" screen, duplicating (and slowly
  // drifting from) the one AuthModal shows when landing on a room link
  // directly — now the same shared, honest onboarding screen everywhere,
  // with an actual working Guest option.
  if (!user) {
    return <AuthModal />;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--surface-primary)', color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}>
      {/* Top Navbar */}
      <header style={{ 
        height: 64, background: 'var(--surface-elevated)', borderBottom: '1px solid var(--border-divider)', 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px',
        position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 32, height: 32, background: 'var(--text-primary)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--surface-primary)', fontWeight: 'bold', fontSize: 14 }}>V</div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Vega Canva</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{user.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{user.isGuest ? 'Guest Session' : 'Personal Workspace'}</div>
          </div>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: user.color, color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
            boxShadow: `0 0 0 1px var(--border-divider)`
          }}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          {/* logout/switch-identity existed in AuthContext but had no UI
              anywhere in the app to actually trigger it — once you'd entered
              a name once, you were that identity forever short of clearing
              browser storage by hand. */}
          <button
            onClick={logout}
            className="hover-surface"
            data-tooltip={user.isGuest ? 'End guest session' : 'Log out'}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 8, borderRadius: 6 }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '64px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32, borderBottom: '1px solid var(--border-divider)', paddingBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.03em' }}>
              Your Workspaces
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>Pick up where you left off or join your team.</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-secondary)', border: '1px solid var(--border-divider)', borderRadius: 6, padding: 2 }}>
              <button
                onClick={() => setViewMode('list')}
                style={{ padding: '6px 8px', borderRadius: 4, border: 'none', background: viewMode === 'list' ? 'var(--surface-primary)' : 'transparent', color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer', transition: 'all 0.1s', boxShadow: viewMode === 'list' ? 'var(--shadow-sm)' : 'none' }}
                title="List View"
              >
                <LayoutList size={16} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                style={{ padding: '6px 8px', borderRadius: 4, border: 'none', background: viewMode === 'grid' ? 'var(--surface-primary)' : 'transparent', color: viewMode === 'grid' ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer', transition: 'all 0.1s', boxShadow: viewMode === 'grid' ? 'var(--shadow-sm)' : 'none' }}
                title="Grid View"
              >
                <LayoutGrid size={16} />
              </button>
            </div>
            <form onSubmit={handleJoin} style={{ display: 'flex', position: 'relative' }}>
              <input 
                type="text" 
                placeholder="Paste invite link..." 
                value={joinLink}
                onChange={e => setJoinLink(e.target.value)}
                style={{ width: 200, padding: '8px 12px', paddingRight: 60, borderRadius: 6, border: '1px solid var(--border-divider)', background: 'var(--surface-primary)', color: 'var(--text-primary)', outline: 'none', fontSize: 13, transition: 'border-color 0.1s', boxShadow: 'var(--shadow-sm)' }} 
                onFocus={(e) => e.target.style.borderColor = 'var(--border-focus)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-divider)'}
              />
              <button type="submit" disabled={!joinLink.trim()} style={{ 
                position: 'absolute', right: 4, top: 4, bottom: 4, padding: '0 10px',
                color: joinLink.trim() ? 'var(--surface-primary)' : 'var(--text-tertiary)', 
                background: joinLink.trim() ? 'var(--text-primary)' : 'transparent',
                borderRadius: 4, fontWeight: 500, fontSize: 12, cursor: joinLink.trim() ? 'pointer' : 'default', transition: 'all 0.1s',
                border: 'none'
              }}>
                Join
              </button>
            </form>
            <button 
              onClick={handleCreate}
              style={{ 
                padding: '8px 16px', background: 'var(--text-primary)', color: 'var(--surface-primary)', border: '1px solid var(--border-focus)', 
                borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', 
                alignItems: 'center', gap: 6, transition: 'all 0.1s', boxShadow: 'var(--shadow-sm)' 
              }}
              className="hover-fade"
            >
              <Plus size={16} /> New file
            </button>
          </div>
        </div>

        {recentRooms.length === 0 ? (
          // A first-run dashboard is the one place a new user has no context at
          // all, so it explains what the product is and gives them the two ways
          // in, rather than a bare "No recent workspaces".
          <div style={{ textAlign: 'center', padding: '72px 24px', maxWidth: 460, margin: '0 auto' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-2xl)', background: 'var(--surface-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-5)', border: '1px solid var(--border-divider)' }}>
              <LayoutTemplate size={24} color="var(--text-tertiary)" />
            </div>
            <h3 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)', margin: '0 0 var(--space-2)', letterSpacing: '-0.02em' }}>
              Start your first workspace
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-md)', margin: '0 0 var(--space-6)', lineHeight: 1.6 }}>
              An infinite canvas for thinking with other people — sticky notes, drawings,
              images and voice notes, all in real time. Anyone you send the link to can
              join instantly.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleCreate}
                style={{
                  padding: '10px 18px', background: 'var(--text-primary)', color: 'var(--surface-primary)',
                  border: '1px solid var(--border-focus)', borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)', boxShadow: 'var(--shadow-sm)',
                }}
                className="hover-fade"
              >
                <Plus size={16} /> New workspace
              </button>
              <button
                onClick={() => document.querySelector<HTMLInputElement>('input[placeholder="Paste invite link..."]')?.focus()}
                className="hover-surface"
                style={{
                  padding: '10px 18px', background: 'transparent', color: 'var(--text-primary)',
                  border: '1px solid var(--border-divider)', borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)', cursor: 'pointer',
                }}
              >
                Join with a link
              </button>
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recentRooms.map((room) => (
              <div 
                key={room.id}
                onClick={() => window.location.href = `/room/${room.id}`}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 12px',
                  borderBottom: '1px solid var(--border-divider)',
                  cursor: 'pointer',
                  transition: 'background 0.1s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--surface-secondary)', border: '1px solid var(--border-divider)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LayoutTemplate size={18} color="var(--text-secondary)" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                      {room.name}
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
                      Vega Canva format
                    </p>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {formatDate(room.lastAccessed)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 24, marginBottom: 64 }}>
            {recentRooms.map((room) => (
              <div 
                key={room.id}
                onClick={() => window.location.href = `/room/${room.id}`}
                style={{ 
                  borderRadius: 8, 
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-out',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--surface-primary)',
                  boxShadow: 'var(--shadow-sm)',
                  border: '1px solid var(--border-divider)'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  e.currentTarget.style.borderColor = 'var(--border-focus)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.borderColor = 'var(--border-divider)';
                }}
              >
                <WorkspaceCover workspaceId={room.id} name={room.name} />
                <div style={{ padding: '16px' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {room.name}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0, fontWeight: 500 }}>
                    Opened {formatDate(room.lastAccessed)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
