import type { FrameNode } from '../model/schema';

/**
 * What a frame carries when it is a slide.
 *
 * Flat fields on the frame rather than one nested `slide` object, so two
 * people can edit one slide's notes and another slide's transition at the same
 * moment and both edits survive: the CRDT merges per key, and a nested object
 * is one key that the second writer would overwrite whole.
 *
 * - `notes`: speaker notes, plain text with line breaks.
 * - `slideHidden`: skipped when presenting and exporting, kept in the deck.
 * - `slideSection`: the name of a section that starts at this slide.
 * - `transition`: how the show arrives at this slide. Absent is a glide: the
 *   camera flies across the board, which is the one transition only a canvas
 *   can do. `transitionDir`, `transitionMs` and `transitionEase` tune it.
 */
export interface SlideFields {
  notes?: string;
  slideHidden?: boolean;
  slideSection?: string;
  transition?: SlideTransition;
  /** Which way a push or slide travels. Absent is `left`: the deck moves forward. */
  transitionDir?: TransitionDirection;
  /** Milliseconds. Absent is the transition's own length. */
  transitionMs?: number;
  /** Absent is `standard`. */
  transitionEase?: TransitionEase;
}

export type SlideTransition = 'none' | 'dissolve' | 'smart' | 'push' | 'slide' | 'zoom';
export type TransitionKind = SlideTransition | 'glide';
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';
export type TransitionEase = 'gentle' | 'standard' | 'snappy';

/** The transition picker's vocabulary, in the order it is offered. */
export const TRANSITIONS: ReadonlyArray<{ id: TransitionKind; label: string; hint: string }> = [
  { id: 'glide', label: 'Glide', hint: 'The camera flies across the board to the slide.' },
  { id: 'none', label: 'None', hint: 'Cut straight to the slide.' },
  { id: 'dissolve', label: 'Dissolve', hint: 'Fade from one slide into the next.' },
  {
    id: 'smart',
    label: 'Smart move',
    hint: 'Objects on both slides move, resize, turn and recolour into place. Match them by layer name, or duplicate the slide.',
  },
  { id: 'push', label: 'Push', hint: 'The new slide pushes the old one off the screen.' },
  { id: 'slide', label: 'Slide', hint: 'The new slide slides in over the old one.' },
  {
    id: 'zoom',
    label: 'Zoom',
    hint: 'The camera dives into the object on the previous slide that shares this slide’s name, or its middle, and comes out on this one.',
  },
];

export const TRANSITION_DIRECTIONS: readonly TransitionDirection[] = ['left', 'right', 'up', 'down'];
export const TRANSITION_EASES: ReadonlyArray<{ id: TransitionEase; label: string }> = [
  { id: 'gentle', label: 'Gentle' },
  { id: 'standard', label: 'Standard' },
  { id: 'snappy', label: 'Snappy' },
];

/** Each transition's own length, when the slide does not set one. */
export const DEFAULT_TRANSITION_MS: Record<TransitionKind, number> = {
  glide: 620,
  none: 0,
  dissolve: 360,
  smart: 480,
  push: 520,
  slide: 520,
  zoom: 900,
};

/** The range a slide's transition length is held to. */
export const MIN_TRANSITION_MS = 150;
export const MAX_TRANSITION_MS = 2000;

/** Long enough for a talk's worth of prompts, short enough to stay a note. */
export const MAX_NOTES = 5000;
/** A section is a label in a list, not a heading on a slide. */
export const MAX_SECTION = 60;

const TRANSITION_IDS = new Set<string>(['none', 'dissolve', 'smart', 'push', 'slide', 'zoom']);
const DIRECTIONS = new Set<string>(TRANSITION_DIRECTIONS);
const EASES = new Set<string>(['gentle', 'standard', 'snappy']);

/**
 * Speaker notes as plain text: line breaks and tabs kept, every other control
 * character dropped, Windows line endings folded, at most `MAX_NOTES`
 * characters, trailing space trimmed. Undefined when nothing is left.
 */
export function normalizeNotes(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = Array.from(raw.replace(/\r\n?/g, '\n'), (c) => {
    const code = c.charCodeAt(0);
    if (c === '\n' || c === '\t') return c;
    return code < 32 || code === 127 ? '' : c;
  })
    .join('')
    .slice(0, MAX_NOTES)
    .replace(/\s+$/, '');
  return clean.trim() ? clean : undefined;
}

/** A section label: one line, at most `MAX_SECTION` characters. Undefined when empty. */
export function normalizeSection(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = Array.from(raw, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SECTION);
  return clean || undefined;
}

/**
 * The slide fields of a stored frame, ready to spread into the normalized
 * node. Absent fields stay absent, so a frame that was never a slide stores
 * nothing extra.
 */
export function normalizeSlideFields(raw: Record<string, unknown> | null | undefined): SlideFields {
  const out: SlideFields = {};
  const notes = normalizeNotes(raw?.notes);
  if (notes) out.notes = notes;
  if (raw?.slideHidden === true) out.slideHidden = true;
  const section = normalizeSection(raw?.slideSection);
  if (section) out.slideSection = section;
  if (typeof raw?.transition === 'string' && TRANSITION_IDS.has(raw.transition)) {
    out.transition = raw.transition as SlideTransition;
  }
  if (typeof raw?.transitionDir === 'string' && DIRECTIONS.has(raw.transitionDir)) out.transitionDir = raw.transitionDir as TransitionDirection;
  if (typeof raw?.transitionMs === 'number' && Number.isFinite(raw.transitionMs)) {
    out.transitionMs = Math.round(Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, raw.transitionMs)));
  }
  if (typeof raw?.transitionEase === 'string' && EASES.has(raw.transitionEase)) out.transitionEase = raw.transitionEase as TransitionEase;
  return out;
}

/** A frame's slide fields, read through the normalizer so a stale shape cannot leak through. */
export function slideFields(frame: FrameNode | null | undefined): SlideFields {
  return normalizeSlideFields(frame as unknown as Record<string, unknown>);
}

/** The transition a slide is arrived at with; `glide` when none is set. */
export function transitionOf(frame: FrameNode | null | undefined): TransitionKind {
  return slideFields(frame).transition ?? 'glide';
}

export interface TransitionSpec {
  kind: TransitionKind;
  direction: TransitionDirection;
  ms: number;
  ease: TransitionEase;
}

/** Everything about how the show arrives at a slide, with the defaults filled in. */
export function transitionSpecOf(frame: FrameNode | null | undefined): TransitionSpec {
  const f = slideFields(frame);
  const kind = f.transition ?? 'glide';
  return { kind, direction: f.transitionDir ?? 'left', ms: f.transitionMs ?? DEFAULT_TRANSITION_MS[kind], ease: f.transitionEase ?? 'standard' };
}
