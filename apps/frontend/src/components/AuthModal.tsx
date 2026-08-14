import React, { useState } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { ArrowRight } from 'lucide-react';
import { Logo } from './ui/Logo';

/**
 * The way in.
 *
 * Shown wherever there is no identity yet — the dashboard, and landing on a
 * shared room link while logged out. It replaced two inconsistent screens, one
 * of which was a fake email-and-password form that accepted any password and
 * carried dead "Forgot password?" links. There is no account system behind any
 * of this, and pretending otherwise was actively misleading.
 *
 * ## Why this is one button and not two
 *
 * It used to offer **Continue** and **Continue as Guest** as two equal buttons,
 * both taking the same single field. Read the two handlers and the difference
 * is exactly one thing: `login` writes to `localStorage`, `joinAsGuest` writes
 * to `sessionStorage`. That is the whole distinction — whether this browser
 * remembers you after the tab closes — and it was expressed as a choice
 * between two verbs, with the actual meaning hidden in a tooltip on one of
 * them.
 *
 * A choice whose consequence is invisible is not a choice, it is a coin toss.
 * So there is one action, and the thing that actually differs is a checkbox
 * that says what it does. Same two code paths underneath.
 */
export const AuthModal: React.FC = () => {
  const { login, joinAsGuest } = useAuth();
  const [name, setName] = useState('');
  // Defaulted on: this is the behaviour someone returning to their own board
  // expects, and it is the one that loses nothing if it is wrong.
  const [remember, setRemember] = useState(true);

  const ready = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if (remember) login(name.trim(), '');
    else joinAsGuest(name.trim(), '');
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'var(--surface-canvas)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        fontFamily: 'var(--font-sans)',
        padding: 'var(--space-4)',
      }}
    >
      <div
        className="panel-surface"
        style={{
          padding: '40px', width: 'min(100%, 400px)',
          animation: 'fadeIn 400ms var(--ease-settle)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-6)',
        }}
      >
        {/* The full lockup, not the mark plus text.
            This is the one surface in the product that is a brand moment
            rather than chrome: there is nothing else on screen competing for
            the eye, the name is not already written anywhere, and it is the
            first thing anyone ever sees. Everywhere else the mark sits beside
            the name set in the interface's own type, because there the name is
            a label on a working surface. */}
        <Logo piece="full" size={104} alt="Vega Studio" />

        <div>
          <h1 style={{ fontSize: 26, fontWeight: 650, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
            What should people call you?
          </h1>
          {/* The honest version of what used to be "start collaborating with
              your team in real-time" — which describes every product in this
              category and tells a first-time visitor nothing. This says what
              the name is *for*, which is the only reason the field exists. */}
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>
            Your name and colour are how everyone else sees you on the board.
            There are no accounts and no password — a room link is the whole
            invitation.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <input
            type="text"
            placeholder="Your name"
            aria-label="Your display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoFocus
            style={{
              padding: '12px 14px', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-divider)',
              background: 'var(--surface-primary)', color: 'var(--text-primary)',
              outline: 'none', fontSize: 15, fontFamily: 'inherit',
              transition: 'border-color var(--motion-hover)',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border-divider)')}
          />

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--text-primary)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Remember me on this device
              <span style={{ display: 'block', color: 'var(--text-tertiary)', fontSize: 12 }}>
                {remember
                  ? 'You will come back as the same person on this browser.'
                  : 'This session ends when the tab closes.'}
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={!ready}
            style={{
              padding: '12px', border: 'none',
              background: ready ? 'var(--text-primary)' : 'var(--surface-secondary)',
              color: ready ? 'var(--surface-primary)' : 'var(--text-tertiary)',
              borderRadius: 'var(--radius-lg)', fontWeight: 600, fontSize: 14,
              fontFamily: 'inherit',
              cursor: ready ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background-color var(--motion-hover), color var(--motion-hover)',
            }}
          >
            Continue <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </div>
  );
};
