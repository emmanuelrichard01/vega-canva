/**
 * The lines drawn *inside* a shape.
 *
 * A cylinder's rim, a subroutine's two rules, a rack's bays, a chip's pins, a
 * browser's address bar: none of them is part of the silhouette, and all of
 * them are what makes the silhouette mean something. They are stroked, never
 * filled, and they take the shape's own stroke colour and weight — so a shape
 * and its own detail cannot end up in different inks.
 *
 * ## Detail is a function of size, once
 *
 * Every measurement here is a share of the box held between a floor and a
 * ceiling. That is not decoration: the same function draws the shape on the
 * board at 400px and the glyph in the toolbar at 20px, and a rack's indicator
 * light that is 2% of the height is invisible at one size and a saucer at the
 * other. Pinning both ends is what lets one description serve both, which is
 * what keeps the toolbar honest about what the board will draw.
 *
 * The strings are SVG path data because both painters take that: Konva's
 * `Path` on the canvas, and the exporter's `<path>` in the file. `ox`/`oy`
 * offset them into world space for the exporter; the canvas passes zero
 * because it is already drawing inside the node's group.
 */

import type { ShapeNode } from '../schema';
import { clamp } from './pen';
import { param } from './params';

/** A rounded-rectangle path, used by several details that are small panels. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M ${x + rr} ${y} L ${x + w - rr} ${y} A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr} ` +
    `L ${x + w} ${y + h - rr} A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h} ` +
    `L ${x + rr} ${y + h} A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr} ` +
    `L ${x} ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`
  );
}

/** A full circle as two half arcs — the form that survives being stroked or filled. */
function disc(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

/** The front half of an ellipse's rim, left to right under the top. */
function rimArc(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`;
}

/**
 * A window's title bar: the rule under it, and the three dots on it.
 *
 * Shared by the terminal and the browser, which differ in what sits to the
 * right of the dots and in nothing else. Two copies of this was how one of
 * them ended up with its dots at 7% of the width and the other at 8%.
 */
function titleBar(x: number, y: number, w: number, h: number): { paths: string[]; barH: number; dotsEndX: number } {
  const barH = clamp(h * 0.2, 12, 40);
  const dotR = clamp(h * 0.028, 1.4, 4.5);
  const gap = dotR * 2.9;
  const first = x + clamp(w * 0.07, 8, 26);
  const cy = y + barH / 2;
  const paths = [`M ${x} ${y + barH} L ${x + w} ${y + barH}`];
  for (let i = 0; i < 3; i++) paths.push(disc(first + i * gap, cy, dotR));
  return { paths, barH, dotsEndX: first + 2 * gap + dotR };
}

/**
 * Everything drawn inside `node`, in path data.
 *
 * Empty for the shapes whose silhouette is the whole story, which is most of
 * them.
 */
export function shapeFeaturePaths(
  node: Pick<ShapeNode, 'geometry' | 'width' | 'height'>,
  ox = 0,
  oy = 0
): string[] {
  const w = node.width;
  const h = node.height;
  const x = ox;
  const y = oy;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const short = Math.min(w, h);
  const g = node.geometry;

  switch (g.kind) {
    case 'cylinder': {
      const ry = param(g, 'rimRatio') * h;
      return [rimArc(cx, y + ry, w / 2, ry)];
    }

    /**
     * Three rims rather than one: a drum is a cylinder, a database is a stack.
     *
     * The dock has offered a Database tile for as long as it has existed, and
     * it created a plain `cylinder` — so the tile's picture showed a stack and
     * the board drew a drum. A preset whose name and picture promise a shape
     * the document cannot hold is the same defect as a dead field, and the
     * honest fix is the shape, not the picture.
     */
    case 'database': {
      const ry = param(g, 'rimRatio') * h;
      const usable = h - ry * 2;
      const decks = clamp(Math.round(param(g, 'shelfCount')), 2, 5);
      const paths = [rimArc(cx, y + ry, w / 2, ry)];
      for (let i = 1; i < decks; i++) {
        paths.push(rimArc(cx, y + ry + (usable * i) / decks, w / 2, ry));
      }
      return paths;
    }

    case 'predefined_process': {
      const inset = clamp(w * 0.12, 6, 28);
      return [
        `M ${x + inset} ${y} L ${x + inset} ${y + h}`,
        `M ${x + w - inset} ${y} L ${x + w - inset} ${y + h}`,
      ];
    }

    case 'internal_storage': {
      const top = clamp(h * 0.2, 8, 32);
      const left = clamp(w * 0.16, 8, 40);
      return [
        `M ${x} ${y + top} L ${x + w} ${y + top}`,
        `M ${x + left} ${y + top} L ${x + left} ${y + h}`,
      ];
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
      const rx = (w / 2) * k;
      const ry = (h / 2) * k;
      return [
        `M ${cx - rx} ${cy - ry} L ${cx + rx} ${cy + ry}`,
        `M ${cx + rx} ${cy - ry} L ${cx - rx} ${cy + ry}`,
      ];
    }

    case 'package': {
      // The three faces meet at the bottom vertex of the top rhombus, which is
      // the centre of the box.
      return [
        `M ${cx} ${cy} L ${cx} ${y} M ${cx} ${cy} L ${x} ${y + h / 4} ` +
          `M ${cx} ${cy} L ${x + w} ${y + h / 4} M ${cx} ${cy} L ${cx} ${y + h}`,
      ];
    }

    case 'note': {
      // The turned corner, drawn as the two edges of the flap.
      const f = short * 0.28;
      return [`M ${x + w - f} ${y} L ${x + w - f} ${y + f} L ${x + w} ${y + f}`];
    }

    /**
     * The crease sits exactly where the tail begins, which is the depth of the
     * notch.
     *
     * It was a tenth of the width, independent of the notch it was meant to be
     * describing — so at the default swallowtail the two landed a few units
     * apart and the ribbon read as an hourglass with a bar across each end.
     * A fold is a line at the place the paper turns; deriving it from anything
     * but that place is how it stops being one.
     */
    case 'banner': {
      // Outside the notch, not on it. A crease *at* the notch's tip draws a
      // second line through the point the notch already makes, which reads as
      // an hourglass; a crease beyond it separates the tail from the panel,
      // which is what a folded ribbon looks like.
      const fold = param(g, 'indent') * w * 1.7;
      return [
        `M ${x + fold} ${y} L ${x + fold} ${y + h}`,
        `M ${x + w - fold} ${y} L ${x + w - fold} ${y + h}`,
      ];
    }

    case 'mail': {
      const r = clamp(short * 0.08, 2, 14);
      return [`M ${x + r} ${y + r} L ${cx} ${y + h * 0.56} L ${x + w - r} ${y + r}`];
    }

    /**
     * One lamp and one label rule per unit, placed against the units the
     * outline actually draws.
     *
     * These used to be measured against the whole box while the outline was a
     * single rectangle with dividers across it — so the lamps sat on the
     * dividers rather than inside the bays. Both halves read the same bay
     * count and the same gap now, from the same table entry.
     */
    case 'server': {
      const bays = clamp(Math.round(param(g, 'shelfCount')), 2, 6);
      const gap = clamp(h * 0.06, 2, 14);
      const unitH = (h - gap * (bays - 1)) / bays;
      const lampR = clamp(unitH * 0.12, 1.2, 4);
      const inset = clamp(w * 0.09, 6, 30);
      const paths: string[] = [];
      for (let i = 0; i < bays; i++) {
        const midY = y + i * (unitH + gap) + unitH / 2;
        const lampX = x + w - inset;
        paths.push(disc(lampX, midY, lampR));
        const ruleRight = lampX - lampR * 3;
        if (ruleRight > x + inset) paths.push(`M ${x + inset} ${midY} L ${ruleRight} ${midY}`);
      }
      return paths;
    }

    /**
     * The pins are drawn, not carved.
     *
     * They used to be part of the outline: four contacts a side meant over two
     * hundred vertices in the silhouette, a fringe rather than a package, and
     * a fill that leaked into every pin. A chip is drawn everywhere else as a
     * body with pins *attached*, and that is what a stroke is for.
     */
    case 'cpu': {
      const pins = clamp(Math.round(param(g, 'pinCount')), 2, 6);
      const pad = short * 0.16;
      const bodyX = x + pad;
      const bodyY = y + pad;
      const bodyW = w - pad * 2;
      const bodyH = h - pad * 2;
      const paths = [roundedRect(bodyX + bodyW * 0.24, bodyY + bodyH * 0.24, bodyW * 0.52, bodyH * 0.52, clamp(short * 0.02, 1, 5))];
      for (let i = 1; i <= pins; i++) {
        const px = bodyX + (bodyW * i) / (pins + 1);
        paths.push(`M ${px} ${y} L ${px} ${bodyY}`);
        paths.push(`M ${px} ${y + h} L ${px} ${bodyY + bodyH}`);
        const py = bodyY + (bodyH * i) / (pins + 1);
        paths.push(`M ${x} ${py} L ${bodyX} ${py}`);
        paths.push(`M ${x + w} ${py} L ${bodyX + bodyW} ${py}`);
      }
      return paths;
    }

    /**
     * One home dot.
     *
     * It drew a pill-shaped island *and* a home bar, which is two competing
     * details in a shape whose whole job is to read as a handset from across a
     * board. The reference draws one mark, low and centred, and that is enough
     * to orient the rectangle.
     */
    case 'mobile': {
      const dotR = clamp(Math.min(w, h) * 0.035, 1.6, 6);
      return [disc(cx, y + h - clamp(h * 0.07, 6, 30), dotR)];
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
      const left = x + clamp(w * 0.14, 10, 48);
      const chevron = clamp(w * 0.13, 8, 40);
      const arm = clamp(h * 0.16, 6, 34);
      const midY = cy;
      const rule = clamp(w * 0.26, 14, 110);
      return [
        `M ${left} ${midY - arm} L ${left + chevron} ${midY} L ${left} ${midY + arm}`,
        `M ${left + chevron * 1.6} ${midY + arm} L ${left + chevron * 1.6 + rule} ${midY + arm}`,
      ];
    }

    case 'browser': {
      const { paths, barH, dotsEndX } = titleBar(x, y, w, h);
      const addrLeft = dotsEndX + clamp(w * 0.05, 6, 28);
      const addrRight = x + w - clamp(w * 0.07, 8, 34);
      const addrH = barH * 0.52;
      const addrY = y + (barH - addrH) / 2;
      if (addrRight > addrLeft + addrH) {
        paths.push(roundedRect(addrLeft, addrY, addrRight - addrLeft, addrH, addrH / 2));
      }
      return paths;
    }

    /**
     * The stand, drawn out to the box the screen does not reach.
     *
     * Same division the chip makes: what you would fill and label is the
     * silhouette, and what is a line in every drawing of the object is a line.
     */
    case 'desktop': {
      const screenH = h * 0.76;
      const neckW = clamp(w * 0.16, 10, 60);
      const baseW = clamp(w * 0.42, 24, 160);
      const baseY = y + h;
      return [
        `M ${cx - neckW / 2} ${y + screenH} L ${cx - neckW / 2} ${baseY} ` +
          `M ${cx + neckW / 2} ${y + screenH} L ${cx + neckW / 2} ${baseY}`,
        `M ${cx - baseW / 2} ${baseY} L ${cx + baseW / 2} ${baseY}`,
      ];
    }

    /** The seam where the folder's leading face meets its back. */
    case 'folder': {
      const tabH = clamp(h * 0.16, 6, 26);
      return [`M ${x} ${y + tabH * 1.9} L ${x + w} ${y + tabH * 1.9}`];
    }

    /** The hole in the head, which is what makes a pin a pin and not a drop. */
    case 'pin': {
      // The head's centre is a fixed share of the height, because the outline's
      // own head is: both come from the same unit drawing.
      return [disc(cx, y + h * 0.352, Math.min(w, h) * 0.13)];
    }

    /** The fold that separates the plane's near wing from its far one. */
    case 'plane': {
      return [`M ${x + w} ${y} L ${x + w * 0.33} ${y + h * 0.6}`];
    }

    /**
     * The flap, with the thumb notch cut into it.
     *
     * The notch is the detail that makes a rounded rectangle read as a
     * billfold rather than as a card, and it is what the reference set uses.
     * It was a straight seam and a dot, which reads as neither.
     */
    case 'wallet': {
      const flapY = y + h * 0.42;
      const notchR = clamp(Math.min(w, h) * 0.11, 4, 22);
      const notchX = x + w * 0.62;
      const seamY = flapY - clamp(h * 0.16, 5, 30);
      return [
        `M ${x} ${flapY} L ${notchX - notchR} ${flapY} ` +
          `A ${notchR} ${notchR} 0 0 0 ${notchX + notchR} ${flapY} L ${x + w} ${flapY}`,
        `M ${x} ${seamY} L ${x + w} ${seamY}`,
      ];
    }

    /** The lid's grip, and nothing else: the two boxes are the silhouette. */
    case 'archive': {
      const lidH = clamp(h * 0.26, 6, 44);
      const gap = clamp(h * 0.04, 1, 8);
      const gripW = clamp(w * 0.26, 12, 90);
      const gripY = y + lidH + gap + clamp(h * 0.14, 5, 26);
      return [`M ${cx - gripW / 2} ${gripY} L ${cx + gripW / 2} ${gripY}`];
    }

    /** A pulse across the panel, flat at both ends so it reads as a trace. */
    case 'activity': {
      const left = x + clamp(w * 0.1, 6, 40);
      const right = x + w - clamp(w * 0.1, 6, 40);
      const amp = clamp(h * 0.22, 5, 60);
      const span = right - left;
      return [
        `M ${left} ${cy} L ${left + span * 0.22} ${cy} L ${left + span * 0.36} ${cy + amp} ` +
          `L ${left + span * 0.54} ${cy - amp} L ${left + span * 0.68} ${cy} L ${right} ${cy}`,
      ];
    }

    /** A globe's equator and its two meridians. */
    case 'globe': {
      const rx = w / 2;
      const ry = h / 2;
      return [
        `M ${x} ${cy} L ${x + w} ${cy}`,
        // One meridian, drawn as two half arcs so it closes on itself rather
        // than reading as a stray line down the middle.
        `M ${cx} ${y} A ${rx * 0.5} ${ry} 0 0 0 ${cx} ${y + h} A ${rx * 0.5} ${ry} 0 0 0 ${cx} ${y}`,
      ];
    }

    /** The hopper's shoulder line, and two level marks on the body. */
    case 'hopper': {
      const shoulder = y + h * 0.34;
      const dotR = clamp(Math.min(w, h) * 0.045, 1.4, 5);
      // Low and to one side, where a drive's lamps sit. Level with the middle
      // of the body they read as a pair of eyes, which is the whole shape's
      // problem at glyph size.
      const lampY = y + h - clamp(h * 0.16, 5, 30);
      const lampX = x + clamp(w * 0.14, 7, 34);
      return [
        `M ${x} ${shoulder} L ${x + w} ${shoulder}`,
        disc(lampX, lampY, dotR),
        disc(lampX + dotR * 3.4, lampY, dotR),
      ];
    }

    default:
      return [];
  }
}
