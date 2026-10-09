import type { AnyNode, FrameNode } from '../model/schema';

/**
 * Deck themes: a page, a type pairing and a small palette, applied to slides.
 *
 * Five, each a complete point of view rather than a colour swap. A theme is
 * not stored anywhere: it is written into the slides' own fills, fonts and
 * colours, so a deck keeps looking the same in an export, on an old client
 * and after somebody restyles one heading by hand. The theme a slide wears is
 * recognised from its page colour when it is needed again.
 *
 * Every ink is at least 4.5:1 on its page and on its surface (`themes.test`
 * checks it), and `muted` is still body-text legible: a deck is read from the
 * back of a room.
 */
export interface DeckTheme {
  id: string;
  label: string;
  /** One line for the picker. */
  blurb: string;
  /** The slide's page. */
  page: string;
  /** Cards, panels and image wells on the page. */
  surface: string;
  /** Hairlines and card edges. */
  line: string;
  ink: string;
  muted: string;
  accent: string;
  /** Text set on `accent`. */
  onAccent: string;
  /** Headings, numbers and quotes. */
  display: { family: string; weight: number; tracking: number };
  /** Everything else. */
  body: { family: string; weight: number };
  /** Series colours for charts on this page, strongest first. */
  series: string[];
}

export const DECK_THEMES: readonly DeckTheme[] = [
  {
    id: 'graphite',
    label: 'Graphite',
    blurb: 'Dark, quiet, one warm accent. For a stage.',
    page: '#14161A',
    surface: '#1E2127',
    line: '#2E323A',
    ink: '#F4F5F7',
    muted: '#A3A9B4',
    accent: '#F3A024',
    onAccent: '#161616',
    display: { family: 'Inter', weight: 700, tracking: -1.2 },
    body: { family: 'Inter', weight: 400 },
    series: ['#F3A024', '#7FB4FF', '#6FD3B5', '#C9A7FF'],
  },
  {
    id: 'paper',
    label: 'Paper',
    blurb: 'Warm page, serif headlines. For a story.',
    page: '#FAF7F2',
    surface: '#F1ECE3',
    line: '#E2DACB',
    ink: '#1C1917',
    muted: '#57534E',
    accent: '#B4441C',
    onAccent: '#FFFFFF',
    display: { family: 'DM Serif Display', weight: 400, tracking: -0.6 },
    body: { family: 'Inter', weight: 400 },
    series: ['#B4441C', '#3F6C8F', '#7C8B4A', '#A47A3C'],
  },
  {
    id: 'studio',
    label: 'Studio',
    blurb: 'Bright white, crisp sans, indigo. For a product.',
    page: '#FFFFFF',
    surface: '#F3F4F8',
    line: '#E3E5EC',
    ink: '#0F172A',
    muted: '#4B5565',
    accent: '#4F46E5',
    onAccent: '#FFFFFF',
    display: { family: 'Plus Jakarta Sans', weight: 800, tracking: -1 },
    body: { family: 'Plus Jakarta Sans', weight: 400 },
    series: ['#4F46E5', '#0EA5E9', '#14B8A6', '#F59E0B'],
  },
  {
    id: 'aurora',
    label: 'Aurora',
    blurb: 'Deep navy, grotesk type, teal. For numbers.',
    page: '#0B1220',
    surface: '#131C2E',
    line: '#22304A',
    ink: '#E8EEF8',
    muted: '#9AA8BF',
    accent: '#5EEAD4',
    onAccent: '#062A26',
    display: { family: 'Space Grotesk', weight: 700, tracking: -1 },
    body: { family: 'Inter', weight: 400 },
    series: ['#5EEAD4', '#93C5FD', '#FCA5A5', '#FDE68A'],
  },
  {
    id: 'ledger',
    label: 'Ledger',
    blurb: 'Cool grey, grotesk type, teal. For engineering.',
    page: '#F4F6F8',
    surface: '#E9EDF1',
    line: '#D5DCE3',
    ink: '#0F172A',
    muted: '#475467',
    accent: '#0E7C6B',
    onAccent: '#FFFFFF',
    display: { family: 'Space Grotesk', weight: 700, tracking: -1 },
    body: { family: 'Inter', weight: 400 },
    series: ['#0E7C6B', '#2563EB', '#B45309', '#7C3AED'],
  },
];

export const DEFAULT_THEME = DECK_THEMES[2];

export function deckTheme(id: string | undefined): DeckTheme | undefined {
  return DECK_THEMES.find((t) => t.id === id);
}

const upper = (c: unknown) => (typeof c === 'string' ? c.toUpperCase() : '');

/** The first solid fill of an appearance, if any. */
export function solidFill(node: { appearance?: { fill?: ReadonlyArray<{ type: string; color?: string }> } } | undefined): string | undefined {
  const f = node?.appearance?.fill?.find((p) => p.type === 'solid');
  return f?.color;
}

/** The theme a slide wears, recognised from its page colour. */
export function themeOfFrame(frame: FrameNode | undefined): DeckTheme | undefined {
  const page = upper(solidFill(frame));
  return page ? DECK_THEMES.find((t) => upper(t.page) === page) : undefined;
}

type Role = 'page' | 'surface' | 'line' | 'ink' | 'muted' | 'accent' | 'onAccent';
const ROLES: Role[] = ['page', 'surface', 'line', 'ink', 'muted', 'accent', 'onAccent'];

/** Which role `color` plays in `theme`, if it is one of the theme's colours. */
function roleIn(theme: DeckTheme | undefined, color: unknown): Role | undefined {
  if (!theme || typeof color !== 'string') return undefined;
  const c = upper(color);
  return ROLES.find((r) => upper(theme[r]) === c);
}

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgb(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast between two hex colours; 21 when either cannot be read, so it never forces a change. */
export function contrastOf(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 21;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text this large is a heading and takes the display face, when nothing else says. */
const DISPLAY_SIZE = 40;

/**
 * Whether text is set in the display face: by the face itself when the old
 * theme pairs two faces, by weight when it uses one face for both, and by
 * size when the slide wore no theme at all.
 */
function isDisplayType(was: DeckTheme | undefined, t: Record<string, unknown>, size: number): boolean {
  if (!was) return size >= DISPLAY_SIZE;
  if (was.display.family !== was.body.family) return t.fontFamily === was.display.family;
  return Number(t.fontWeight ?? 400) >= was.display.weight - 50 && size >= 28;
}

/**
 * The writes that dress `frame` and everything it holds in `theme`.
 *
 * Colours that belonged to the slide's previous theme move to the same role in
 * the new one: its accent becomes this accent, its muted text this muted text.
 * A colour somebody chose by hand is left alone unless it would no longer be
 * readable on the new page, in which case text takes the theme's ink. Type
 * changes face by size: headings take the display face, everything else the
 * body face, and weights follow the face.
 */
export function themePatches(
  theme: DeckTheme,
  frame: FrameNode,
  members: readonly AnyNode[]
): Array<{ id: string; changes: Record<string, unknown> }> {
  const was = themeOfFrame(frame);
  const map = (color: unknown, fallback?: Role): string | undefined => {
    const role = roleIn(was, color) ?? fallback;
    return role ? theme[role] : undefined;
  };
  const patches: Array<{ id: string; changes: Record<string, unknown> }> = [
    {
      id: frame.id,
      changes: { appearance: { ...(frame.appearance ?? {}), fill: [{ type: 'solid', color: theme.page, opacity: 1 }] } },
    },
  ];

  for (const node of members) {
    if (node.id === frame.id) continue;
    const changes: Record<string, unknown> = {};
    const n = node as AnyNode & {
      typography?: Record<string, unknown>;
      appearance?: { fill?: Array<{ type: string; color?: string }>; stroke?: { color?: string } };
      text?: string;
    };

    if (n.appearance && n.type !== 'connector') {
      const fill = n.appearance.fill;
      const strokeColor = n.appearance.stroke?.color;
      let next = n.appearance as Record<string, unknown>;
      if (fill?.length) {
        const mapped = fill.map((p) => (p.type === 'solid' && map(p.color) ? { ...p, color: map(p.color) } : p));
        if (mapped.some((p, i) => p !== fill[i])) next = { ...next, fill: mapped };
      }
      if (strokeColor && map(strokeColor)) next = { ...next, stroke: { ...n.appearance.stroke, color: map(strokeColor) } };
      if (next !== n.appearance) changes.appearance = next;
    }
    if (n.type === 'connector' && n.appearance?.stroke?.color && map(n.appearance.stroke.color)) {
      changes.appearance = { ...n.appearance, stroke: { ...n.appearance.stroke, color: map(n.appearance.stroke.color) } };
    }

    if (n.typography && (n.type === 'text' || n.type === 'shape')) {
      const t = n.typography;
      const size = typeof t.fontSize === 'number' ? t.fontSize : 16;
      const display = isDisplayType(was, t, size);
      // What the text now sits on: its own fill when it has one, else the page.
      const ground = n.type === 'shape' ? (solidFill(changes.appearance as never) ?? solidFill(n as never) ?? theme.page) : theme.page;
      let color = map(t.color);
      if (!color && typeof t.color === 'string' && contrastOf(t.color, ground) < 4.5) color = theme.ink;
      if (color && contrastOf(color, ground) < 4.5) color = contrastOf(theme.ink, ground) >= 4.5 ? theme.ink : theme.onAccent;
      changes.typography = {
        ...t,
        fontFamily: display ? theme.display.family : theme.body.family,
        fontWeight: display ? theme.display.weight : t.fontWeight !== undefined && Number(t.fontWeight) >= 600 ? 600 : theme.body.weight,
        ...(display ? { letterSpacing: theme.display.tracking } : null),
        ...(color ? { color } : null),
      };
    }

    if (Object.keys(changes).length) patches.push({ id: node.id, changes });
  }
  return patches;
}
