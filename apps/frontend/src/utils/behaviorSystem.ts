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

export const calculateDragSkew = (vx: number, vy: number, type: string): number => {
  const profile = getMaterialProfile(type);
  const speed = Math.hypot(vx, vy);
  const direction = vx >= 0 ? 1 : -1;
  const rawSkew = Math.min(profile.maxDragSkewDeg, (speed / 10) * profile.maxDragSkewDeg);
  return rawSkew * direction;
};
