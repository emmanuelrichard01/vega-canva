import { hexToHsv, hsvToHex } from './color';

/**
 * A colour's own family, derived.
 *
 * ## The gap this fills
 *
 * Every picker on this canvas offered two things: a fixed set of swatches, and
 * a saturation-value field. Between them sits the question people actually
 * arrive with — *this colour, but lighter* — and neither answers it. The
 * swatches are somebody else's colours; the field asks you to reproduce a hue
 * you already have by eye, which is the one operation a colour field is worst
 * at, because holding a hue steady while moving one axis is precisely what a
 * two-axis drag cannot do.
 *
 * A derived ramp answers it in one click, and answers it *consistently*: pick
 * the third step of a blue and the third step of a red and they are the same
 * distance from their parents, so a set of tints chosen this way holds together
 * as a set. That is the difference between a palette and a pile.
 */

/**
 * Tints and shades of one colour, light to dark.
 *
 * ## Why this walks value and saturation together
 *
 * Lightening by value alone runs to white through a chalky, washed-out middle,
 * because a colour at full saturation and 95% value is a pastel nobody chose.
 * Real tint ramps — the ones every design system ships — *drop* saturation as
 * they lighten and *raise* it a little as they darken, which is what keeps the
 * pale end looking tinted rather than faded and the dark end looking rich
 * rather than muddy.
 *
 * Hue is held exactly. A ramp that drifts hue is not a ramp of this colour, and
 * the whole point is that every step is recognisably the same colour.
 *
 * ## Where the colour sits in its own ramp
 *
 * Wherever its lightness puts it — near the top for a pale colour, near the
 * bottom for a dark one. This paragraph was here before the code was, which is
 * the interesting part: the ramp **always placed the input dead centre**, four
 * tints above and four shades below, whatever colour it was.
 *
 * For most colours that is invisible. At the ends it is not. White has no room
 * above it, so its four tints were four more whites; black has no room below,
 * so its four shades were four more blacks. Picking `#FFFFFF` produced
 * `[white × 5, four greys]` — and the row keyed its swatches by colour, so
 * React collapsed the five duplicates into one and the ramp visibly lost half
 * its steps. Approaching either end compressed the same way, a little less each
 * time, which is what "begins to look broken" looks like.
 *
 * So the base's index is derived from its **HSL lightness**, `v · (1 − s/2)`,
 * rather than fixed at the middle. Lightness rather than value because value
 * alone calls a saturated blue "light" — `#2563EB` has a value of 0.92 and is
 * plainly a mid-tone; its lightness is 0.54, which is where it belongs.
 *
 * Each half is then spread across the room that actually exists on its side, so
 * every step differs from its neighbours by construction, at any input.
 *
 * @param hex   the colour to build around.
 * @param count how many steps, including the colour itself.
 * @returns hex strings, lightest first, no two the same.
 */
export function tintsAndShades(hex: string, count = 9): string[] {
  const hsv = hexToHsv(hex);
  // A colour with no hue to hold — pure black, pure white, or a string that is
  // not a colour at all — still deserves a ramp, and a grey ramp is the honest
  // one. Falling back to an arbitrary hue would invent a colour nobody picked.
  const base = hsv ?? { h: 0, s: 0, v: 0.5 };
  if (count <= 1) return [hsvToHex(base)];

  /**
   * Where the colour sits, from its own lightness.
   *
   * `v · (1 − s/2)` is HSL's lightness in HSV's terms. White lands at 0, black
   * at `count - 1`, and everything else in between — so the number of tints and
   * the number of shades are each the room genuinely available.
   */
  const lightness = base.v * (1 - base.s / 2);
  const anchor = Math.round((1 - lightness) * (count - 1));

  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i === anchor) {
      out.push(hsvToHex(base));
    } else if (i < anchor) {
      // Towards white: value climbs, saturation falls away. `k` reaches 1 only
      // at index 0, and neither axis reaches its limit even there, so the
      // lightest tint is a tint rather than white.
      const k = (anchor - i) / anchor;
      out.push(hsvToHex({
        h: base.h,
        s: base.s * (1 - k * 0.88),
        v: base.v + (1 - base.v) * k * 0.96,
      }));
    } else {
      // Towards black, with a small lift in saturation. Dropping value alone
      // greys a colour out as it darkens; a deep red is *more* saturated than
      // the red it came from, not less.
      const t = (i - anchor) / (count - 1 - anchor);
      out.push(hsvToHex({
        h: base.h,
        s: Math.min(1, base.s * (1 + t * 0.25)),
        v: base.v * (1 - t * 0.9),
      }));
    }
  }
  return out;
}

/**
 * Curated ramps, shared by every picker on the board.
 *
 * ## Why these live here rather than with the grid
 *
 * They were written for the grid generator and were the best colour affordance
 * in the app by a distance — while the general colour picker, the one every
 * stroke and every piece of text goes through, offered nine flat hues. Two
 * standards for the same decision, and the good one reachable from one panel.
 *
 * Moved to the model layer so both read the same list. `gridStyle` re-exports
 * it, so nothing that already knew about `GRID_PALETTES` had to learn a new
 * name, and the grid's own recipes keep working unchanged.
 *
 * Ordered light to dark within each set. That is not decoration: the grid's
 * `gradient` and `weight` colour modes ramp along the array, and a picker's
 * shade row reads as a scale for the same reason. `Flags` is deliberately the
 * exception and sits last, where a reader scanning for a ramp will have stopped
 * looking.
 */
export const CURATED_PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: 'ember', name: 'Ember', colors: ['#FFF1E0', '#FFD9A8', '#FFAE5C', '#F97316', '#C2410C', '#7C2D12'] },
  { id: 'tide', name: 'Tide', colors: ['#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0284C7', '#075985'] },
  { id: 'moss', name: 'Moss', colors: ['#ECFDF5', '#BBF7D0', '#86EFAC', '#34D399', '#059669', '#065F46'] },
  { id: 'orchid', name: 'Orchid', colors: ['#FAF5FF', '#E9D5FF', '#D8B4FE', '#A855F7', '#7E22CE', '#581C87'] },
  { id: 'clay', name: 'Clay', colors: ['#FAF7F2', '#EADDC8', '#D6BFA0', '#B79268', '#8A6642', '#5B4028'] },
  { id: 'graphite', name: 'Graphite', colors: ['#F8FAFC', '#E2E8F0', '#CBD5E1', '#94A3B8', '#475569', '#1E293B'] },
  { id: 'punch', name: 'Punch', colors: ['#FDE68A', '#FCA5A5', '#F472B6', '#818CF8', '#22D3EE', '#4ADE80'] },
  { id: 'dusk', name: 'Dusk', colors: ['#FEF3C7', '#FDBA74', '#FB7185', '#C026D3', '#6D28D9', '#312E81'] },
  { id: 'lagoon', name: 'Lagoon', colors: ['#ECFEFF', '#A5F3FC', '#5EEAD4', '#2DD4BF', '#0D9488', '#134E4A'] },
  { id: 'bloom', name: 'Bloom', colors: ['#FFF1F2', '#FECDD3', '#FDA4AF', '#FB7185', '#E11D48', '#881337'] },
  { id: 'citrus', name: 'Citrus', colors: ['#FEFCE8', '#FEF08A', '#FDE047', '#FACC15', '#CA8A04', '#713F12'] },
  { id: 'slate', name: 'Slate', colors: ['#F0F9FF', '#DBEAFE', '#BFDBFE', '#60A5FA', '#2563EB', '#1E3A8A'] },
  { id: 'terra', name: 'Terra', colors: ['#FDF4E3', '#F5D5A8', '#E0A96D', '#C1743C', '#8C4A21', '#4A2410'] },
  /**
   * The one that does not ramp, and says so by being last.
   *
   * Every set above runs light to dark so `gradient` and `weight` have
   * something to ramp along -- the property that makes a palette usable as a
   * scale rather than an assortment. This one is deliberately equal-weight:
   * six colours that hold their own against each other, for the grids where
   * the modules are peers and a ramp would invent a hierarchy that is not
   * there. It reads badly under `weight` and that is the honest trade.
   */
  { id: 'flags', name: 'Flags', colors: ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6'] },
];

/**
 * Which curated palette a colour belongs to, if any.
 *
 * Lets the picker mark the row a colour came from, so reopening it shows where
 * you are rather than fifteen equally plausible rows. Case-insensitive, because
 * hex arrives from a text field as often as from a swatch.
 */
export function paletteOf(hex: string): string | null {
  const target = hex.toUpperCase();
  for (const palette of CURATED_PALETTES) {
    if (palette.colors.some((c) => c.toUpperCase() === target)) return palette.id;
  }
  return null;
}
