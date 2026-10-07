/**
 * Where a shape's label is laid out, in the node's own box.
 *
 * A label laid across the whole box runs into everything that is not the
 * shape's interior: a cylinder's rim, a document's torn edge, a speech
 * bubble's tail, the rails of a subroutine, the corners of a diamond. Each
 * kind here answers "where does text sit inside this", the way a diagramming
 * tool lays a label out against the symbol rather than against its bounds.
 *
 * Kinds whose interior is the whole box (rectangles, notes, panels) are not
 * listed and keep the full box, so their labels lay out exactly as before.
 *
 * Every box is held inside the shape's silhouette; `labelBox.test.ts` samples
 * each one against the outline.
 */

import type { ShapeNode } from '../schema';
import { clamp } from './pen';
import { param } from './params';
import { chatBodyHeight, lockBodyTop, multiDocumentStep, sequentialReelRadius } from './contours';

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Kinds whose interior detail runs through where the label goes. Their label
 * box is a compact band, and the renderer backs it with a plate of the
 * shape's own fill so the detail breaks around the words.
 */
const PLATED: ReadonlySet<string> = new Set(['server', 'globe', 'database', 'package', 'summing_junction', 'or_junction']);

export function labelPlated(kind: string): boolean {
  return PLATED.has(kind);
}

/** Half of √2: the share of an ellipse's axes its largest inscribed rectangle takes. */
const INSCRIBED = Math.SQRT1_2;

export function shapeLabelBox(node: Pick<ShapeNode, 'geometry' | 'width' | 'height'>): LabelBox {
  const w = Math.max(0, node.width);
  const h = Math.max(0, node.height);
  const g = node.geometry;
  const short = Math.min(w, h);

  const rect = (x: number, y: number, rw: number, rh: number): LabelBox => ({
    x,
    y,
    width: Math.max(0, rw),
    height: Math.max(0, rh),
  });
  /** A centred box at a share of the width and height. */
  const centred = (sx: number, sy: number, dy = 0): LabelBox =>
    rect((w * (1 - sx)) / 2, (h * (1 - sy)) / 2 + dy, w * sx, h * sy);

  switch (g.kind) {
    // -- Round -------------------------------------------------------------
    case 'ellipse':
      return centred(INSCRIBED, INSCRIBED);
    case 'globe':
      return rect(w * 0.15, h * 0.38, w * 0.7, h * 0.24);
    case 'summing_junction':
    case 'or_junction':
      return centred(0.6, 0.26);
    case 'sequential_access': {
      const rx = sequentialReelRadius(w, h);
      return rect(rx * (1 - INSCRIBED), (h * (1 - INSCRIBED)) / 2, rx * 2 * INSCRIBED, h * INSCRIBED);
    }
    case 'capsule': {
      const r = Math.min(w, h) / 2;
      // The corners of the box sit at 45° on each end cap, where the cap is
      // still a full line-height clear of the edge.
      return rect(r * 0.3, r * 0.3, w - r * 0.6, h - r * 0.6);
    }
    case 'donut':
      // The ring itself is too thin to hold a line of text; the label sits
      // over the hole, which is where a reader looks.
      return centred(INSCRIBED * param(g, 'innerRatio'), INSCRIBED * param(g, 'innerRatio'));

    // -- Angled ------------------------------------------------------------
    case 'diamond':
      return centred(0.5, 0.5);
    // Above the divider, where the diamond is still wide enough for a line.
    case 'sort':
      return rect(w * 0.2, h * 0.3, w * 0.6, h * 0.18);
    case 'polygon':
      if ((g.points ?? 3) === 3) return rect(w * 0.25, h * 0.45, w * 0.5, h * 0.5);
      return centred(0.72, 0.72);
    case 'merge':
      return rect(w * 0.25, h * 0.05, w * 0.5, h * 0.5);
    case 'collate':
      return rect(w * 0.25, h * 0.02, w * 0.5, h * 0.22);
    case 'right_triangle':
      return rect(w * 0.06, h * 0.5, w * 0.45, h * 0.46);
    // The slanted sides close in toward one edge, so the widest box that fits
    // runs between a fifth and four fifths of the height.
    case 'parallelogram': {
      const d = Math.abs(param(g, 'skew')) * w;
      return rect(d * 0.8, h * 0.2, w - d * 1.6, h * 0.6);
    }
    case 'trapezoid': {
      const d = Math.abs(param(g, 'inset')) * w;
      return rect(d * 0.8, h * 0.2, w - d * 1.6, h * 0.6);
    }
    case 'preparation':
    case 'chevron':
    case 'banner': {
      const d = param(g, 'indent') * w;
      return rect(d, 0, w - d * 2, h);
    }
    case 'display': {
      const d = param(g, 'indent') * w;
      return rect(d, 0, w - d * 2, h);
    }
    case 'arrow_block': {
      const head = param(g, 'indent') * w;
      return rect(0, h * 0.27, w - head * 0.5, h * 0.46);
    }
    case 'manual_input': {
      const rise = param(g, 'indent') * h;
      return rect(0, rise, w, h - rise);
    }
    case 'off_page':
      return rect(0, 0, w, h * (1 - param(g, 'indent')));
    case 'cross': {
      const arm = param(g, 'armRatio') * short;
      return rect(0, (h - arm) / 2, w, arm);
    }
    case 'star':
      return centred(0.36, 0.36, h * 0.06);
    case 'badge':
      return centred(0.54, 0.54);

    // -- Containers with furniture ------------------------------------------
    case 'cylinder': {
      const ry = param(g, 'rimRatio') * h;
      return rect(0, ry * 2, w, h - ry * 3);
    }
    case 'database': {
      // A band across the middle of the stack; the decks break around it.
      const ry = param(g, 'rimRatio') * h;
      const mid = (h + ry) / 2;
      const band = Math.min(h * 0.24, (h - ry * 3) * 0.6);
      return rect(w * 0.06, mid - band / 2, w * 0.88, band);
    }
    case 'server': {
      // The middle bay holds the label; its rule breaks around the words.
      const bays = clamp(Math.round(param(g, 'shelfCount')), 2, 6);
      const gap = clamp(h * 0.06, 2, 14);
      const unitH = (h - gap * (bays - 1)) / bays;
      const bay = Math.floor((bays - 1) / 2);
      const inset = clamp(w * 0.09, 6, 30);
      const lampR = clamp(unitH * 0.12, 1.2, 4);
      const right = w - inset - lampR * 3;
      // Past the rule's end by a lamp radius, so the plate's rounded corner
      // does not leave a sliver of the rule showing.
      return rect(inset * 0.6, bay * (unitH + gap) + unitH * 0.12, right + lampR - inset * 0.6, unitH * 0.76);
    }
    case 'direct_access_storage': {
      const rx = param(g, 'rimRatio') * w;
      return rect(rx, 0, w - rx * 3, h);
    }
    case 'stored_data': {
      const r = param(g, 'indent') * w;
      return rect(r * 0.6, 0, w - r * 1.6, h);
    }
    case 'document': {
      const a = param(g, 'waveHeight') * h;
      return rect(0, 0, w, h - a * 2);
    }
    case 'multi_document': {
      const d = multiDocumentStep(w, h);
      const a = param(g, 'waveHeight') * (h - 2 * d);
      return rect(0, d * 2, w - d * 2, h - d * 2 - a * 2);
    }
    case 'punched_tape': {
      const a = param(g, 'waveHeight') * h;
      return rect(0, a * 2, w, h - a * 4);
    }
    case 'predefined_process': {
      const inset = clamp(w * 0.12, 6, 28);
      return rect(inset, 0, w - inset * 2, h);
    }
    case 'internal_storage': {
      const top = clamp(h * 0.2, 8, 32);
      const left = clamp(w * 0.16, 8, 40);
      return rect(left, top, w - left, h - top);
    }
    case 'card': {
      const c = param(g, 'indent') * short;
      return rect(c * 0.6, c * 0.6, w - c * 0.6, h - c * 0.6);
    }
    case 'loop_limit': {
      const c = param(g, 'indent') * short;
      return rect(c * 0.6, c * 0.6, w - c * 1.2, h - c * 0.6);
    }
    case 'folder': {
      const tabH = clamp(h * 0.16, 6, 26);
      return rect(0, tabH * 1.9, w, h - tabH * 1.9);
    }
    case 'archive': {
      const lidH = clamp(h * 0.26, 6, 44);
      return rect(w * 0.06, lidH * 1.2, w * 0.88, h - lidH * 1.2);
    }
    case 'hopper':
      return rect(w * 0.08, h * 0.36, w * 0.84, h * 0.6);
    case 'delay':
    case 'and_gate': {
      // The same cap `dContour` draws: the box reaches into it as far as the
      // curve allows at an eighth of the height from each edge.
      const rx = Math.min(w, h / 2 + w / 2) / 2;
      return rect(0, h * 0.12, w - rx + rx * 0.6, h * 0.76);
    }
    case 'or_gate':
      return rect(w * 0.24, h * 0.28, w * 0.46, h * 0.44);

    // -- Devices -----------------------------------------------------------
    case 'browser': {
      const barH = clamp(h * 0.2, 12, 40);
      return rect(0, barH, w, h - barH);
    }
    case 'desktop':
      return rect(w * 0.04, 0, w * 0.92, h * 0.76);
    case 'mobile':
      return rect(w * 0.08, h * 0.08, w * 0.84, h * 0.76);
    case 'cpu': {
      const pad = short * 0.16;
      return rect(pad, pad, w - pad * 2, h - pad * 2);
    }

    // -- Glyph-shapes --------------------------------------------------------
    case 'callout':
      return centred(0.86, 0.66, -h * 0.08);
    case 'chat': {
      const bh = chatBodyHeight(h);
      const r = Math.min(bh, w) * 0.22;
      return rect(r * 0.3, r * 0.3, w - r * 0.6, bh - r * 0.6);
    }
    case 'cloud':
      return centred(0.46, 0.34, h * 0.12);
    case 'heart':
      return centred(0.56, 0.42, -h * 0.04);
    case 'shield':
      return centred(0.72, 0.52, -h * 0.06);
    case 'pin':
      return centred(0.5, 0.3, -h * 0.15);
    case 'lock': {
      // Below the keyhole, which stays visible: it is what makes this a lock.
      const top = lockBodyTop(h);
      const body = h - top;
      return rect(w * 0.06, top + body * 0.66, w * 0.88, body * 0.3);
    }
    case 'user':
      return rect(w * 0.1, h * 0.66, w * 0.8, h * 0.34);
    case 'mail':
      return rect(0, h * 0.5, w, h * 0.5);
    case 'package':
      return rect(w * 0.18, h * 0.5, w * 0.64, h * 0.24);
    case 'gear':
      return centred(0.5, 0.5);
    case 'key':
    case 'bolt':
    case 'plane':
      // Too slight to hold a line inside; the label centres on the glyph and
      // is free to run past its edges, which is how these read on a diagram.
      return rect(0, 0, w, h);

    default:
      return rect(0, 0, w, h);
  }
}
