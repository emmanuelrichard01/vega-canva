/**
 * Non-destructive image adjustments.
 *
 * `ImageNode.filters` declared `brightness`, `contrast` and `blur` for the
 * whole life of the project and `ImageRenderer` read `src`, `width`, `height`
 * and `cornerRadius` — and nothing else. A stored adjustment was silently
 * ignored. Fourth of the seven dead items in `docs/CANVAS-SPEC.md`.
 *
 * ## Why the document stores its own units, not Konva's
 *
 * Konva's filters each have their own scale, and they do not agree with each
 * other: `Brighten` wants -1..1, `Contrast` wants -100..100, and `HSL` takes a
 * *power of two* as its saturation. Storing those raw would put a renderer's
 * private conventions into the CRDT, where they would be read by the SVG
 * exporter and by every future client — and changing renderer, or Konva
 * changing a range, would silently re-interpret every document ever written.
 *
 * So the document stores one honest scale — **-100..100, where 0 is
 * untouched** — and this module is the only place that knows what Konva wants.
 * That is the same rule `konvaFontStyle` follows for typography, for the same
 * reason.
 */

/** Every adjustment, in document units. 0 is "as shot" for all of them. */
export interface ImageAdjustments {
  /** -100 (black) .. 100 (blown out). */
  brightness: number;
  /** -100 (flat grey) .. 100 (crushed). */
  contrast: number;
  /** -100 (greyscale) .. 100 (vivid). */
  saturation: number;
  /** 0 (sharp) .. 100. Unlike the others this has no negative half. */
  blur: number;
}

export const NO_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
};

export const ADJUSTMENT_IDS = ['brightness', 'contrast', 'saturation', 'blur'] as const;
export type AdjustmentId = (typeof ADJUSTMENT_IDS)[number];

export const ADJUSTMENT_LABELS: Record<AdjustmentId, string> = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  blur: 'Blur',
};

/** Blur is the one adjustment with no negative half — you cannot un-blur. */
export const ADJUSTMENT_MIN: Record<AdjustmentId, number> = {
  brightness: -100,
  contrast: -100,
  saturation: -100,
  blur: 0,
};

/**
 * What each adjustment is measured in.
 *
 * Three of these are a **departure** from as-shot, expressed in points of a
 * hundred, and one is a **distance** in pixels. A panel that shows all four as
 * bare numbers is asking somebody to know which is which, and the two are not
 * the same kind of quantity: `+40` brightness and `40` blur look alike and
 * behave nothing alike.
 */
export const ADJUSTMENT_UNITS: Record<AdjustmentId, string> = {
  brightness: '',
  contrast: '',
  saturation: '',
  blur: 'px',
};

/** What moving each one actually does, for the control's tooltip. */
export const ADJUSTMENT_HINTS: Record<AdjustmentId, string> = {
  brightness: 'Lifts or drops every tone by the same amount. Highlights clip first.',
  contrast: 'Pushes tones away from the midpoint, or towards it.',
  saturation: 'How much colour. All the way down is greyscale.',
  blur: 'Softens the image. There is no negative half — you cannot un-blur.',
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Read adjustments off a stored value, clamped, with anything unusable
 * treated as untouched.
 *
 * Non-finite values matter here more than in most places: they reach a pixel
 * loop that runs over every channel of every pixel, and `NaN` there does not
 * throw — it silently turns the whole image transparent black, which reads as
 * "the image failed to load" rather than as a bad slider value.
 */
export function readAdjustments(raw: unknown): ImageAdjustments {
  const source = (raw ?? {}) as Record<string, unknown>;
  const read = (id: AdjustmentId): number => {
    const value = source[id];
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return clamp(value, ADJUSTMENT_MIN[id], 100);
  };
  return {
    brightness: read('brightness'),
    contrast: read('contrast'),
    saturation: read('saturation'),
    blur: read('blur'),
  };
}

/**
 * Whether anything is actually adjusted.
 *
 * Load-bearing, not a convenience. Konva filters only run on a **cached**
 * node, and caching rasterizes the image into an offscreen canvas at its
 * current size — memory for every image on the board, and a visible loss of
 * sharpness when the canvas is later zoomed in past the cached resolution. An
 * untouched image must therefore never be cached at all.
 */
export function hasAdjustments(a: ImageAdjustments): boolean {
  return a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0 || a.blur !== 0;
}

/**
 * Strip the defaults, for storage.
 *
 * Writing `{brightness: 0, contrast: 0, saturation: 0, blur: 0}` onto every
 * image that was nudged once and put back would make `filters` present-but-
 * meaningless on most nodes, and `hasAdjustments` would still be false while
 * the exporter and the Layers panel both had to keep asking. Returning
 * `undefined` for an untouched image keeps "has this been adjusted" answerable
 * by the presence of the key.
 */
export function packAdjustments(a: ImageAdjustments): Partial<ImageAdjustments> | undefined {
  const packed: Partial<ImageAdjustments> = {};
  for (const id of ADJUSTMENT_IDS) {
    if (a[id] !== 0) packed[id] = a[id];
  }
  return Object.keys(packed).length > 0 ? packed : undefined;
}

// ---------------------------------------------------------------------------
// Konva's units
// ---------------------------------------------------------------------------

/**
 * How far ±100 goes, per adjustment.
 *
 * Chosen by rendering a photograph across the range and looking at it, not
 * from the filters' nominal limits. Konva's `Brighten` accepts ±1, but ±1 is
 * pure white and pure black — the last third of that slider is a solid colour,
 * which is a slider that lies about how much of it is useful. `Contrast` is
 * the exception and maps one-to-one, because Konva's own scale already *is*
 * -100..100 and its curve `((c+100)/100)^2` is well behaved across it.
 */
const BRIGHTNESS_AT_FULL = 0.55;
const BLUR_PX_AT_FULL = 40;
/** Saturation multipliers at the two ends: effectively grey, and vivid. */
const SATURATION_MIN_MULTIPLIER = 0.02;
const SATURATION_MAX_MULTIPLIER = 3;

export interface KonvaAdjustmentValues {
  brightness: number;
  contrast: number;
  /** Konva's HSL filter raises 2 to this power, so 0 is unchanged. */
  saturation: number;
  blurRadius: number;
}

/**
 * Translate document units into what each Konva filter expects.
 *
 * Saturation is the interesting one. Konva computes `2 ** saturation`, so the
 * stored number is an exponent, and the two halves of the slider are not
 * symmetric in multiplier terms: going grey is a journey from 1x down to
 * (almost) 0x, while going vivid is 1x up to 3x. Mapping the multiplier first
 * and taking the logarithm afterwards keeps the *perceived* travel even, which
 * a straight linear map on the exponent does not — that would make the bottom
 * of the slider do almost nothing and the last few percent do everything.
 */
export function toKonvaValues(a: ImageAdjustments): KonvaAdjustmentValues {
  const multiplier =
    a.saturation < 0
      ? 1 + (a.saturation / 100) * (1 - SATURATION_MIN_MULTIPLIER)
      : 1 + (a.saturation / 100) * (SATURATION_MAX_MULTIPLIER - 1);

  return {
    brightness: (a.brightness / 100) * BRIGHTNESS_AT_FULL,
    contrast: a.contrast,
    saturation: Math.log2(Math.max(SATURATION_MIN_MULTIPLIER, multiplier)),
    blurRadius: (a.blur / 100) * BLUR_PX_AT_FULL,
  };
}

/**
 * Which Konva filters this image actually needs.
 *
 * Only the ones doing work. Every filter in the list is a full pass over every
 * pixel on each re-cache, so an image with only a blur should not also be
 * walked three more times to add zero, multiply by one, and add zero again.
 */
export function activeFilterIds(a: ImageAdjustments): AdjustmentId[] {
  return ADJUSTMENT_IDS.filter((id) => a[id] !== 0);
}
