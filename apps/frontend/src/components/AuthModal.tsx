import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
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
    <div className="auth">
      <div className="auth__card panel-surface">
        {/* The full lockup, not the mark plus text.
            This is the one surface in the product that is a brand moment
            rather than chrome: there is nothing else on screen competing for
            the eye, the name is not already written anywhere, and it is the
            first thing anyone ever sees. Everywhere else the mark sits beside
            the name set in the interface's own type, because there the name is
            a label on a working surface. */}
        <Logo piece="full" size={104} alt="Vega Studio" />

        <div>
          <h1 className="auth__title">What should people call you?</h1>
          {/* The honest version of what used to be "start collaborating with
              your team in real-time" — which describes every product in this
              category and tells a first-time visitor nothing. This says what
              the name is *for*, which is the only reason the field exists. */}
          <p className="auth__lede">
            Your name and colour are how everyone else sees you on the board.
            There are no accounts and no password — a room link is the whole
            invitation.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth__form">
          {/* No inline `outline: none` and no `onFocus` handler writing a
              border colour by hand. An inline declaration outranks every
              selector in the stylesheet, so the one the element carried made
              the app's global focus ring unreachable on this field — the
              first field on the first screen, invisible to a keyboard. */}
          <input
            type="text"
            className="auth__field"
            placeholder="Your name"
            aria-label="Your display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoFocus
          />

          <label className="auth__remember">
            <input
              type="checkbox"
              className="auth__check"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span className="auth__remember-label">
              Remember me on this device
              <span className="auth__remember-hint">
                {remember
                  ? 'You will come back as the same person on this browser.'
                  : 'This session ends when the tab closes.'}
              </span>
            </span>
          </label>

          <button type="submit" className="auth__submit" disabled={!ready}>
            Continue <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </div>
  );
};
