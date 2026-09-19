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
        {/*
          Appearance, in the corner, out of the form.

          It sat between the name field and Continue — the only control in the
          column that was not about who you are, placed in the middle of the one
          decision the screen exists to collect. A preference about the app's
          chrome is not a step in signing in, and putting it in the path made it
          read as one.

          Icon-only here where it was named before. The earlier note was right
          that two icons in a track mid-form leave their subject to be guessed
          at; in the top corner of a window a sun and a moon are the least
          ambiguous control in software, and the group keeps its accessible
          name either way.

          No tooltips on the two. A tooltip that says "Light" over a sun is the
          icon read back, and the pressed state already says which one is on —
          so it would be a hover-delayed label for a control nobody is
          uncertain about. `aria-label` still names each for anyone not seeing
          the glyph, which is the case that actually needed covering.
        */}
        <div className="auth__theme" role="radiogroup" aria-label="Appearance">
          {([
            [false, 'Light', <Sun size={15} aria-hidden key="s" />],
            [true, 'Dark', <Moon size={15} aria-hidden key="m" />],
          ] as const).map(([dark, label, icon]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={darkTheme === dark}
              aria-label={label}
              className="auth__theme-option"
              data-active={darkTheme === dark || undefined}
              onClick={() => setDarkTheme(dark)}
            >
              {icon}
            </button>
          ))}
        </div>

      <div className="auth__card">
        {/* The wordmark, not the stacked lockup.
            This is still a brand moment, but it is now a brand moment beside
            another one: the showcase fills the other half of the screen and
            carries the product's argument. A 104px stacked mark on top of a
            form, next to that, is the identity said twice at two sizes. The
            wordmark is a line above a line, which is the shape the column
            wants.

            Sized down from 30 and given its own space below rather than the
            card's shared gap. At 30 it was a second headline stacked on the
            real one, and an even gap above and below made the masthead and the
            heading read as two lines of one block. A masthead is not a heading
            for the thing under it: it carries more air beneath it than between
            the heading and its own lede. */}
        <Logo piece="wordmark" size={22} alt="Vega Studio" className="auth__mark" />

        <div>
          <h1 className="auth__title">What&rsquo;s your name?</h1>
          {/* The honest version of what used to be "start collaborating with
              your team in real-time" — which describes every product in this
              category and tells a first-time visitor nothing. This says what
              the name is *for*, which is the only reason the field exists. */}
          {/* One sentence. It said three, and the last two were a claim
              about the product -- no accounts, a link is the invitation --
              which the panel beside it now spends a whole beat on. Repeating
              it here made the form argue for the product instead of asking its
              question.

              Shortened again, and made true. The heading was "What should
              people call you?" over "Your name and colour are how everyone
              else on the board sees you" — an indirect question and a
              seventeen-word answer to it. Worse, it promised a colour: there is
              no colour control on this screen, the presence colour is assigned,
              and naming it here sends people looking for a picker that does not
              exist. The question is the shortest form of itself and the line
              under it says only what it can deliver. */}
          <p className="auth__lede">
            It&rsquo;s how everyone else on the board sees you.
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
          {/*
            The switch and its label on one line, with no box round them.

            It was a bordered card holding a two-line label — the name, then a
            sentence that changed with the state — which made it the second
            framed control in a column containing one field, and read as a
            second thing to fill in. This system declares elevation once per
            surface and does not nest surfaces; a switch row is a row.

            The explanatory sentence went with the box, because it was the third
            sentence on this screen about where the name is kept: the lede says
            what the name is *for*, the footnote says it lives in the browser
            rather than in an account, and this one said "you come back as the
            same person on this browser" — the footnote's own claim, restated
            two rows above it. The footnote now carries both states, so nothing
            was lost.
          */}
          <label className="auth__remember">
            <span className="auth__remember-label">Remember me on this device</span>
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

          <button type="submit" className="auth__submit" disabled={!ready}>
            {ready ? 'Continue' : 'Enter a name to continue'}
            {ready && <ArrowRight size={17} />}
          </button>

          {/* Inside the form, under the action it qualifies. It used to sit
              outside the card, which put it the same distance from Continue as
              Continue was from the switch — so the sentence about what
              Continue does floated free of it. It answers a question asked
              after deciding to continue, so it stays last; it belongs to the
              button, not to the page. */}
          <p className="auth__footnote">
            {remember
              ? 'Your name is kept in this browser, not in an account.'
              : 'This session ends when you close the tab.'}
          </p>
        </form>
      </div>
      </div>
    </div>
  );
};
