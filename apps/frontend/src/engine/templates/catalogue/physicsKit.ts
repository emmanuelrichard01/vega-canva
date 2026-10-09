import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { StickyTheme } from '../../model/schema';
import type { MaterialId } from '../../../utils/behaviorSystem';
import { FORCE_SPECS, type FalloffId, type ForceId } from '../../physics/forces';
import { HUE, INK, INK_FAINT, INK_SOFT, INK_STRONG, TINT, paragraph, strokeOf, textHeight, type Tint } from '../templateKit';

/**
 * The physics boards' own vocabulary.
 *
 * ## Where things may go on a physics board
 *
 * Three facts about the simulation decide every layout here:
 *
 * - **Frames are not simulated, and neither is what they own.** An object
 *   whose centre is inside a frame is fixed furniture (it still blocks, it is
 *   never set moving) unless the person turns on "Include objects inside
 *   frames". So the words live in frames, and everything meant to move lives
 *   on the open board beside them.
 * - **Everything else is a body.** A loose caption next to an arena would be
 *   pulled into it by the first field. Arenas therefore carry no free text:
 *   a label in an arena is written on a locked plate, which reads on both
 *   themes because it carries its own fill.
 * - **Overlapping bodies explode apart.** No backdrop shape sits behind an
 *   arena; its walls are its outline.
 */

/** Furniture: walls, pegs and posts. Mid slate, so it reads on the light and the dark board. */
export const FURNITURE = '#64748B';
const FURNITURE_EDGE = '#475569';

/** The force names as the Forces bar prints them, so instructions cannot drift from the UI. */
export const force = (id: ForceId): string => FORCE_SPECS[id].label;

/** A rectangle that is collided against and never moves. */
export function wall(x: number, y: number, w: number, h: number, rotation = 0): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: w,
    height: h,
    ...(rotation ? { rotation } : null),
    geometry: { kind: 'rect' },
    material: 'stone',
    locked: true,
    appearance: { fill: [{ type: 'solid', color: FURNITURE }], stroke: { color: FURNITURE_EDGE, width: 1 }, cornerRadius: 0 },
  } as NewNodeInput;
}

/** A wall from one point to another, `t` thick. */
export function strut(x0: number, y0: number, x1: number, y1: number, t = 24): NewNodeInput {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const deg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  return wall((x0 + x1) / 2 - len / 2, (y0 + y1) / 2 - t / 2, len, t, deg);
}

/** A four-sided tray: inside size `w`×`h`, walls `t` thick outside it. */
export function tray(x: number, y: number, w: number, h: number, t = 24): NewNodeInput[] {
  return [wall(x - t, y - t, w + t * 2, t), wall(x - t, y + h, w + t * 2, t), wall(x - t, y, t, h), wall(x + w, y, t, h)];
}

/** A round fixed peg. */
export function peg(cx: number, cy: number, d: number): NewNodeInput {
  return { ...wall(cx - d / 2, cy - d / 2, d, d), geometry: { kind: 'ellipse' } } as NewNodeInput;
}

/** A loose round body of a chosen material. */
export function ball(cx: number, cy: number, d: number, material: MaterialId, color: string, text = '', ink = INK): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x: cx - d / 2,
    y: cy - d / 2,
    width: d,
    height: d,
    geometry: { kind: 'ellipse' },
    material,
    text,
    appearance: { fill: [{ type: 'solid', color }], stroke: { color: strokeOf(color), width: 1.5 } },
    typography: { fontSize: 13, fontWeight: 650, color: ink, align: 'center', verticalAlign: 'middle' },
  } as NewNodeInput;
}

/** A loose block of a chosen material. */
export function block(x: number, y: number, w: number, h: number, material: MaterialId, color: string, rotation = 0): NewNodeInput {
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: w,
    height: h,
    ...(rotation ? { rotation } : null),
    geometry: { kind: 'rect' },
    material,
    appearance: { fill: [{ type: 'solid', color }], stroke: { color: strokeOf(color), width: 1 }, cornerRadius: 0 },
  } as NewNodeInput;
}

/** A locked plate with a label on it: how an arena says something without a loose caption. */
export function plate(x: number, y: number, w: number, h: number, text: string, tint: Tint = 'slate', size = 14): NewNodeInput {
  return {
    ...wall(x, y, w, h),
    text,
    appearance: { fill: [{ type: 'solid', color: TINT[tint] }], stroke: { color: FURNITURE, width: 1.5 }, cornerRadius: 0 },
    typography: { fontSize: size, fontWeight: 650, color: INK, align: 'center', verticalAlign: 'middle' },
  } as NewNodeInput;
}

/** A sticky note on the open board, optionally pinned so the simulation treats it as fixed. */
export function note(x: number, y: number, text: string, theme: StickyTheme, pinned = false, size = 160): NewNodeInput {
  return {
    id: nanoid(),
    type: 'sticky',
    x,
    y,
    width: size,
    height: size,
    text,
    theme,
    fontSize: 18,
    reactions: {},
    tags: [],
    pinned,
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// The guide: a white page of words beside the arena
// ---------------------------------------------------------------------------

export type GuideBlock =
  | { kind: 'title'; text: string }
  | { kind: 'lede'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'step'; text: string; keys?: string[] }
  | { kind: 'fact'; label: string; text: string; tint: Tint };

const PAD = 40;
const GAP = 16;

/** A keycap, drawn as a small plate so the shortcut reads as keys rather than as prose. */
function keycap(x: number, y: number, label: string): { node: NewNodeInput; width: number } {
  const width = Math.max(40, Math.ceil(label.length * 9 + 24));
  return {
    width,
    node: {
      id: nanoid(),
      type: 'shape',
      x,
      y,
      width,
      height: 34,
      geometry: { kind: 'rect' },
      text: label,
      appearance: { fill: [{ type: 'solid', color: TINT.slate }], stroke: { color: INK_FAINT, width: 1.5 }, cornerRadius: 0 },
      typography: { fontSize: 13, fontWeight: 650, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
    } as NewNodeInput,
  };
}

/**
 * A guide page: a frame with an emoji and a line, holding a stack of blocks.
 * The frame is sized to what it holds, so nothing hangs past its edge.
 */
export function guide(
  x: number,
  y: number,
  w: number,
  frame: { title: string; icon: string; description: string },
  blocks: GuideBlock[],
  minHeight = 0
): NewNodeInput[] {
  const inner = w - PAD * 2;
  const out: NewNodeInput[] = [];
  let cy = y + PAD;
  let step = 0;
  for (const b of blocks) {
    if (b.kind === 'title') {
      out.push(paragraph(x + PAD, cy, b.text, inner, 36, INK_STRONG, 700, 1.2));
      cy += Math.ceil(textHeight(b.text, inner, 36, 700, 1.2)) + 12;
    } else if (b.kind === 'lede') {
      out.push(paragraph(x + PAD, cy, b.text, inner, 17, INK_SOFT, 450, 1.5));
      cy += Math.ceil(textHeight(b.text, inner, 17, 450, 1.5)) + GAP * 1.5;
    } else if (b.kind === 'heading') {
      cy += 8;
      out.push(paragraph(x + PAD, cy, b.text, inner, 19, INK_STRONG, 650, 1.3));
      cy += Math.ceil(textHeight(b.text, inner, 19, 650, 1.3)) + 10;
    } else if (b.kind === 'text') {
      out.push(paragraph(x + PAD, cy, b.text, inner, 15, INK_SOFT, 450, 1.5));
      cy += Math.ceil(textHeight(b.text, inner, 15, 450, 1.5)) + GAP;
    } else if (b.kind === 'step') {
      step += 1;
      out.push({
        id: nanoid(),
        type: 'shape',
        x: x + PAD,
        y: cy,
        width: 30,
        height: 30,
        geometry: { kind: 'ellipse' },
        text: String(step),
        appearance: { fill: [{ type: 'solid', color: TINT.amber }], stroke: { color: HUE.amber, width: 1.5 } },
        typography: { fontSize: 14, fontWeight: 700, color: INK_STRONG, align: 'center', verticalAlign: 'middle' },
      } as NewNodeInput);
      const tx = x + PAD + 44;
      const tw = inner - 44;
      out.push(paragraph(tx, cy + 3, b.text, tw, 15, INK, 500, 1.5));
      cy += Math.max(30, Math.ceil(textHeight(b.text, tw, 15, 500, 1.5)) + 3) + 10;
      if (b.keys?.length) {
        let kx = tx;
        for (const k of b.keys) {
          const cap = keycap(kx, cy, k);
          out.push(cap.node);
          kx += cap.width + 8;
        }
        cy += 34 + 10;
      }
      cy += 6;
    } else {
      const tw = inner - 32;
      const h = Math.ceil(textHeight(b.text, tw, 14, 450, 1.5)) + 20 + 26;
      out.push({
        id: nanoid(),
        type: 'shape',
        x: x + PAD,
        y: cy,
        width: inner,
        height: h,
        geometry: { kind: 'rect' },
        appearance: { fill: [{ type: 'solid', color: TINT[b.tint] }], stroke: { color: strokeOf(b.tint), width: 1.5 }, cornerRadius: 0 },
      } as NewNodeInput);
      out.push(paragraph(x + PAD + 16, cy + 12, b.label, tw, 14, INK_STRONG, 700, 1.3));
      out.push(paragraph(x + PAD + 16, cy + 34, b.text, tw, 14, INK, 450, 1.5));
      cy += h + 12;
    }
  }
  const height = Math.max(minHeight, Math.ceil(cy - y + PAD - GAP));
  return [
    { id: nanoid(), type: 'frame', x, y, width: w, height, title: frame.title, icon: frame.icon, description: frame.description } as NewNodeInput,
    ...out,
  ];
}

// ---------------------------------------------------------------------------
// Primers: the force setup each board is built for
// ---------------------------------------------------------------------------

/**
 * How the Forces bar should be set for a board to play as designed.
 *
 * The boards spell these out in their guide; this is the same advice as data,
 * so the room can prime the bar when a board is opened from the gallery.
 */
export interface PhysicsPrimer {
  force: ForceId;
  /** Latch the field for this many seconds; absent means hold to apply. */
  latchSeconds?: 3 | 6 | 10;
  radiusScale?: number;
  falloff?: FalloffId;
  /** Gravity's direction in degrees, 90 being down. */
  gravityAngle?: number;
}
