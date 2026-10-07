import { falloffAt, type FalloffId, type ForceId } from './forces';

/**
 * What a force field looks like, as plain geometry.
 *
 * Pure and frame-independent: given a phase in [0, 1) it returns the marks to
 * draw, so the canvas component only has to stroke them and a test can assert
 * that nothing is ever drawn outside the ring. Coordinates are relative to the
 * cursor, in world units.
 *
 * Each force reads as what it does: pull streams inward, push streams outward,
 * drop and wind run in their direction, swirl turns, shockwave expands.
 */

export interface FieldSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0 to 1. Already includes the falloff, so the rim fades out. */
  alpha: number;
}

export interface FieldRing {
  radius: number;
  alpha: number;
}

export interface FieldArt {
  segments: FieldSegment[];
  rings: FieldRing[];
}

export interface FieldOptions {
  mode: ForceId;
  radius: number;
  falloff: FalloffId;
  /** Direction of travel for drop and wind, in degrees. 0 is right, 90 is down. */
  heading: number;
  /** Phase in [0, 1). Pass a fixed value for a static (reduced-motion) frame. */
  phase: number;
}

/** A stable pseudo-random number in [0, 1) for mark `i`, so marks do not clump. */
const jitter = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

const fract = (v: number) => v - Math.floor(v);

/** Marks fade in and out at the ends of their travel, so they never pop. */
const lifeFade = (u: number) => Math.min(1, u / 0.12, (1 - u) / 0.12);

const RAYS = 22;
const LANES = 9;
const ARC_RINGS = 3;

export function fieldArt({ mode, radius, falloff, heading, phase }: FieldOptions): FieldArt {
  const segments: FieldSegment[] = [];
  const rings: FieldRing[] = [];
  if (!(radius > 0)) return { segments, rings };

  const at = (dist: number) => falloffAt(falloff, dist, radius);

  if (mode === 'magnet' || mode === 'repel') {
    const inward = mode === 'magnet';
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2 + jitter(i) * 0.2;
      const u = fract(phase + jitter(i + 40));
      // Travel runs from the rim to the centre for pull, the other way for push.
      const pos = inward ? 1 - u : u;
      const r1 = pos * radius * 0.96;
      const r2 = Math.min(radius, Math.max(0, r1 - (inward ? -1 : 1) * radius * 0.07));
      const lo = Math.min(r1, r2);
      const hi = Math.max(r1, r2);
      const mid = (lo + hi) / 2;
      segments.push({
        x1: Math.cos(a) * lo, y1: Math.sin(a) * lo,
        x2: Math.cos(a) * hi, y2: Math.sin(a) * hi,
        alpha: lifeFade(u) * Math.max(0.25, at(mid)),
      });
    }
    return { segments, rings };
  }

  if (mode === 'swirl') {
    const STEPS = 5;
    for (let k = 0; k < ARC_RINGS; k++) {
      const r = radius * (0.3 + k * 0.26);
      const spin = phase * Math.PI * 2 * (k % 2 === 0 ? 1 : 0.75);
      for (let arc = 0; arc < 3; arc++) {
        const start = spin + (arc / 3) * Math.PI * 2 + k * 0.7;
        for (let s = 0; s < STEPS; s++) {
          const a1 = start + (s / STEPS) * 0.9;
          const a2 = start + ((s + 1) / STEPS) * 0.9;
          segments.push({
            x1: Math.cos(a1) * r, y1: Math.sin(a1) * r,
            x2: Math.cos(a2) * r, y2: Math.sin(a2) * r,
            // Brighter toward the head of the arc, so it reads as turning.
            alpha: Math.max(0.25, at(r)) * (0.35 + 0.65 * ((s + 1) / STEPS)),
          });
        }
      }
    }
    return { segments, rings };
  }

  if (mode === 'gravity' || mode === 'wind') {
    const h = (heading * Math.PI) / 180;
    const dx = Math.cos(h);
    const dy = Math.sin(h);
    // Perpendicular, for stepping across the lanes.
    const px = -dy;
    const py = dx;
    for (let i = 0; i < LANES; i++) {
      const lane = ((i + 0.5) / LANES) * 2 - 1;
      const s = lane * radius * 0.92;
      const half = Math.sqrt(Math.max(0, radius * radius - s * s)) * 0.96;
      const u = fract(phase + jitter(i + 7));
      const len = radius * 0.1;
      const centre = -half + u * 2 * half;
      const c1 = Math.max(-half, centre - len / 2);
      const c2 = Math.min(half, centre + len / 2);
      const mx = px * s + dx * ((c1 + c2) / 2);
      const my = py * s + dy * ((c1 + c2) / 2);
      segments.push({
        x1: px * s + dx * c1, y1: py * s + dy * c1,
        x2: px * s + dx * c2, y2: py * s + dy * c2,
        alpha: lifeFade(u) * Math.max(0.25, at(Math.hypot(mx, my))),
      });
    }
    return { segments, rings };
  }

  // Shockwave: two rings leaving the centre, offset by half a cycle.
  for (const offset of [0, 0.5]) {
    const u = fract(phase + offset);
    rings.push({ radius: u * radius, alpha: (1 - u) * (1 - u) * 0.9 });
  }
  return { segments, rings };
}
