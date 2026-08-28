import React from 'react';
import { initialsFor } from '../../engine/presence/collaborators';

/**
 * One person, at whatever size the surface needs.
 *
 * ## Why this exists at all
 *
 * "The letters in a circle" had **five** implementations. `initialsFor` in
 * `collaborators.ts` took a first and last initial and had tests; `initialsOf`
 * in `CommentsOverlay` took the first two *words*, which is a different answer
 * for "Mary Anne Evans"; and the header roster, the comment inbox and the
 * mention list each did `name.charAt(0).toUpperCase()` inline and showed one
 * letter. So the same person was "M", "MA" and "ME" depending on which corner
 * of the product you were looking at — and the header, the surface where you
 * actually identify people, had the least informative of the three.
 *
 * That is the failure this codebase keeps finding (`HANDOFF.md` invariant 1):
 * two derivations of one answer drift, and nobody notices because each looks
 * right on its own. There is one derivation now — `initialsFor` — and this is
 * the one place that turns it into a disc.
 *
 * ## Why there is no picture
 *
 * There was a face here: six choices encoded as eleven characters, drawn as
 * about three hundred lines of SVG, with a builder in the profile editor to
 * pick them. It was removed, and the reasoning is worth keeping because it is
 * the reasoning that would bring it back.
 *
 * The encoding was right — an avatar reaches other people over **awareness**,
 * which is rebroadcast at pointer frequency, so a data URL there is a
 * photograph on the wire many times a second, and eleven characters is the
 * only honest shape for that channel. What was wrong was the premise. A
 * cartoon face is not *who someone is*; it is a decoration chosen from a list,
 * and the thing that actually identifies a person on this board is already
 * doing the work — the presence colour, which `resolvePresenceColor` makes
 * unique per room, and which appears on their cursor, their selection ring and
 * their radar ping as well as here. Initials in that colour say the same thing
 * on all five surfaces. A face said something different on one of them.
 *
 * It also cost more than it looked. Nobody was ever given a face: `avatar` was
 * absent until someone opened the editor and saved one, so the common presence
 * in the room was always the initials, and the face was a second appearance
 * that a minority had. Two ways to look at a roster is one more than a roster
 * needs.
 *
 * If a picture comes back, it should be a real one — an uploaded photograph,
 * stored where a photograph belongs and referenced from awareness by id, not
 * carried on it. That is a different feature from a face builder, and the
 * absence of this one does not stand in its way.
 */
interface Props {
  name: string;
  /** The identity colour, which is what actually says who this is. */
  color: string;
  size: number;
  /** Decorative when a name is already written beside it. */
  title?: string;
  className?: string;
}

export const Avatar: React.FC<Props> = ({ name, color, size, title, className }) => (
  <span
    className={className}
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      flexShrink: 0,
      overflow: 'hidden',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: color,
      color: '#fff',
      // Tracks the disc rather than sitting at one size: two letters at a
      // fixed 14px overflow a 20px comment pin, which is what made the
      // pins show one letter in the first place.
      fontSize: Math.round(size * 0.4),
      fontWeight: 600,
      letterSpacing: size < 28 ? '-0.02em' : 0,
      userSelect: 'none',
    }}
    title={title}
  >
    {initialsFor(name)}
  </span>
);
