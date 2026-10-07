/**
 * The table editor's named colours, for its swatch menus. Named, because a
 * swatch reads its name to a screen reader and in its tooltip — not a hex.
 */

/** A named colour: what the swatch says to a screen reader and in its tooltip. */
export interface NamedColour {
  name: string;
  hex: string;
}

/** Cell fills: light enough for body ink, plus one dark for a heading band. */
export const FILLS: NamedColour[] = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Slate 100', hex: '#F1F5F9' },
  { name: 'Amber 100', hex: '#FEF3C7' },
  { name: 'Green 100', hex: '#DCFCE7' },
  { name: 'Blue 100', hex: '#DBEAFE' },
  { name: 'Violet 100', hex: '#EDE9FE' },
  { name: 'Pink 100', hex: '#FCE7F3' },
  { name: 'Red 100', hex: '#FEE2E2' },
  { name: 'Teal 100', hex: '#CCFBF1' },
  { name: 'Slate 800', hex: '#1E293B' },
];

/** Text inks: each holds AA on white and on the light fills above. */
export const INKS: NamedColour[] = [
  { name: 'Ink', hex: '#0F172A' },
  { name: 'Slate 600', hex: '#475569' },
  { name: 'Red 700', hex: '#B91C1C' },
  { name: 'Orange 700', hex: '#C2410C' },
  { name: 'Yellow 700', hex: '#A16207' },
  { name: 'Green 700', hex: '#15803D' },
  { name: 'Cyan 700', hex: '#0E7490' },
  { name: 'Blue 700', hex: '#1D4ED8' },
  { name: 'Violet 700', hex: '#6D28D9' },
  { name: 'Pink 700', hex: '#BE185D' },
];

export const colourName = (list: NamedColour[], hex: string | undefined) =>
  hex ? list.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex : undefined;
