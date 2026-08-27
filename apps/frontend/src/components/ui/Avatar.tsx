import React, { useId } from 'react';
import {
  BACKDROPS,
  HAIR_COLORS,
  SKINS,
  decodeAvatar,
  type AvatarSpec,
} from '../../engine/presence/avatar';
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
 * right on its own. There is one now, and every surface goes through this
 * component rather than through the helper, so adding a face later did not
 * mean finding five call sites again — which is the point.
 *
 * ## Why the face is drawn rather than fetched
 *
 * See `engine/presence/avatar.ts`. What travels between peers is eleven
 * characters, and this turns them into vector art at any size, so a 20px
 * comment pin and a 96px picker tile are the same face rather than the same
 * JPEG at two resolutions.
 */
interface Props {
  name: string;
  /** The identity colour. Backs the initials, and rings a face. */
  color: string;
  /** The wire form from `avatar.ts`, or a spec directly. Absent → initials. */
  avatar?: string | AvatarSpec | null;
  size: number;
  /** Decorative when a name is already written beside it. */
  title?: string;
  className?: string;
}

export const Avatar: React.FC<Props> = ({ name, color, avatar, size, title, className }) => {
  const spec = typeof avatar === 'string' ? decodeAvatar(avatar) : (avatar ?? null);

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (!spec) {
    return (
      <span
        className={className}
        style={{
          ...style,
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
  }

  return (
    <span className={className} style={style} title={title}>
      <AvatarArt spec={spec} size={size} />
    </span>
  );
};

/**
 * The drawing.
 *
 * A 100-unit square, so every coordinate below reads as a percentage and the
 * whole thing scales by one number. Rendered as an `<svg>` rather than a
 * canvas because it appears at five sizes on one screen and has to stay crisp
 * at each, and because the gradients that make it read as a rounded form are
 * one element each here and a per-pixel loop there.
 */
const AvatarArt: React.FC<{ spec: AvatarSpec; size: number }> = ({ spec, size }) => {
  // `useId` rather than a counter or the spec's own values: two people can
  // wear the same face on one screen, and duplicate gradient ids mean the
  // second one silently paints with the first one's colours.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const skin = SKINS[spec.skin] ?? SKINS[0];
  const hair = HAIR_COLORS[spec.hairColor] ?? HAIR_COLORS[0];
  const bg = BACKDROPS[spec.bg] ?? BACKDROPS[0];

  const id = (part: string) => `${uid}${part}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <defs>
        {/* Off-centre, so the light has a direction. A centred radial gradient
            is a vignette and reads as flat. */}
        <radialGradient id={id('bg')} cx="35%" cy="25%" r="85%">
          <stop offset="0%" stopColor={bg.from} />
          <stop offset="100%" stopColor={bg.to} />
        </radialGradient>
        <radialGradient id={id('skin')} cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor={skin.base} />
          <stop offset="100%" stopColor={skin.shade} />
        </radialGradient>
        <linearGradient id={id('hair')} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor={lighten(hair, 0.22)} />
          <stop offset="100%" stopColor={hair} />
        </linearGradient>
        {/* Everything is clipped to the disc, so hair that overhangs the head
            is cut by the frame rather than escaping it. */}
        <clipPath id={id('clip')}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id('clip')})`}>
        <circle cx="50" cy="50" r="50" fill={`url(#${id('bg')})`} />

        {/* The shoulders, which is what stops the head reading as a balloon. */}
        <ellipse cx="50" cy="112" rx="40" ry="34" fill={hair} opacity="0.28" />
        <ellipse cx="50" cy="114" rx="36" ry="32" fill={lighten(bg.to, 0.35)} />

        {/* Neck, drawn before the head so the jaw overlaps it. */}
        <rect x="41" y="62" width="18" height="20" rx="9" fill={skin.shade} />

        <BackHair spec={spec} fill={`url(#${id('hair')})`} />

        {/* Ears sit under the head so their outline is the head's. */}
        <ellipse cx="19" cy="47" rx="6" ry="8" fill={skin.shade} />
        <ellipse cx="81" cy="47" rx="6" ry="8" fill={skin.shade} />

        {/* The head. A rounded rect with a big radius is a jaw; an ellipse is
            an egg, and every face drawn from one looks like the same face. */}
        <rect
          x="22"
          y="18"
          width="56"
          height="60"
          rx="27"
          ry="30"
          fill={`url(#${id('skin')})`}
        />

        {/* The highlight that does most of the work. Low opacity, high up and
            to the left, matching where both gradients put their light. */}
        <ellipse cx="38" cy="33" rx="13" ry="10" fill="#fff" opacity="0.16" />

        <Face spec={spec} skin={skin.shade} />
        <FrontHair spec={spec} fill={`url(#${id('hair')})`} />
        <Accessory spec={spec} />
      </g>
    </svg>
  );
};

/**
 * The part of a hairstyle that falls behind the head.
 *
 * Split from the front for one reason: long hair has to be behind the face and
 * in front of the shoulders, and a single path cannot be in two places in the
 * z-order. Drawing it all in front put a fringe over the eyes on every long
 * style; drawing it all behind made short styles vanish under the skull.
 */
const BackHair: React.FC<{ spec: AvatarSpec; fill: string }> = ({ spec, fill }) => {
  switch (spec.hair) {
    case 2: // Long, past the shoulders.
      // The strands taper and round off. Drawn as straight-sided rectangles
      // they read as two dark blocks stuck to the sides of the head, which is
      // the failure mode of every hairstyle built out of axis-aligned edges.
      return (
        <path
          d="M18 46 Q18 14 50 14 Q82 14 82 46 Q86 70 78 94 Q70 96 66 92 Q70 66 66 44 L34 44 Q30 66 34 92 Q30 96 22 94 Q14 70 18 46 Z"
          fill={fill}
        />
      );
    case 4: // Bun, gathered at the back.
      return (
        <>
          <circle cx="50" cy="12" r="11" fill={fill} />
          <path d="M20 48 Q20 16 50 16 Q80 16 80 48 L80 58 L20 58 Z" fill={fill} />
        </>
      );
    case 6: // Shoulder length, tucked behind the ears.
      return (
        <path
          d="M19 48 Q19 15 50 15 Q81 15 81 48 Q83 64 76 76 Q70 78 66 74 Q69 58 66 42 L34 42 Q31 58 34 74 Q30 78 24 76 Q17 64 19 48 Z"
          fill={fill}
        />
      );
    case 7: // A wrap, which reads as headwear rather than hair.
      return <path d="M18 46 Q18 12 50 12 Q82 12 82 46 L82 54 L18 54 Z" fill={fill} />;
    default:
      return null;
  }
};

/** The part that sits over the forehead. */
const FrontHair: React.FC<{ spec: AvatarSpec; fill: string }> = ({ spec, fill }) => {
  switch (spec.hair) {
    case 0: // Bald, and it is a real choice rather than the absence of one.
      return null;
    case 1: // Cropped.
      return <path d="M22 42 Q22 17 50 17 Q78 17 78 42 Q70 30 50 30 Q30 30 22 42 Z" fill={fill} />;
    case 3: // Curls, as a run of overlapping circles.
      return (
        <g fill={fill}>
          {[26, 36, 46, 56, 66, 74].map((x, i) => (
            <circle key={x} cx={x} cy={i % 2 === 0 ? 24 : 20} r="11" />
          ))}
          <path d="M22 34 Q22 20 50 20 Q78 20 78 34 Q70 28 50 28 Q30 28 22 34 Z" />
        </g>
      );
    case 5: // A side part with a swept fringe.
      return <path d="M22 40 Q22 16 50 16 Q78 16 78 40 Q74 26 44 30 Q30 32 22 40 Z" fill={fill} />;
    case 7: // The wrap's front edge.
      return <path d="M22 40 Q22 16 50 16 Q78 16 78 40 Q78 30 50 30 Q22 30 22 40 Z" fill={fill} />;
    default: // 2, 4, 6 — the long styles, whose fringe is a soft cap.
      return <path d="M23 40 Q23 18 50 18 Q77 18 77 40 Q68 29 50 29 Q32 29 23 40 Z" fill={fill} />;
  }
};

/**
 * Brows, eyes and mouth as one choice.
 *
 * They are one dimension rather than three because an expression is a whole:
 * closed happy eyes over a flat mouth is not a mood anyone has, and offering
 * the two independently mostly produces combinations nobody would pick. Six
 * expressions that each read as something beats two hundred that mostly do not.
 */
const Face: React.FC<{ spec: AvatarSpec; skin: string }> = ({ spec, skin }) => {
  const ink = '#2B2118';
  const brow = (d: string) => <path d={d} stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none" />;
  const blush = (
    <>
      <ellipse cx="31" cy="56" rx="6" ry="3.4" fill={skin} opacity="0.55" />
      <ellipse cx="69" cy="56" rx="6" ry="3.4" fill={skin} opacity="0.55" />
    </>
  );

  switch (spec.face) {
    case 1: // Warm — smiling eyes.
      return (
        <g>
          {brow('M32 38 Q39 34 46 37')}
          {brow('M54 37 Q61 34 68 38')}
          <path d="M33 48 Q39 42 45 48" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M55 48 Q61 42 67 48" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          {blush}
          <path d="M40 60 Q50 68 60 60" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    case 2: // Grinning, teeth showing.
      return (
        <g>
          {brow('M32 36 Q39 32 46 35')}
          {brow('M54 35 Q61 32 68 36')}
          <circle cx="39" cy="46" r="3.4" fill={ink} />
          <circle cx="61" cy="46" r="3.4" fill={ink} />
          {blush}
          <path d="M39 58 Q50 70 61 58 Z" fill={ink} />
          <path d="M42 59 Q50 62 58 59 Z" fill="#fff" />
        </g>
      );
    case 3: // Wry — one brow up, mouth to one side.
      return (
        <g>
          {brow('M32 39 Q39 34 46 38')}
          {brow('M54 33 Q61 30 68 34')}
          <circle cx="39" cy="46" r="3.2" fill={ink} />
          <circle cx="61" cy="46" r="3.2" fill={ink} />
          <path d="M41 61 Q50 64 59 58" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    case 4: // Winking.
      return (
        <g>
          {brow('M32 38 Q39 34 46 37')}
          {brow('M54 37 Q61 34 68 38')}
          <path d="M34 47 Q39 42 44 47" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="61" cy="46" r="3.4" fill={ink} />
          {blush}
          <path d="M40 60 Q50 67 60 60" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    case 5: // Composed — the one that is not smiling.
      return (
        <g>
          {brow('M32 37 L46 37')}
          {brow('M54 37 L68 37')}
          <circle cx="39" cy="46" r="3.2" fill={ink} />
          <circle cx="61" cy="46" r="3.2" fill={ink} />
          <path d="M42 61 L58 61" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
    default: // Open and friendly, the one an unedited face starts on.
      return (
        <g>
          {brow('M32 38 Q39 34 46 37')}
          {brow('M54 37 Q61 34 68 38')}
          <circle cx="39" cy="46" r="3.6" fill={ink} />
          <circle cx="61" cy="46" r="3.6" fill={ink} />
          <circle cx="40.4" cy="44.6" r="1.2" fill="#fff" />
          <circle cx="62.4" cy="44.6" r="1.2" fill="#fff" />
          {blush}
          <path d="M41 60 Q50 66 59 60" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      );
  }
};

/** Glasses, a beard, or nothing — the details people actually recognise. */
const Accessory: React.FC<{ spec: AvatarSpec }> = ({ spec }) => {
  switch (spec.accessory) {
    case 1: // Clear glasses.
      return (
        <g fill="none" stroke="#2B2118" strokeWidth="2.4" opacity="0.85">
          <rect x="28" y="39" width="18" height="14" rx="7" fill="#fff" fillOpacity="0.18" />
          <rect x="54" y="39" width="18" height="14" rx="7" fill="#fff" fillOpacity="0.18" />
          <path d="M46 45 L54 45" />
        </g>
      );
    case 2: // Sunglasses, which cover the eyes and so are drawn over them.
      return (
        <g>
          <rect x="27" y="38" width="20" height="14" rx="6" fill="#22242A" />
          <rect x="53" y="38" width="20" height="14" rx="6" fill="#22242A" />
          <path d="M47 44 L53 44" stroke="#22242A" strokeWidth="3" />
          <path d="M30 41 L36 41" stroke="#fff" strokeWidth="2" opacity="0.4" strokeLinecap="round" />
        </g>
      );
    case 3: // A beard, which follows the jaw the head shape describes.
      return (
        <path
          d="M26 50 Q26 78 50 78 Q74 78 74 50 Q74 66 62 68 Q50 70 38 68 Q26 66 26 50 Z"
          fill="#2B2118"
          opacity="0.72"
        />
      );
    case 4: // Earrings.
      return (
        <g>
          <circle cx="19" cy="55" r="3.2" fill="#E8B10A" />
          <circle cx="81" cy="55" r="3.2" fill="#E8B10A" />
        </g>
      );
    default:
      return null;
  }
};

/** Mix a hex colour towards white, for the lit stop of a two-stop gradient. */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}
