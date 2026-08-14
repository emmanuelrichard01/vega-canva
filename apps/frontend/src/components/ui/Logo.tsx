import React from 'react';
import { useStore } from '../../hooks/useStore';

/**
 * The Vega mark, from the real brand assets.
 *
 * ## Why this component exists
 *
 * The app had **three different logos**. The workspace header rendered
 * `/favicon.svg`; the dashboard drew a letter `V` in a rounded black chip; the
 * sign-in screen drew a second, differently-sized letter `V` in its own chip.
 * None of them was the brand, and all three had to be found and changed by
 * hand whenever it moved.
 *
 * There is now one component, and it is the only thing in the codebase that
 * knows where these files live.
 *
 * ## Why it points at `/brand/` and not at the masters
 *
 * The masters in `VEGA LOGO LIGHT|DARK/` are print-scale — the logomark is
 * 3580px wide and 92KB, and it was being drawn at 26px.
 * `scripts/generate-brand-assets.py` regenerates
 * display-sized derivatives from them (mark 92KB → 4.9KB), trimming the
 * transparent padding the masters carry for layout, which otherwise becomes
 * dead space inside every box the logo sits in. The masters stay untouched as
 * the source of truth; these are what ship.
 *
 * ## Which variant
 *
 * The folders are named for the theme they belong to, not for the colour of
 * the ink: `LIGHT` is the variant that belongs on a light surface, `DARK` the
 * one for a dark surface. Checked by opening them rather than inferred from
 * the names, because getting it backwards renders an invisible logo and looks
 * like a missing asset.
 *
 * The mark is an **opaque tile** — an orange V and a sparkle on a filled
 * ground, with its own rounded corners — not a transparent glyph. So it needs
 * no chip, no border and no radius from us: adding any of those would either
 * double the shape or clip the artwork's own corners.
 *
 * `variant` overrides the theme for the surfaces that are one fixed colour
 * whatever the user has chosen.
 */

/** The brand's own values, sampled from the artwork rather than eyeballed. */
export const BRAND_ORANGE = '#F3A024';
export const BRAND_INK = '#161616';

type Piece = 'mark' | 'wordmark' | 'full';

function assetUrl(piece: Piece, dark: boolean): string {
  return `/brand/${piece}-${dark ? 'dark' : 'light'}.png`;
}

interface Props {
  /**
   * Which piece of the identity. Defaults to the mark.
   *
   * The interface pairs the **mark** with the product name set in the UI's own
   * type, everywhere, rather than using the wordmark image in some places and
   * text in others. Text translates, wraps and scales; a 926px raster of the
   * word does none of those. The wordmark and full lockup are here for the
   * surfaces that are genuinely brand moments rather than chrome.
   */
  piece?: Piece;
  /** Rendered height in px. Width follows the artwork's own ratio. */
  size?: number;
  /** Force a variant, for surfaces whose background does not follow the theme. */
  variant?: 'light' | 'dark';
  /**
   * Accessible name. Defaults to empty — the mark almost always sits beside
   * the product name in text, and announcing it twice is noise.
   */
  alt?: string;
  className?: string;
}

export const Logo: React.FC<Props> = ({ piece = 'mark', size = 28, variant, alt = '', className }) => {
  const darkTheme = useStore((state) => state.darkTheme);
  const dark = variant ? variant === 'dark' : darkTheme;

  return (
    <img
      src={assetUrl(piece, dark)}
      alt={alt}
      // Decorative unless it was given a name, which is the usual case here.
      aria-hidden={alt ? undefined : true}
      className={className}
      style={{ height: size, width: 'auto', objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  );
};
