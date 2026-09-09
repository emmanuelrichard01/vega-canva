/**
 * The lines drawn *inside* a shape.
 *
 * A cylinder's rim, a subroutine's two rules, a rack's bays, a chip's pins, a
 * browser's address bar: none of them is part of the silhouette, and all of
 * them are what makes the silhouette mean something. They are stroked, never
 * filled, and they take the shape's own stroke colour and weight — so a shape
 * and its own detail cannot end up in different inks.
 *
 * ## They are geometry, not strings
 *
 * This file used to build SVG path data directly, which was enough for the two
 * crisp painters and left a third caller with nothing it could use: the
 * **sketcher** needs points to wander along, and it had none. So a sketched
 * cylinder lost its rim, a sketched rack lost its bays and lamps, a chip lost
 * its pins, a browser lost its title bar — twenty kinds went from a recognisable
 * object to an unrecognisable blob the moment a hand was applied to them, and
 * only when sketched.
 *
 * A feature is a contour now, and the string form is derived from it. Crisp
 * painters take `shapeFeaturePaths`, which serialises the real curves; the
 * sketcher takes `shapeFeatureContours` and flattens them. One description,
 * two renderings — the same rule the outlines follow.
 *
 * ## Detail is a function of size, once
 *
 * Every measurement here is a share of the box held between a floor and a
 * ceiling. That is not decoration: the same function draws the shape on the
 * board at 400px and the glyph in the toolbar, and a rack's indicator light
 * that is 2% of the height is invisible at one size and a saucer at the other.
 */

import type { BezierGeometry, ShapeNode } from '../schema';
import { pathData, translatePath } from '../pathGeometry';
import { clamp, ellipseContour, pen } from './pen';
import { roundedBox } from './contours';
import { param } from './params';

/** A full circle. A lamp, a snap, a pin's hole. */
const disc = (cx: number, cy: number, r: number) => ellipseContour(cx, cy, r, r, 'cw');

/** The front half of an ellipse's rim, left to right under the top. */
const rimArc = (cx: number, cy: number, rx: number, ry: number): BezierGeometry =>
  pen().arc(cx, cy, rx, ry, 0, Math.PI).open();

/** A straight run through the given points. */
function rule(...xy: number[]): BezierGeometry {
  const p = pen().moveTo(xy[0], xy[1]);
  for (let i = 2; i + 1 < xy.length; i += 2) p.lineTo(xy[i], xy[i + 1]);
  return p.open();
}

/**
 * A window's title bar: the rule under it, and the three dots on it.
 *
 * Shared by the terminal and the browser, which differ in what sits to the
 * right of the dots and in nothing else. Two copies of this was how one of
 * them ended up with its dots at 7% of the width and the other at 8%.
 */
function titleBar(
  x: number,
  y: number,
  w: number,
  h: number
): { parts: BezierGeometry[]; barH: number; dotsEndX: number } {
  const barH = clamp(h * 0.2, 12, 40);
  const dotR = clamp(h * 0.028, 1.4, 4.5);
  const gap = dotR * 2.9;
  const first = x + clamp(w * 0.07, 8, 26);
  const cy = y + barH / 2;
  const parts: BezierGeometry[] = [rule(x, y + barH, x + w, y + barH)];
  for (let i = 0; i < 3; i++) parts.push(disc(first + i * gap, cy, dotR));
  return { parts, barH, dotsEndX: first + 2 * gap + dotR };
}

/**
 * Everything drawn inside `node`, as contours in the node's own box.
 *
 * Empty for the shapes whose silhouette is the whole story, which is most of
 * them.
 */
export function shapeFeatureContours(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height'>
): BezierGeometry[] {
  const w = node.width;
  const h = node.height;
  const cx = w / 2;
  const cy = h / 2;
  const short = Math.min(w, h);
  const g = node.geometry;

  switch (g.kind) {
    case 'cylinder': {
      const ry = param(g, 'rimRatio') * h;
      return [rimArc(cx, ry, w / 2, ry)];
    }

    /**
     * Three rims rather than one: a drum is a cylinder, a database is a stack.
     *
     * The dock offered a Database tile for as long as it existed and created a
     * plain `cylinder` — so the tile's picture showed a stack and the board
     * drew a drum.
     */
    case 'database': {
      const ry = param(g, 'rimRatio') * h;
      const usable = h - ry * 2;
      const decks = clamp(Math.round(param(g, 'shelfCount')), 2, 5);
      const parts = [rimArc(cx, ry, w / 2, ry)];
      for (let i = 1; i < decks; i++) {
        parts.push(rimArc(cx, ry + (usable * i) / decks, w / 2, ry));
      }
      return parts;
    }

    case 'predefined_process': {
      const inset = clamp(w * 0.12, 6, 28);
      return [rule(inset, 0, inset, h), rule(w - inset, 0, w - inset, h)];
    }

    case 'internal_storage': {
      const top = clamp(h * 0.2, 8, 32);
      const left = clamp(w * 0.16, 8, 40);
      return [rule(0, top, w, top), rule(left, top, left, h)];
    }

    /**
     * A cross, not a plus, and clipped to the circle it sits in.
     *
     * The summing junction carries an X in every notation that has one; the
     * plus belongs to the *or* junction, which is a different symbol. The old
     * one drew a plus, and drew it corner to corner of the box — which on a
     * circle put both ends of both strokes outside the shape.
     */
    case 'summing_junction': {
      const k = Math.SQRT1_2;
      const rx = cx * k;
      const ry = cy * k;
      return [
        rule(cx - rx, cy - ry, cx + rx, cy + ry),
        rule(cx + rx, cy - ry, cx - rx, cy + ry),
      ];
    }

    case 'package':
      // The three faces meet at the bottom vertex of the top rhombus, which is
      // the centre of the box.
      return [
        rule(cx, cy, cx, 0),
        rule(cx, cy, 0, h / 4),
        rule(cx, cy, w, h / 4),
        rule(cx, cy, cx, h),
      ];

    case 'note': {
      // The turned corner, drawn as the two edges of the flap.
      const f = short * 0.28;
      return [rule(w - f, 0, w - f, f, w, f)];
    }

    /**
     * The crease sits outside the notch, not on it.
     *
     * A crease *at* the notch's tip draws a second line through the point the
     * notch already makes, which reads as an hourglass; a crease beyond it
     * separates the tail from the panel, which is what a folded ribbon looks
     * like.
     */
    case 'banner': {
      const fold = param(g, 'indent') * w * 1.7;
      return [rule(fold, 0, fold, h), rule(w - fold, 0, w - fold, h)];
    }

    case 'mail': {
      const r = clamp(short * 0.08, 2, 14);
      return [rule(r, r, cx, h * 0.56, w - r, r)];
    }

    /**
     * One lamp and one label rule per unit, placed against the units the
     * outline actually draws.
     *
     * These were measured against the whole box while the outline was a single
     * rectangle with dividers across it, so the lamps sat on the dividers
     * rather than inside the bays. Both halves read the same bay count and the
     * same gap now, from the same table entry.
     */
    case 'server': {
      const bays = clamp(Math.round(param(g, 'shelfCount')), 2, 6);
      const gap = clamp(h * 0.06, 2, 14);
      const unitH = (h - gap * (bays - 1)) / bays;
      const lampR = clamp(unitH * 0.12, 1.2, 4);
      const inset = clamp(w * 0.09, 6, 30);
      const parts: BezierGeometry[] = [];
      for (let i = 0; i < bays; i++) {
        const midY = i * (unitH + gap) + unitH / 2;
        const lampX = w - inset;
        parts.push(disc(lampX, midY, lampR));
        const ruleRight = lampX - lampR * 3;
        if (ruleRight > inset) parts.push(rule(inset, midY, ruleRight, midY));
      }
      return parts;
    }

    /**
     * The pins are drawn, not carved.
     *
     * They used to be part of the outline: four contacts a side meant over two
     * hundred vertices in the silhouette, a fringe rather than a package, and a
     * fill that leaked into every pin. A chip is drawn everywhere else as a
     * body with pins *attached*, and that is what a stroke is for.
     */
    case 'cpu': {
      const pins = clamp(Math.round(param(g, 'pinCount')), 2, 6);
      const pad = short * 0.16;
      const bodyW = w - pad * 2;
      const bodyH = h - pad * 2;
      const parts: BezierGeometry[] = [
        roundedBox(
          pad + bodyW * 0.24,
          pad + bodyH * 0.24,
          bodyW * 0.52,
          bodyH * 0.52,
          clamp(short * 0.02, 1, 5)
        ),
      ];
      for (let i = 1; i <= pins; i++) {
        const px = pad + (bodyW * i) / (pins + 1);
        parts.push(rule(px, 0, px, pad), rule(px, h, px, h - pad));
        const py = pad + (bodyH * i) / (pins + 1);
        parts.push(rule(0, py, pad, py), rule(w, py, w - pad, py));
      }
      return parts;
    }

    /**
     * One home dot.
     *
     * It drew a pill-shaped island *and* a home bar, which is two competing
     * details in a shape whose whole job is to read as a handset from across a
     * board. One mark, low and centred, is enough to orient the rectangle.
     */
    case 'mobile': {
      const dotR = clamp(short * 0.035, 1.6, 6);
      return [disc(cx, h - clamp(h * 0.07, 6, 30), dotR)];
    }

    /**
     * A prompt and a cursor, and no window furniture.
     *
     * The title bar with three dots belongs to the browser, which is the shape
     * next to it in the same category — two shapes carrying the same chrome
     * differ only by what is inside it, which is the hardest thing to see at
     * glyph size. A terminal is a dark rectangle with a prompt in it.
     */
    case 'terminal': {
      const left = clamp(w * 0.14, 10, 48);
      const chevron = clamp(w * 0.13, 8, 40);
      const arm = clamp(h * 0.16, 6, 34);
      const bar = clamp(w * 0.26, 14, 110);
      return [
        rule(left, cy - arm, left + chevron, cy, left, cy + arm),
        rule(left + chevron * 1.6, cy + arm, left + chevron * 1.6 + bar, cy + arm),
      ];
    }

    case 'browser': {
      const { parts, barH, dotsEndX } = titleBar(0, 0, w, h);
      const addrLeft = dotsEndX + clamp(w * 0.05, 6, 28);
      const addrRight = w - clamp(w * 0.07, 8, 34);
      const addrH = barH * 0.52;
      const addrY = (barH - addrH) / 2;
      if (addrRight > addrLeft + addrH) {
        parts.push(roundedBox(addrLeft, addrY, addrRight - addrLeft, addrH, addrH / 2));
      }
      return parts;
    }

    /**
     * The stand, drawn out to the box the screen does not reach.
     *
     * The same division the chip makes: what you would fill and label is the
     * silhouette, and what is a line in every drawing of the object is a line.
     */
    case 'desktop': {
      const screenH = h * 0.76;
      const neckW = clamp(w * 0.16, 10, 60);
      const baseW = clamp(w * 0.42, 24, 160);
      return [
        rule(cx - neckW / 2, screenH, cx - neckW / 2, h),
        rule(cx + neckW / 2, screenH, cx + neckW / 2, h),
        rule(cx - baseW / 2, h, cx + baseW / 2, h),
      ];
    }

    /** The seam where the folder's leading face meets its back. */
    case 'folder': {
      const tabH = clamp(h * 0.16, 6, 26);
      return [rule(0, tabH * 1.9, w, tabH * 1.9)];
    }

    /** The hole in the head, which is what makes a pin a pin and not a drop. */
    case 'pin':
      return [disc(cx, h * 0.352, short * 0.13)];

    /** The fold that separates the plane's near wing from its far one. */
    case 'plane':
      return [rule(w, 0, w * 0.33, h * 0.6)];

    /**
     * The flap, with the thumb notch cut into it.
     *
     * The notch is the detail that makes a rounded rectangle read as a billfold
     * rather than as a card. It was a straight seam and a dot, which reads as
     * neither.
     */
    /**
     * A billfold: two inner pockets stacked behind the face, and the flap.
     *
     * The reference draws three nested rounded rectangles sharing one bottom
     * edge, so what you see of each inner layer is its **top edge and the
     * shoulders either side of it** — the rest is hidden behind the layer in
     * front. Drawing the whole inner rectangle would put a second and third
     * line along the bottom, exactly on top of the outer edge.
     *
     * So each pocket is that visible part: down the side, round a corner,
     * across, and round the far corner. Rounded to match the case it sits in,
     * because a square inner corner inside a soft outer one is the detail that
     * makes a layered object look assembled rather than folded.
     *
     * One seam and a dot was what stood here, which reads as a card.
     */
    case 'wallet': {
      const r = clamp(short * 0.12, 3, 26);
      const shoulder = clamp(h * 0.07, 3, 22);
      const pocket = (y: number): BezierGeometry =>
        pen()
          .moveTo(0, y + shoulder)
          .lineTo(0, y + r)
          .arc(r, y + r, r, r, Math.PI, (Math.PI * 3) / 2)
          .lineTo(w - r, y)
          .arc(w - r, y + r, r, r, (Math.PI * 3) / 2, Math.PI * 2)
          .lineTo(w, y + shoulder)
          .open();

      const flapY = h * 0.54;
      const notchR = clamp(short * 0.11, 4, 22);
      const notchX = w * 0.64;
      const flap = pen()
        .moveTo(0, flapY)
        .lineTo(notchX - notchR, flapY)
        // The thumb notch: the half-circle scooped out of the flap's edge, and
        // the one detail that says billfold rather than card.
        .arc(notchX, flapY, notchR, notchR, Math.PI, 0)
        .lineTo(w, flapY)
        .open();

      return [pocket(h * 0.17), pocket(h * 0.33), flap];
    }

    /** The lid's grip, and nothing else: the two boxes are the silhouette. */
    case 'archive': {
      const lidH = clamp(h * 0.26, 6, 44);
      const gap = clamp(h * 0.04, 1, 8);
      const gripW = clamp(w * 0.26, 12, 90);
      const gripY = lidH + gap + clamp(h * 0.14, 5, 26);
      return [rule(cx - gripW / 2, gripY, cx + gripW / 2, gripY)];
    }

    /** A pulse across the panel, flat at both ends so it reads as a trace. */
    case 'activity': {
      const left = clamp(w * 0.1, 6, 40);
      const right = w - clamp(w * 0.1, 6, 40);
      const amp = clamp(h * 0.22, 5, 60);
      const span = right - left;
      return [
        rule(
          left, cy,
          left + span * 0.22, cy,
          left + span * 0.36, cy + amp,
          left + span * 0.54, cy - amp,
          left + span * 0.68, cy,
          right, cy
        ),
      ];
    }

    /** A globe's equator and its meridian. */
    case 'globe':
      return [
        rule(0, cy, w, cy),
        // Two half arcs, so the meridian closes on itself rather than reading
        // as a stray line down the middle.
        pen()
          .arc(cx, cy, cx * 0.5, cy, -Math.PI / 2, Math.PI / 2)
          .arc(cx, cy, cx * 0.5, cy, Math.PI / 2, (Math.PI * 3) / 2)
          .close(),
      ];

    /** The hopper's shoulder line, and two lamps low on the body. */
    case 'hopper': {
      const shoulder = h * 0.34;
      const dotR = clamp(short * 0.045, 1.4, 5);
      // Low and to one side, where a drive's lamps sit. Level with the middle
      // of the body they read as a pair of eyes.
      const lampY = h - clamp(h * 0.16, 5, 30);
      const lampX = clamp(w * 0.14, 7, 34);
      return [
        rule(0, shoulder, w, shoulder),
        disc(lampX, lampY, dotR),
        disc(lampX + dotR * 3.4, lampY, dotR),
      ];
    }

    default:
      return [];
  }
}

/**
 * The same lines as SVG path data.
 *
 * `ox`/`oy` offset them into world space for the exporter; the canvas passes
 * zero because it is already drawing inside the node's group.
 */
export function shapeFeaturePaths(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height'>,
  ox = 0,
  oy = 0
): string[] {
  return shapeFeatureContours(node).map((geo) =>
    pathData(ox === 0 && oy === 0 ? geo : translatePath(geo, ox, oy))
  );
}
