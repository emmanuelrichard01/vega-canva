import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ArrowRight, Moon, Sun } from 'lucide-react';
import { useStore } from '../hooks/useStore';
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
  /**
   * The look, asked rather than assumed.
   *
   * Every colour decision in this product was made against a light ground, so
   * light is the fallback in the store -- but somebody who has set their whole
   * system to dark has told you something, and quietly overriding that is the
   * same disrespect as quietly obeying it would be for everyone else.
   *
   * So it is a question, on the one screen that already exists to ask a
   * question, pre-selected from `prefers-color-scheme` so the honest answer is
   * one click rather than none. It applies as you press it: a preview of a
   * theme is the theme.
   */
  const darkTheme = useStore((s) => s.darkTheme);
  const setDarkTheme = useStore((s) => s.setDarkTheme);
  /**
   * Seeded from the system once, and only if nothing was ever stored.
   *
   * `loadBoolPref` cannot tell "never chosen" from "chose light", so the check
   * is against the raw key. Without it, somebody who deliberately picked light
   * last week would have the system's dark preference re-applied every time
   * they signed in, which is the setting refusing to stay set.
   */
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (localStorage.getItem('vega_dark_theme') !== null) return;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setDarkTheme(true);
  }, [setDarkTheme]);
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
          {/* One sentence. It said three, and the last two were a claim
              about the product -- no accounts, a link is the invitation --
              which the panel beside it now spends a whole beat on. Repeating
              it here made the form argue for the product instead of asking its
              question. */}
          <p className="auth__lede">
            Your name and colour are how everyone else on the board sees you.
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

          {/**
            * A switch rather than a native checkbox.
            *
            * It was the one control on the first screen anybody sees that
            * looked like the operating system instead of like this app, next to
            * a field and a button that had both been drawn by hand. And what it
            * controls is a *state* that persists -- whether this browser
            * remembers you -- which is what a switch means and what a checkbox,
            * which usually means "include this in what I am submitting", does
            * not.
            *
            * The same `grid-switch` the panels use, so there is one switch in
            * this product rather than one per screen.
            */}
          <label className="auth__remember">
            <span className="auth__remember-label">
              Remember me on this device
              <span className="auth__remember-hint">
                {remember
                  ? 'You come back as the same person on this browser.'
                  : 'This session ends when the tab closes.'}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={remember}
              className="grid-switch"
              data-active={remember || undefined}
              onClick={() => setRemember(!remember)}
            >
              <span className="grid-switch__dot" />
            </button>
          </label>

          {/* Below the field and above the action, which is the order these
              are decided in: the name is what the screen is for, the look is a
              preference you form while looking at the page, and Continue is
              the end of both. */}
          {/* Named, because two icons in a track is a control whose subject
              has to be guessed at. */}
          <p className="auth__look-label">Appearance</p>
          <div className="auth__look" role="radiogroup" aria-label="Appearance">
            {([
              [false, 'Light', <Sun size={14} aria-hidden key="s" />],
              [true, 'Dark', <Moon size={14} aria-hidden key="m" />],
            ] as const).map(([dark, label, icon]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={darkTheme === dark}
                className="auth__look-option"
                data-active={darkTheme === dark || undefined}
                onClick={() => setDarkTheme(dark)}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <button type="submit" className="auth__submit" disabled={!ready}>
            {ready ? 'Continue' : 'Enter a name to continue'}
            {ready && <ArrowRight size={17} />}
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
