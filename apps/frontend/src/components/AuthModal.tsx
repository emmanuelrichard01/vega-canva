import React, { useState } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { ArrowRight, Users } from 'lucide-react';

/**
 * The single onboarding screen shown whenever there's no identity yet —
 * used both on the dashboard (Home.tsx) and when someone lands directly on
 * a shared room link while logged out. Previously these were two entirely
 * different, inconsistent screens: Home.tsx had this honest "what's your
 * name" flow, while Room.tsx showed a fake email+password "Sign in" form
 * that didn't check credentials at all (any password worked) and had dead
 * "Forgot password?" / "Sign up" links. There's no real backend account
 * system behind either path, so pretending one exists here was actively
 * misleading. This also wires up joinAsGuest, which existed in AuthContext
 * but was never actually reachable from any UI.
 */
export const AuthModal: React.FC = () => {
  const { login, joinAsGuest } = useAuth();
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) login(name.trim(), '');
  };

  const handleGuest = () => {
    if (name.trim()) joinAsGuest(name.trim(), '');
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'var(--surface-canvas)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      fontFamily: 'Inter, sans-serif'
    }}>
      <div className="panel-surface" style={{
        padding: '48px 56px', width: '420px', animation: 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex', flexDirection: 'column', gap: 32
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 8 }}>
          <div style={{ width: 48, height: 48, background: 'var(--text-primary)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--surface-primary)', fontWeight: 'bold', fontSize: 24 }}>V</div>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.03em' }}>Vega Canva</h1>
        </div>

        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px 0' }}>Welcome to the workspace</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, margin: 0, lineHeight: 1.6 }}>Enter your name to start collaborating with your team in real-time.</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <input
            type="text"
            placeholder="Display Name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
            autoFocus
            style={{
              padding: '12px 14px', borderRadius: 6, border: '1px solid var(--border-divider)',
              background: 'var(--surface-primary)', color: 'var(--text-primary)', outline: 'none',
              fontSize: 14, transition: 'border-color 0.1s', fontFamily: 'inherit', boxShadow: 'var(--shadow-sm)'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--border-focus)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-divider)'}
          />
          <button type="submit" disabled={!name.trim()} style={{
            padding: '12px', border: '1px solid var(--border-focus)',
            background: name.trim() ? 'var(--text-primary)' : 'var(--surface-secondary)',
            color: name.trim() ? 'var(--surface-primary)' : 'var(--text-tertiary)',
            borderRadius: 6, fontWeight: 500, fontSize: 14, cursor: name.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.1s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: 'var(--shadow-sm)'
          }}>
            Continue <ArrowRight size={18} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border-divider)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-divider)' }} />
          </div>

          <button
            type="button"
            onClick={handleGuest}
            disabled={!name.trim()}
            className="hover-surface"
            data-tooltip="Not remembered after this browser tab closes"
            style={{
              padding: '11px', border: '1px solid var(--border-divider)', background: 'transparent',
              color: name.trim() ? 'var(--text-primary)' : 'var(--text-tertiary)',
              borderRadius: 6, fontWeight: 500, fontSize: 13, cursor: name.trim() ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Users size={16} /> Continue as Guest
          </button>
        </form>
      </div>
    </div>
  );
};
