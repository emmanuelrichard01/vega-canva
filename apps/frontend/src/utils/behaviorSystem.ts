export interface MaterialProfile {
  mass: number;
  frictionAir: number;
  restitution: number;
  density: number;
  maxDragSkewDeg: number;
  magneticCohesion: boolean;
  fieldRadius: number;
}

export const MATERIAL_PROFILES: Record<string, MaterialProfile> = {
  sticky: {
    mass: 1,
    frictionAir: 0.2, // Floats down gently
    restitution: 0.25,
    density: 0.0005,
    maxDragSkewDeg: 3.5,
    magneticCohesion: true,
    fieldRadius: 200,
  },
  image: {
    mass: 5,
    frictionAir: 0.04, // Slides far with high momentum
    restitution: 0.1,
    density: 0.005,
    maxDragSkewDeg: 1.5,
    magneticCohesion: false,
    fieldRadius: 150,
  },
  audio: {
    mass: 3,
    frictionAir: 0.08,
    restitution: 0.8, // Bouncy!
    density: 0.002,
    maxDragSkewDeg: 2.0,
    magneticCohesion: false,
    fieldRadius: 250,
  },
  text: {
    mass: 10,
    frictionAir: 0.8, // Rigid structural stability
    restitution: 0.0,
    density: 0.01,
    maxDragSkewDeg: 0.5,
    magneticCohesion: false,
    fieldRadius: 80,
  },
  shape: {
    mass: 2,
    frictionAir: 0.1,
    restitution: 0.4,
    density: 0.001,
    maxDragSkewDeg: 2.0,
    magneticCohesion: false,
    fieldRadius: 120,
  }
};

export const getMaterialProfile = (type: string): MaterialProfile => {
  return MATERIAL_PROFILES[type] || MATERIAL_PROFILES.shape;
};

/**
 * Materials a person can actually choose.
 *
 * The profiles above are keyed by node *type*, which meant how an object
 * behaved was decided entirely by what it was — a sticky always floated, an
 * image always carried momentum — with no way to see that, let alone change
 * it. The physics had personality that never surfaced anywhere in the UI.
 *
 * These are the same three dials (drag, bounce, density) expressed as things
 * you can picture. Named for how they feel rather than what they compute,
 * because "restitution 0.8" is not a choice anyone can make confidently.
 */
export type MaterialId = 'feather' | 'paper' | 'rubber' | 'wood' | 'stone';

export interface Material {
  id: MaterialId;
  label: string;
  /** One line describing the behaviour, shown as the control's help text. */
  hint: string;
  frictionAir: number;
  restitution: number;
  density: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  feather: {
    id: 'feather',
    label: 'Feather',
    hint: 'Barely any weight — drifts a short way and settles almost at once',
    frictionAir: 0.12,
    restitution: 0.1,
    density: 0.0002,
  },
  paper: {
    id: 'paper',
    label: 'Paper',
    hint: 'Light and easy to move, with a soft landing',
    frictionAir: 0.065,
    restitution: 0.25,
    density: 0.0005,
  },
  rubber: {
    id: 'rubber',
    label: 'Rubber',
    hint: 'Bounces off whatever it hits',
    frictionAir: 0.027,
    restitution: 0.85,
    density: 0.002,
  },
  wood: {
    id: 'wood',
    label: 'Wood',
    hint: 'Solid and predictable — slides and stops',
    frictionAir: 0.034,
    restitution: 0.4,
    density: 0.001,
  },
  stone: {
    id: 'stone',
    label: 'Stone',
    // Not "hard to shift": force scales with mass, so it accelerates like
    // anything else. What actually distinguishes stone is that almost nothing
    // slows it down once it is moving.
    hint: 'Heavy and slick — once it is moving it carries a long way',
    frictionAir: 0.013,
    restitution: 0.1,
    density: 0.006,
  },
};

export const MATERIAL_IDS: MaterialId[] = ['feather', 'paper', 'rubber', 'wood', 'stone'];

/** What each node type behaves like until someone chooses otherwise. */
const DEFAULT_MATERIAL_BY_TYPE: Record<string, MaterialId> = {
  sticky: 'paper',
  text: 'stone',
  image: 'stone',
  audio: 'rubber',
  shape: 'wood',
  path: 'feather',
};

export const defaultMaterialForType = (type: string): MaterialId =>
  DEFAULT_MATERIAL_BY_TYPE[type] ?? 'wood';

/** The material a node actually simulates with. */
export const resolveMaterial = (node: { type: string; material?: string }): Material => {
  const chosen = node.material as MaterialId | undefined;
  if (chosen && MATERIALS[chosen]) return MATERIALS[chosen];
  return MATERIALS[defaultMaterialForType(node.type)];
};

export const calculateDragSkew = (vx: number, vy: number, type: string): number => {
  const profile = getMaterialProfile(type);
  const speed = Math.hypot(vx, vy);
  const direction = vx >= 0 ? 1 : -1;
  const rawSkew = Math.min(profile.maxDragSkewDeg, (speed / 10) * profile.maxDragSkewDeg);
  return rawSkew * direction;
};
