import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ArrowRight } from 'lucide-react';
import { Logo } from './ui/Logo';
import { AuthShowcase } from './auth/AuthShowcase';

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
 *
 * ## Why the screen is two halves
 *
 * It was a 400px card in the middle of an empty page. That is the layout for a
 * dialog interrupting something, and nothing is being interrupted here: this is
 * the first thing anyone ever sees, and the page had no first thing to look at.
 *
 * The form is four controls and it does not want to be wider, so the width it
 * was not using is free. `AuthShowcase` takes it, at full height, and says what
 * this product is while somebody types their name -- which is the only moment
 * in the whole product where attention is genuinely spare.
 *
 * That is also where the three-beat welcome sequence went. It used to say the
 * same three things in a card *over the board*, one screen later, which put an
 * interruption on the one surface whose promise is not being interrupted, and
 * said it twice. One telling, in the free moment, and the board is never
 * covered at all.
 *
 * ## What happens when there is no room for two halves
 *
 * The showcase is the half that goes. It is the part you can do without: the
 * form is the reason the screen exists, and a phone is not where anyone reads a
 * product's argument for itself. Handled in the stylesheet rather than here, so
 * there is no breakpoint written in two places.
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
      <AuthShowcase />

      <div className="auth__pane">
      <div className="auth__card">
        {/* The wordmark, not the stacked lockup.
            This is still a brand moment, but it is now a brand moment beside
            another one: the showcase fills the other half of the screen and
            carries the product's argument. A 104px stacked mark on top of a
            form, next to that, is the identity said twice at two sizes. The
            wordmark is a line above a line, which is the shape the column
            wants. */}
        <Logo piece="wordmark" size={30} alt="Vega Studio" />

        <div>
          <h1 className="auth__title">What should people call you?</h1>
          {/* The honest version of what used to be "start collaborating with
              your team in real-time" — which describes every product in this
              category and tells a first-time visitor nothing. This says what
              the name is *for*, which is the only reason the field exists. */}
          <p className="auth__lede">
            Your name and colour are how everyone else sees you on the board.
            There are no accounts and no passwords. A room link is the whole
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

      {/* Exactly what the two code paths above do, said plainly. Below the
          action rather than above it, because it answers a question people ask
          after deciding to continue rather than before it. */}
      <p className="auth__footnote">
        Your name is kept in this browser, not in an account.
      </p>
      </div>
    </div>
  );
};
