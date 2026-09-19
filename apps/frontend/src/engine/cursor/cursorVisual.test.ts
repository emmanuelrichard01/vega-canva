import { beforeEach, describe, expect, it } from 'vitest';
import {
  chromeVisual,
  CURSOR_SIZE,
  cursorVisual,
  HAND_CLOSED,
  HAND_OPEN,
  PRECISION_REACH,
  moveVisual,
  penVisual,
  precisionVisual,
  resizeVisual,
  ROTATE_GEOMETRY,
  rotateVisual,
  typeVisual,
  glyphFor,
  inkFor,
  paletteFor,
  INK,
  PAPER,
} from './cursorVisual';
import { cursorModeForTool } from './toolCursor';
import { cursorOverride, claimCursor } from './cursorOverride';
import { TOOL_SHORTCUTS } from '../tools/shortcuts';
import { contrastRatio } from './remoteCursor';
import { rotateCursorAngle } from '../interaction/rotateHandle';
import { cursorCss, FALLBACK } from './cursorCss';
import { CURSOR_MODES } from './toolCursor';

/**
 * The pointer, as far as it can be checked without a hand on a mouse.
 *
 * Everything here is a property of a *value* — the markup, the hotspot, the
 * palette, the claim store's ordering. What no test can speak for is whether
 * the pointer feels attached to the hand, which is why the latency work is
 * structural (nothing renders) rather than tuned.
 */

const ACCENT = '#F3A024';

/* ------------------------------------------------------------ the glyphs */

describe('a tool wears its own glyph, not its mode’s', () => {
  /**
   * The regression this exists for.
   *
   * There were twelve tool glyphs and the local pointer showed none of them:
   * the badge was built through a helper called with `undefined` for the tool,
   * so a rectangle, an ellipse, a star and a hexagon all wore the same generic
   * pencil — while a collaborator watching the same tool saw the right shape,
   * because the remote path passed the tool through. Two surfaces, one rule,
   * and it held on one of them.
   */
  it('prefers the tool over the mode where the tool has one', () => {
    expect(glyphFor('shape-ellipse', 'draw')).not.toBe(glyphFor('shape-star', 'draw'));
    expect(glyphFor('shape-ellipse', 'draw')).not.toBe(glyphFor(undefined, 'draw'));
  });

  it('falls back to the mode where the tool has nothing to add', () => {
    expect(glyphFor('unknown-tool', 'text')).toBe(glyphFor(undefined, 'text'));
  });

  it('puts the tool’s own glyph in the drawn markup', () => {
    // The end-to-end version of the above: not just that the table answers,
    // but that the answer reaches the pointer.
    const star = cursorVisual('draw', 'shape-star', ACCENT).svg;
    const ellipse = cursorVisual('draw', 'shape-ellipse', ACCENT).svg;
    expect(star).not.toBe(ellipse);
    expect(ellipse).toContain('<ellipse');
  });

  it('gives select no badge, and direct-select one', () => {
    // Selecting is the default state, so badging it decorates every pointer
    // with the information that nothing in particular is happening.
    expect(cursorVisual('pointer', 'select', ACCENT).svg).not.toContain('translate(19.6 19.6)');
    expect(cursorVisual('pointer', 'direct-select', ACCENT).svg).toContain('translate(19.6 19.6)');
  });
});

/* -------------------------------------------------------------- the modes */

describe('every tool in the dock has a mode', () => {
  it('names all of them, so none inherits the default by accident', () => {
    /**
     * Five tools were missing and fell through to `pointer` — `shape-line`,
     * `shape-arrow`, `connector`, `frame` and `grid` — so five draw-by-drag
     * tools showed the select arrow, which says the next drag will select
     * something. A default is a safe answer to an unknown tool and a wrong
     * answer to a known one.
     */
    const fellThrough = Object.keys(TOOL_SHORTCUTS).filter(
      (id) => id !== 'select' && cursorModeForTool(id) === 'pointer'
    );
    expect(fellThrough, `${fellThrough.join(', ')} fall through to the default`).toEqual([
      // The only legitimate one: it edits what an object is made of, so it
      // points rather than draws.
      'direct-select',
    ]);
  });
});

/* ------------------------------------------------------------ the palette */

describe('the palette follows the theme without giving up contrast', () => {
  it('gives the light theme a dark body, as Figma and both platforms do', () => {
    expect(paletteFor(false)).toEqual({ body: INK, edge: PAPER });
    expect(paletteFor(true)).toEqual({ body: PAPER, edge: INK });
  });

  it('keeps the pair at full contrast either way', () => {
    // The pair is what makes a pointer legible over arbitrary content: an
    // outline in the opposite colour means there is a hard edge against a
    // photograph, a black rectangle and an empty board alike.
    for (const dark of [false, true]) {
      const p = paletteFor(dark);
      expect(contrastRatio(p.body, p.edge)).toBeGreaterThan(15);
    }
  });

  it('draws the light theme’s arrow dark, and the dark theme’s light', () => {
    expect(cursorVisual('pointer', 'select', ACCENT, false).svg).toContain(`fill="${INK}"`);
    expect(cursorVisual('pointer', 'select', ACCENT, true).svg).toContain(`fill="${PAPER}"`);
  });

  it('changes identity with the theme, or the DOM write is skipped', () => {
    // `id` is what the component compares to decide whether to touch the DOM.
    // A theme left out of it would leave the old pointer up until the next
    // tool change.
    expect(cursorVisual('pointer', 'select', ACCENT, true).id).not.toBe(
      cursorVisual('pointer', 'select', ACCENT, false).id
    );
    expect(cursorVisual('pointer', 'select', '#000000').id).not.toBe(
      cursorVisual('pointer', 'select', '#FFFFFF').id
    );
  });
});

describe('inkFor', () => {
  it('picks whichever of the pair reads on the disc', () => {
    expect(inkFor('#000000')).toBe(PAPER);
    expect(inkFor('#FFFFFF')).toBe(INK);
  });

  it('reaches readable contrast on every accent it is given', () => {
    // The accent is a runtime value, so there is no set of colours to
    // enumerate and a lookup table cannot cover it — the same reasoning the
    // remote name chips record.
    for (const c of ['#F3A024', '#2563EB', '#10B981', '#EF4444', '#18181B', '#FAFAFA']) {
      expect(contrastRatio(c, inkFor(c)), c).toBeGreaterThan(4.5);
    }
  });
});

/* ------------------------------------------------------------ the hotspot */

describe('the hotspot', () => {
  it('is the arrow’s tip for every arrow-shaped pointer', () => {
    // A pointer whose hotspot moved with the tool would appear to jump every
    // time a key was pressed, which is why the arrow's shape never changes and
    // only its badge does.
    // `text` is deliberately absent: it is an I-beam in a box, not an arrow,
    // because a text click lands *between two characters* and an arrow
    // occludes the gap it is aimed into. See the type-pointer tests below.
    const tip = cursorVisual('pointer', 'select', ACCENT);
    for (const mode of ['draw', 'note', 'comment', 'place'] as const) {
      const v = cursorVisual(mode, undefined, ACCENT);
      expect({ x: v.offsetX, y: v.offsetY }, mode).toEqual({
        x: tip.offsetX,
        y: tip.offsetY,
      });
    }
  });

  it('is the middle for the pointers that aim at a point', () => {
    for (const mode of ['aim', 'pan', 'grab'] as const) {
      expect(cursorVisual(mode, undefined, ACCENT).offsetX, mode).toBe(-14);
    }
  });

  it('is the nib for the eraser, not the middle of its block', () => {
    const e = cursorVisual('erase', 'eraser', ACCENT);
    expect(e.offsetX).not.toBe(-14);
    // And it is a real eraser now, not the tightened crosshair it used to be —
    // which was a shape that says "aim here" for a tool whose whole point is
    // that it has a width.
    expect(e.svg).not.toContain('cursor-hand');
    expect(e.svg).toContain('19.6');
  });
});

describe('the hand closes on press', () => {
  it('carries both hands so CSS can choose without a render', () => {
    const pan = cursorVisual('pan', 'hand', ACCENT).svg;
    expect(pan).toContain('cursor-hand-open');
    expect(pan).toContain('cursor-hand-closed');
  });
});

/* -------------------------------------------------------------- the claim */

describe('cursorOverride', () => {
  beforeEach(() => cursorOverride.releaseAll());

  it('is empty until something claims', () => {
    expect(cursorOverride.get()).toBeNull();
  });

  it('gives the pointer to the most recent claimant', () => {
    claimCursor('transformer', 'nwse-resize');
    expect(cursorOverride.get()).toBe('nwse-resize');
    claimCursor('crop', 'move');
    expect(cursorOverride.get()).toBe('move');
  });

  it('falls back to the one still held when the newer one leaves', () => {
    // The reason this is a map and not a single value: a resize handle inside
    // a crop overlay means two things can want the pointer at once, and the
    // save-and-restore dance it replaces could only remember one level deep.
    claimCursor('crop', 'move');
    claimCursor('transformer', 'nwse-resize');
    claimCursor('transformer', null);
    expect(cursorOverride.get()).toBe('move');
  });

  it('lets one claimant change its own shape without stacking', () => {
    // The transformer re-claims as the object rotates, so the anchor under the
    // pointer keeps the right arrow.
    claimCursor('transformer', 'nwse-resize');
    claimCursor('transformer', 'nesw-resize');
    claimCursor('transformer', null);
    expect(cursorOverride.get()).toBeNull();
  });

  it('can be falsified from outside, for the claim nobody released', () => {
    /**
     * Invariant 12. Konva does not fire `mouseleave` for a node destroyed
     * under the pointer, and every handle here is conditionally rendered — so
     * a selection change mid-hover ends the hover with no event and the claim
     * would outlive the thing that made it. `releaseAll` is bound to a press
     * ending and the pointer leaving the canvas, which are facts about the
     * world rather than promises from a sender.
     */
    claimCursor('path-anchor', 'grab');
    cursorOverride.releaseAll();
    expect(cursorOverride.get()).toBeNull();
  });

  it('tells subscribers only when the answer changes', () => {
    let calls = 0;
    const off = cursorOverride.subscribe(() => calls++);
    claimCursor('a', 'move');
    const after = calls;
    claimCursor('a', 'move');
    expect(calls, 're-claiming the same shape is not a change').toBe(after);
    off();
  });

  it('hands back a cleanup that returns nothing', () => {
    // React treats a non-function return from an effect as a mistake, and a
    // returned `Set.delete` boolean is exactly that mistake typed.
    expect(cursorOverride.subscribe(() => {})()).toBeUndefined();
  });
});

describe('the pointers outside the board', () => {
  it('wears no badge, because no tool would act on a press there', () => {
    expect(chromeVisual('ui').svg).not.toContain('translate(19.6 19.6)');
  });

  it('keeps the arrow’s hotspot, so crossing a panel edge does not shift it', () => {
    const board = cursorVisual('pointer', 'select', ACCENT);
    const chrome = chromeVisual('ui');
    expect(chrome.offsetX).toBe(board.offsetX);
    expect(chrome.offsetY).toBe(board.offsetY);
  });

  it('draws a real I-beam for text rather than the arrow', () => {
    const beam = chromeVisual('text');
    expect(beam.svg).not.toContain('M5.65376');
    // The crossbars are what separate it from the strokes of the letters it
    // sits among; a bare vertical line disappears into text.
    expect(beam.svg).toContain('M14 5.5v17M11.4 5.5h5.2M11.4 22.5h5.2');
    expect(beam.offsetX).toBe(-14);
  });

  it('follows the theme like the board pointers do', () => {
    expect(chromeVisual('ui', true).id).not.toBe(chromeVisual('ui', false).id);
    expect(chromeVisual('ui', true).svg).toContain(`fill="${PAPER}"`);
  });
});

describe('the hand has five digits', () => {
  /**
   * The one it replaces had three fingers. Its path is three arcs off the palm
   * — at `8→12`, `12→16` and `16→20` — plus a column doing double duty as the
   * thumb. At 28px nobody counts, but the silhouette of a three-fingered hand
   * is wrong in a way people see without being able to name it, and it is the
   * one cursor every competing tool draws the same way.
   */
  const open = cursorVisual('pan', 'hand', ACCENT).svg;

  /**
   * Fingertips, by their own radius.
   *
   * Both hands end at the wrist with an arc too, at radius `1.45` — so a
   * pattern loose enough to match "any arc" counts five and a test asserting
   * four fails on a hand that has exactly four fingers. The tips are `1.5`,
   * and naming that is the difference between counting fingers and counting
   * curves.
   */
  const fingertips = (d: string) => (d.match(/a1\.5 1\.5 0 0 1/g) ?? []).length;

  it('draws four finger tips', () => {
    /**
     * Counted from `HAND_OPEN` itself, not from a coordinate.
     *
     * This matched the markup against a literal `M8.4 15.5`, so when the hand
     * was redrawn — it opens `M6.5 13.2` now — the regex found nothing, the
     * captured `d` was empty, and the test failed on its own first assertion
     * rather than on the thing it is about. A test pinned to the first two
     * numbers of a path breaks every time the art is touched, and says
     * nothing useful when it does.
     *
     * Each fingertip is an arc command; the thumb is a curve, not an arc.
     */
    expect(open, 'the open hand should be in the markup').toContain(HAND_OPEN);
    expect(fingertips(HAND_OPEN), 'four fingertips').toBe(4);
  });

  it('needs no knuckle lines, because the valleys separate the fingers', () => {
    // The three-fingered version had them, and that is what they were
    // compensating for.
    expect(open).toContain('cursor-hand-open');
    const openOnly = open.slice(open.indexOf('cursor-hand-open'), open.indexOf('cursor-hand-closed'));
    expect(openOnly).not.toContain('opacity="0.55"');
  });

  it('curls the fingers on the fist rather than reusing the open hand', () => {
    /**
     * This asserted `opacity="0.55"`, which was the knuckle strokes the
     * three-fingered fist needed to show where its fingers ended. The redrawn
     * fist encodes the curl in `HAND_CLOSED` itself and the separate marks
     * were removed with the art that needed them — so the only
     * `opacity="0.55"` left in this module belongs to the **eraser**, and the
     * assertion was one small edit away from passing for the wrong reason.
     *
     * What the fist actually promises is that it is a different hand from the
     * open one, with its fingers stopped short. Both are checked against the
     * path, which is where that fact lives.
     */
    const fist = cursorVisual('grab', 'hand', ACCENT).svg;
    expect(fist).toContain(HAND_CLOSED);
    expect(fist).not.toContain(HAND_OPEN);
    // Four fingers still, each one curled: the fist stops them above the
    // knuckle line rather than reaching up the palm.
    expect(fingertips(HAND_CLOSED), 'four fingertips').toBe(4);
  });
});

/* ------------------------------------------------------------- as a cursor */

describe('the art, as a real CSS cursor', () => {
  /**
   * The pointer is a `url()` cursor rather than a drawn element, because a
   * drawn element is composited with the page and is therefore a frame behind
   * the compositor-drawn OS cursor by construction. That was the "lags behind"
   * report, and no amount of tuning the drawing could have closed it.
   */
  it('puts the hotspot where the art says it is', () => {
    // `offsetX` placed the old element; a `url()` cursor wants the same number
    // negated. Getting this wrong moves the click point, not just the picture.
    const arrow = cursorVisual('pointer', 'select', ACCENT);
    expect(cursorCss(arrow, 'default')).toContain(`") ${-arrow.offsetX} ${-arrow.offsetY},`);

    const eraser = cursorVisual('erase', 'eraser', ACCENT);
    const css = cursorCss(eraser, 'crosshair');
    expect(css).toContain(`") ${-eraser.offsetX} ${-eraser.offsetY},`);
    // The eraser's hotspot is its nib, so it must not be the centre.
    expect(css).not.toContain('") 14 14,');
  });

  it('always names a fallback keyword', () => {
    /**
     * Not optional. A data URI can fail to decode or exceed a platform's
     * cursor size limit, and a `cursor` declaration the browser cannot use is
     * *dropped* — falling back to what it inherits rather than to nothing. So
     * the worst case has to be a plain crosshair, not an arrow over a drawing
     * tool.
     */
    expect(cursorCss(cursorVisual('draw', 'pen', ACCENT), 'crosshair')).toMatch(/, crosshair$/);
  });

  it('names a fallback for every mode, and never a bare arrow for a drawing one', () => {
    for (const mode of CURSOR_MODES) {
      expect(FALLBACK[mode], mode).toBeTruthy();
    }
    // A drawing tool falling back to `default` would tell the user the drag
    // will select, which is the one thing the fallback exists to prevent.
    expect(FALLBACK.draw).toBe('crosshair');
    expect(FALLBACK.text).toBe('text');
    expect(FALLBACK.pan).toBe('grab');
  });

  it('encodes the markup so the URI survives its own angle brackets', () => {
    const css = cursorCss(cursorVisual('pointer', 'select', ACCENT), 'default');
    expect(css.startsWith('url("data:image/svg+xml,')).toBe(true);
    // Raw `<`, `>`, `#` or `"` inside the URI would truncate the declaration.
    const uri = css.slice('url("'.length, css.indexOf('")'));
    expect(uri).not.toMatch(/[<>"#]/);
    expect(decodeURIComponent(uri.replace('data:image/svg+xml,', ''))).toContain('<svg');
  });

  it('stays small enough for a platform cursor', () => {
    // Chrome refuses image cursors past 128px and several platforms are
    // stricter; the art is 28px, and this is the assertion that keeps a future
    // addition from quietly crossing that line.
    expect(cursorVisual('pointer', 'select', ACCENT).svg).toContain('width="28" height="28"');
  });
});

/* ------------------------------------------- the hover and transform set */

describe('the scale pointer is continuous, where the OS set is not', () => {
  it('gives a different arrow for every angle, not one of eight', () => {
    /**
     * The whole reason it is drawn. `cursorForAnchor` has to round to the
     * nearest of the eight OS resize cursors, so on an object turned 20° every
     * handle's arrow is up to 22.5° away from the drag it describes.
     */
    const angles = [0, 10, 20, 30, 44];
    const ids = new Set(angles.map((a) => resizeVisual(a).id));
    expect(ids.size).toBe(angles.length);
  });

  it('turns about the hotspot, so the point being dragged does not move', () => {
    expect(resizeVisual(30).svg).toContain('rotate(30 14 14)');
    expect(resizeVisual(30).offsetX).toBe(-14);
  });
});

describe('the pen says what the next click does', () => {
  it('draws a different sign for each of the three gestures', () => {
    const ids = new Set((['add', 'remove', 'convert'] as const).map((a) => penVisual(a).id));
    expect(ids.size).toBe(3);
    // A plus has a vertical stroke the minus does not.
    expect(penVisual('add').svg).toContain('v7');
    expect(penVisual('remove').svg).not.toContain('v7');
  });

  it('keeps its hotspot at the nib, not the middle', () => {
    // The nib is what is being aimed at a path; the sign sits clear of it in
    // the opposite corner where it cannot obscure the segment.
    const v = penVisual('add');
    expect({ x: -v.offsetX, y: -v.offsetY }).toEqual({ x: 3, y: 3 });
  });
});

describe('the type pointer', () => {
  it('is an I-beam in a box, not the arrow with a badge', () => {
    const v = typeVisual();
    // The click lands *between two characters*, and an arrow occludes the gap
    // it is aimed into with its own body.
    expect(v.svg).not.toContain('M5.65376');
    expect(v.svg).toContain('stroke-dasharray');
    expect(v.offsetX).toBe(-14);
  });

  it('is what the text mode actually resolves to', () => {
    // The end-to-end half: not just that the art exists, but that the tool
    // gets it.
    expect(cursorVisual('text', 'text', ACCENT).svg).toBe(typeVisual().svg);
  });
});

describe('the precision crosshair', () => {
  it('leaves a real gap over the hotspot', () => {
    /**
     * The gap is the entire point, and it is why this is not the `aim` cross
     * at a lighter weight: the pixel under the hotspot has to be visible, and
     * a crosshair that meets in the middle covers it with its own join.
     */
    const svg = precisionVisual().svg;
    // Reach from the centre is `arm + gap` = 13, in a box whose centre is 14.
    // A cursor image is clipped to its declared size, so arms reaching past
    // the box would be cut off rather than overflowing as they would in a page.
    expect(svg).toContain('M14 1v9');
    expect(svg).toContain('M14 18v9');
    // Thinner than every other pointer: it is there to be seen past.
    expect(svg).toContain('stroke-width="1.1"');
  });

  it('carries no badge, because the tool has not changed', () => {
    expect(precisionVisual().svg).not.toContain('translate(19.6 19.6)');
  });
});

describe('the rotate pointer', () => {
  const CENTRE = 14;

  /** Every explicit coordinate pair in the arc and the head. */
  const points = () => {
    const out: Array<{ x: number; y: number }> = [];
    for (const d of [ROTATE_GEOMETRY.arc, ...ROTATE_GEOMETRY.heads]) {
      // Skip the `A rx ry rot large sweep` run, whose numbers are flags rather
      // than positions — the endpoint after them is matched on its own.
      const cleaned = d.replace(/A[\d.]+ [\d.]+ \d+ \d+ \d+ /g, 'L');
      for (const m of cleaned.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
        out.push({ x: Number(m[1]), y: Number(m[2]) });
      }
    }
    return out;
  };

  it('turns by the difference from its own facing, not by the raw bearing', () => {
    /**
     * The bug this pins. `rotateCursorAngle` answers in board terms — the
     * corner's outward diagonal — and the art is not drawn facing east, so
     * that bearing is not the rotation to apply. Turning by it directly put
     * every corner's arrow a quarter turn out.
     */
    const facing = ROTATE_GEOMETRY.facing;
    expect(rotateVisual(facing).svg).toContain('rotate(0 14 14)');
    expect(rotateVisual(facing + 90).svg).toContain('rotate(90 14 14)');
    expect(rotateVisual(225).id).not.toBe(rotateVisual(45).id);
  });

  it('points at each corner’s own diagonal', () => {
    // End to end: the four corners must produce four different marks, and the
    // top-left and bottom-right must be opposite.
    const turns = [0, 1, 2, 3].map((i) => {
      const svg = rotateVisual(rotateCursorAngle(i, 0)).svg;
      return Number(/rotate\((-?\d+)/.exec(svg)![1]);
    });
    expect(new Set(turns.map((t) => ((t % 360) + 360) % 360)).size).toBe(4);
    const norm = (n: number) => ((n % 360) + 360) % 360;
    expect(norm(turns[0] - turns[2])).toBe(180);
    expect(norm(turns[1] - turns[3])).toBe(180);
  });

  it('is an arc centred exactly on the hotspot', () => {
    /**
     * The defect this pins. An SVG `A` command places a circle from two
     * endpoints and a radius, so hand-written path data puts the centre
     * wherever the arithmetic lands — and `rotateVisual` turns the whole mark
     * about (14,14). An off-centre arc therefore *orbits* the point being held
     * as the corner angle changes, instead of spinning in place. It is
     * invisible in a path string and obvious in a construction.
     */
    // Parsed by shape rather than by scanning for number pairs: the `A`
    // command's radii and flags are numbers too, and a naive pair match reads
    // them as coordinates.
    const m = /^M([\d.]+) ([\d.]+) A[\d.]+ [\d.]+ \d+ \d+ \d+ ([\d.]+) ([\d.]+)$/.exec(
      ROTATE_GEOMETRY.arc
    );
    expect(m, `unparsed arc: ${ROTATE_GEOMETRY.arc}`).not.toBeNull();
    const ends = [
      { x: Number(m![1]), y: Number(m![2]) },
      { x: Number(m![3]), y: Number(m![4]) },
    ];

    for (const pt of ends) {
      expect(Math.hypot(pt.x - CENTRE, pt.y - CENTRE)).toBeCloseTo(ROTATE_GEOMETRY.radius, 1);
    }
  });

  it('puts the head on the tangent, by construction', () => {
    /**
     * An arrowhead a few degrees off its tangent does not read as a mistake —
     * it reads as a cheap asset, which is worse. The tip lies along the
     * tangent at the head's angle, so the vector from the arc point to the tip
     * is perpendicular to the radius there.
     */
    const a = (ROTATE_GEOMETRY.tipAngle * Math.PI) / 180;
    const onArc = {
      x: CENTRE + ROTATE_GEOMETRY.radius * Math.cos(a),
      y: CENTRE + ROTATE_GEOMETRY.radius * Math.sin(a),
    };
    // The first head's tip is the first point of the first head path.
      const tip = points()[2];
    const toTip = { x: tip.x - onArc.x, y: tip.y - onArc.y };
    const radial = { x: Math.cos(a), y: Math.sin(a) };
    // Perpendicular: the dot product with the radius is zero.
    expect(Math.abs(toTip.x * radial.x + toTip.y * radial.y)).toBeLessThan(0.05);
  });

  it('fits inside the box once its halo is counted', () => {
    /**
     * A cursor image is clipped to its declared size, and this mark carries a
     * 3.8px halo so it separates from content — so the geometry has to stop
     * well short of the edge, not at it. A first pass reached 13.89 against a
     * half-box of 14 and the halo would have been shaved off all the way round.
     */
    const HALO = 3.8 / 2;
    for (const pt of points()) {
      const r = Math.hypot(pt.x - CENTRE, pt.y - CENTRE);
      expect(r + HALO, `a point sits ${r.toFixed(2)} from the centre`).toBeLessThan(CENTRE);
    }
  });

  it('is a shallow arc, so it reads as an arrow and not a ring', () => {
    /**
     * The first version swept about 320°, which closes into a refresh glyph —
     * a button, not a direction. With a head at *each* end the ceiling is
     * lower still: much past 180° and the two heads meet round the back and
     * the mark becomes a circle with notches.
     */
    expect(ROTATE_GEOMETRY.sweep).toBeLessThan(180);
    expect(ROTATE_GEOMETRY.sweep).toBeGreaterThan(90);
    expect(ROTATE_GEOMETRY.arc).toContain('0 0 1');
  });

  it('has a head at each end, pointing opposite ways', () => {
    // Double-headed is the whole claim: the corner turns either way, and a
    // single head says it turns one way.
    expect(ROTATE_GEOMETRY.heads).toHaveLength(2);
    expect(ROTATE_GEOMETRY.heads[0]).not.toBe(ROTATE_GEOMETRY.heads[1]);
  });
});

describe('the precision crosshair fits the box it is drawn in', () => {
  /**
   * A cursor image is **clipped to its declared size**. An SVG in a page can
   * overflow its viewBox, and this file sets `overflow: visible`, so a mark
   * reaching past 28px looks correct everywhere except where it is actually
   * used. The first draft of this crosshair had `arm + gap = 15` against a
   * centre at 14 and its arms were cut off.
   *
   * Asserted on the reach rather than by scanning the markup, deliberately.
   * A general "nothing is outside the box" check over path data needs a real
   * SVG path parser — relative curve deltas are not coordinates and hex
   * colours are not numbers — and a naive version of it reports the fill
   * `#141821` as a point at 141821. A guard that cries wolf is worse than the
   * targeted one that covers the case that actually went wrong.
   */
  it('reaches no further than the half-box it has', () => {
    expect(PRECISION_REACH).toBeLessThanOrEqual(CURSOR_SIZE / 2 - 1);
    // And is still most of it, or it is not a precision crosshair.
    expect(PRECISION_REACH).toBeGreaterThanOrEqual(CURSOR_SIZE / 2 - 3);
  });
});

describe('the move pointer', () => {
  /**
   * Left out once, on the grounds that everything on a board can be moved so
   * announcing it is the least surprising fact available. That holds for
   * hovering *anything*; it does not hold for hovering something already
   * **selected**, which is ringed by handles that resize it and a band that
   * turns it — so the one question its middle raises is what that part does.
   */
  it('is a four-way arrow, centred on the hotspot', () => {
    const v = moveVisual();
    expect(v.offsetX).toBe(-14);
    expect(v.offsetY).toBe(-14);
    // Four heads: two chevron strokes each.
    expect((v.svg.match(/M14 4\.5|M14 23\.5|M4\.5 14|M23\.5 14/g) ?? []).length).toBeGreaterThan(3);
  });

  it('follows the theme like every other pointer', () => {
    expect(moveVisual(true).id).not.toBe(moveVisual(false).id);
  });

  it('carries no badge, because no tool is being described', () => {
    expect(moveVisual().svg).not.toContain('translate(19.6 19.6)');
  });
});
