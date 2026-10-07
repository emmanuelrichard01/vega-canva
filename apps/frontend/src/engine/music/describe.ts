/**
 * Human-facing names for what is playing: a seeded title per variation, and
 * the key in conventional spelling.
 */
import { createRng, mixSeed } from './rng';
import type { StationId } from './stations';
import type { Key } from './theory';

const FLAT_KEYS = new Set([1, 3, 5, 8, 10]);
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const MODE_NAMES: Record<Key['mode'], string> = {
  major: 'major',
  minor: 'minor',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
  lydian: 'Lydian',
};

export function keyName(key: Key): string {
  const names = FLAT_KEYS.has(key.tonic) || key.tonic === 5 ? FLAT_NAMES : SHARP_NAMES;
  return `${names[key.tonic]} ${MODE_NAMES[key.mode]}`;
}

const WORDS: Record<StationId, { first: readonly string[]; second: readonly string[] }> = {
  ambient: {
    first: ['Slow', 'Low', 'Pale', 'Still', 'Far', 'Quiet', 'Open', 'Soft'],
    second: ['Tide', 'Meadow', 'Harbour', 'Fog', 'Horizon', 'Field', 'Lantern', 'Shore'],
  },
  piano: {
    first: ['Morning', 'Paper', 'Winter', 'Late', 'Small', 'Gentle', 'Linen', 'Amber'],
    second: ['Study', 'Letters', 'Rooms', 'Window', 'Hours', 'Garden', 'Notes', 'Light'],
  },
  lofi: {
    first: ['Rainy', 'Corner', 'Night', 'Dusty', 'Warm', 'Sunday', 'Tape', 'Late'],
    second: ['Cafe', 'Bus', 'Desk', 'Records', 'Window', 'Loop', 'Rooftop', 'Notebook'],
  },
  synth: {
    first: ['Neon', 'Coastal', 'Chrome', 'Midnight', 'Outrun', 'Analog', 'Glass', 'Static'],
    second: ['Drive', 'Skyline', 'Signal', 'Highway', 'Grid', 'Pulse', 'Arcade', 'Sunset'],
  },
  house: {
    first: ['Deep', 'Warm', 'Late', 'Velvet', 'Basement', 'Slow', 'Golden', 'Low'],
    second: ['Floor', 'Groove', 'Session', 'Hours', 'Room', 'Motion', 'Hall', 'Glow'],
  },
  retro: {
    first: ['Pixel', 'Bonus', 'Cartridge', 'High', 'Tiny', 'Secret', 'Level', 'Turbo'],
    second: ['Quest', 'Stage', 'Garden', 'Score', 'Island', 'Run', 'Castle', 'Overworld'],
  },
};

/** A stable two-word title for a variation. */
export function variationTitle(station: StationId, seed: number): string {
  const rng = createRng(mixSeed(seed, 0x717e));
  const w = WORDS[station];
  return `${rng.pick(w.first)} ${rng.pick(w.second)}`;
}

/** A fresh variation seed. Not part of the music, so it may use the clock. */
export const newSeed = () => (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
