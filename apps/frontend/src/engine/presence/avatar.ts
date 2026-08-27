/**
 * A face somebody built for themselves, as eleven characters.
 *
 * ## Why this is parameters and not a picture
 *
 * An avatar has to reach everyone else in the room, and the channel it reaches
 * them on is **awareness** — the ephemeral state that also carries a cursor
 * position and is therefore rebroadcast to every peer many times a second. A
 * data URL in there is a photograph on the wire at pointer frequency, to every
 * participant, forever. It is the wrong shape for the transport by three
 * orders of magnitude.
 *
 * It also has to render at four sizes that differ by a factor of five — a 20px
 * comment pin, a 24px mention row, a 32px header disc, and a 96px tile in the
 * picker — which rules out a bitmap on its own terms. So the avatar is a small
 * record of *choices*, the drawing is derived from it, and what travels is
 * `"2-4-1-0-3-5"`. Eleven characters, and every peer draws the same face
 * because the drawing is a pure function of them.
 *
 * That is the same reasoning as the sketch seeds in `rough.ts`, and it buys the
 * same two things: it survives export, and two people looking at one board
 * cannot see two different pictures.
 *
 * ## Why a builder and not a set of stickers
 *
 * A fixed gallery of twenty faces is a gallery in which most people are not
 * present. Six independent choices give a few thousand combinations from about
 * sixty small drawings, which is the difference between picking the nearest
 * stranger and making someone who is recognisably you — and being recognisable
 * across a shared board at 32 pixels is the entire job of this thing.
 */

/** The six choices that make a face. Every one is an index into a list below. */
export interface AvatarSpec {
  skin: number;
  hair: number;
  hairColor: number;
  face: number;
  accessory: number;
  bg: number;
}

/**
 * Skin tones, as a base and the shade the light does not reach.
 *
 * Two stops rather than one because the soft, rounded look this is drawn in is
 * made almost entirely of gradients — a flat fill reads as a sticker, and the
 * difference between the two is the whole illusion of a form catching light.
 */
export const SKINS: Array<{ base: string; shade: string }> = [
  { base: '#F8D5C2', shade: '#EDB79C' },
  { base: '#F1C9A5', shade: '#DDA97F' },
  { base: '#E0AC7E', shade: '#C68B5C' },
  { base: '#C68642', shade: '#A66A2E' },
  { base: '#8D5524', shade: '#6E3F17' },
  { base: '#5C3317', shade: '#42230F' },
];

/** Hair, beard and headwear colours — and the first entry is deliberately grey. */
export const HAIR_COLORS: string[] = [
  '#2B2118',
  '#4A3524',
  '#7B5230',
  '#B87333',
  '#D9A441',
  '#8E8E93',
  '#E8E3DD',
  '#7C4DFF',
  '#E0466E',
  '#2F7DD1',
];

/** The background disc, as a pair of stops for its radial gradient. */
export const BACKDROPS: Array<{ from: string; to: string }> = [
  { from: '#FFB25C', to: '#F0761E' },
  { from: '#7FD1FF', to: '#2F7DD1' },
  { from: '#9BE9A8', to: '#3FA45B' },
  { from: '#C4A7FF', to: '#7C4DFF' },
  { from: '#FF9EB5', to: '#E0466E' },
  { from: '#FFE08A', to: '#E8B10A' },
  { from: '#8FE3D9', to: '#2AA79B' },
  { from: '#C9CFD8', to: '#8A94A3' },
];

/** How many variants each dimension offers. The renderer owns their shapes. */
export const HAIR_COUNT = 8;
export const FACE_COUNT = 6;
export const ACCESSORY_COUNT = 5;

/**
 * The lengths of every dimension, in the order a spec is written.
 *
 * One list, so validation, randomising and the picker's arrows all agree about
 * what is in range. Three places deciding independently how many hairstyles
 * there are is how a saved avatar becomes an avatar nobody can draw.
 */
const LIMITS: Array<[keyof AvatarSpec, number]> = [
  ['skin', SKINS.length],
  ['hair', HAIR_COUNT],
  ['hairColor', HAIR_COLORS.length],
  ['face', FACE_COUNT],
  ['accessory', ACCESSORY_COUNT],
  ['bg', BACKDROPS.length],
];

/** The wire form: indices joined by dashes, e.g. `"2-4-1-0-3-5"`. */
export function encodeAvatar(spec: AvatarSpec): string {
  return LIMITS.map(([key]) => spec[key]).join('-');
}

/**
 * A spec from the wire, or `null` if it is not one.
 *
 * Returns null rather than a default on bad input, because the two mean
 * different things to the caller: a person who has not made an avatar shows
 * their initials, and quietly substituting a face would give someone an
 * identity they never picked. It reaches here from `localStorage`, which is
 * user-writable, and from another peer's awareness, which is another machine's
 * idea of what this format is — neither is trustworthy and both are recoverable
 * by falling back to a name everybody already has.
 */
export function decodeAvatar(raw: unknown): AvatarSpec | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('-');
  if (parts.length !== LIMITS.length) return null;

  const spec = {} as AvatarSpec;
  for (let i = 0; i < LIMITS.length; i += 1) {
    const [key, limit] = LIMITS[i];
    const n = Number(parts[i]);
    // Not `>= 0 && < limit` on a float: `Number('1.5')` is in range and is not
    // an index, and `Number('')` is 0 and would silently pass.
    if (!Number.isInteger(n) || n < 0 || n >= limit) return null;
    spec[key] = n;
  }
  return spec;
}

/** Move one dimension by `step`, wrapping — what the picker's arrows do. */
export function cycle(spec: AvatarSpec, key: keyof AvatarSpec, step: number): AvatarSpec {
  const limit = LIMITS.find(([k]) => k === key)?.[1] ?? 1;
  return { ...spec, [key]: (((spec[key] + step) % limit) + limit) % limit };
}

/**
 * A face to start from, derived from the person's id rather than random.
 *
 * Opening the picker on a random face means the first thing it does is throw
 * away whatever it showed a moment ago, and reopening it offers a different
 * stranger — so there is nothing to accept and the only path forward is to
 * build one from scratch. Seeding from the id gives *this* person one stable
 * starting face: it is the same every time they open the picker, which makes
 * "keep it" a real answer.
 */
export function avatarFromId(id: string): AvatarSpec {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const spec = {} as AvatarSpec;
  for (const [key, limit] of LIMITS) {
    h = Math.imul(h ^ (h >>> 13), 2654435761);
    spec[key] = (h >>> 8) % limit;
  }
  return spec;
}

/** A fresh face, for the shuffle button. */
export function randomAvatar(): AvatarSpec {
  const spec = {} as AvatarSpec;
  for (const [key, limit] of LIMITS) spec[key] = Math.floor(Math.random() * limit);
  return spec;
}
