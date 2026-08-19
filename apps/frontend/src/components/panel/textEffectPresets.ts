/**
 * The text-effect looks, as one click each.
 *
 * ## Why presets exist here at all
 *
 * The effects are five fields deep — a colour, a join, a radius, a padding and
 * an ink rule for the highlight alone — and nobody arrives at this panel
 * wanting to specify a corner radius. They arrive having seen a caption
 * somewhere and wanting *that*. A preset is the control that matches the
 * question actually being asked; the fields underneath are for the minority
 * who then want to adjust it.
 *
 * Kept out of the panel component so a preset's values live in one place. The
 * panel used to seed these inline at each toggle, which is how the "on" value
 * of a switch and the value a preset writes drift apart.
 */

import type { TextGlow, TextHighlight, TextOutline, Typography } from '../../engine/model/schema';

/** The highlight a bare toggle switches on. Also the base every preset varies. */
export const DEFAULT_TEXT_HIGHLIGHT: TextHighlight = {
  // Seeded from the brand accent so the first result is a deliberate colour
  // rather than a grey the user has to fix before the effect reads as anything.
  color: '#F3A024',
  radius: 8,
  paddingX: 10,
  paddingY: 4,
  join: 'ribbon',
  autoContrast: true,
};

export const DEFAULT_TEXT_OUTLINE: TextOutline = { color: '#161616', width: 2 };
export const DEFAULT_TEXT_GLOW: TextGlow = { color: '#F3A024', blur: 16 };

/** What a preset writes onto the typography block. */
type Patch = Partial<Typography>;

export interface TextPreset {
  id: string;
  label: string;
  hint: string;
  patch: (current: Typography) => Patch;
  /** The shape a preset claims — used to show which one is currently in effect. */
  matches: (t: Typography) => boolean;
}

/** Clearing all three, so every preset states the whole result rather than a delta. */
const NONE: Patch = { highlight: undefined, outline: undefined, glow: undefined };

/**
 * The set, in increasing loudness.
 *
 * Each is a *whole* result — every preset writes all three fields — because a
 * preset that only sets what it cares about leaves the previous look's leftovers
 * underneath it, and the user then has to work out which of two effects they are
 * looking at.
 */
export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'none',
    label: 'None',
    hint: 'Plain text, with no plate, outline or halo.',
    patch: () => NONE,
    matches: (t) => !t.highlight && !t.outline && !t.glow,
  },
  {
    id: 'ribbon',
    label: 'Ribbon',
    hint: 'The social-caption look: one continuous rounded plate that tucks around each wrapped line.',
    patch: (t) => ({
      ...NONE,
      // The current colour is kept if there already is one, so cycling presets
      // does not throw away a colour that was deliberately chosen.
      highlight: { ...DEFAULT_TEXT_HIGHLIGHT, color: t.highlight?.color ?? DEFAULT_TEXT_HIGHLIGHT.color },
    }),
    matches: (t) => Boolean(t.highlight) && t.highlight!.join === 'ribbon' && !t.outline && !t.glow,
  },
  {
    id: 'plates',
    label: 'Plates',
    hint: 'A separate rounded plate per line. Suits short, even lines.',
    patch: (t) => ({
      ...NONE,
      highlight: {
        ...DEFAULT_TEXT_HIGHLIGHT,
        join: 'plates',
        radius: 6,
        color: t.highlight?.color ?? DEFAULT_TEXT_HIGHLIGHT.color,
      },
    }),
    matches: (t) => Boolean(t.highlight) && t.highlight!.join === 'plates' && !t.outline && !t.glow,
  },
  {
    id: 'sticker',
    label: 'Sticker',
    hint: 'A thick outline around the letters, the way a cut-out sticker reads.',
    patch: () => ({ ...NONE, outline: { color: '#FFFFFF', width: 4 } }),
    matches: (t) => Boolean(t.outline) && !t.highlight && !t.glow,
  },
  {
    id: 'neon',
    label: 'Neon',
    hint: 'A bright halo behind the words, with a dark outline to hold their shape against it.',
    patch: (t) => ({
      ...NONE,
      glow: { color: t.glow?.color ?? '#F3A024', blur: 24 },
      outline: { color: '#161616', width: 1.5 },
    }),
    matches: (t) => Boolean(t.glow) && Boolean(t.outline) && !t.highlight,
  },
];

export function isTextPresetActive(preset: TextPreset, t: Typography): boolean {
  return preset.matches(t);
}

/**
 * Which effects are on, as a short line for the section header.
 *
 * So a collapsed section still says what it is doing. A disclosure that hides
 * active state is how a setting gets left on and forgotten.
 */
export function activeTextEffects(t: Typography): string | undefined {
  const on = [t.highlight && 'Highlight', t.outline && 'Outline', t.glow && 'Glow'].filter(
    Boolean
  ) as string[];
  return on.length ? on.join(' · ') : undefined;
}
