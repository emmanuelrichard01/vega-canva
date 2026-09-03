import type { Box } from './tour';

/**
 * Where a canvas object is, in the coordinates a DOM overlay is positioned in.
 *
 * ## Why this is a module and not four lines in the component
 *
 * Because those four lines have already been wrong once, for as long as the
 * feature that contained them existed. Invariant 10 is the whole of it: there
 * are three coordinate spaces here and they are not interchangeable.
 *
 * ```text
 *   world    what the document stores
 *   stage    world * zoom + camera        an offset inside the Konva stage
 *   window   what a DOM overlay uses      the stage, plus where the stage starts
 * ```
 *
 * `ObjectContextToolbar` converted world to **stage** and then positioned a DOM
 * element in **window**, and the stage does not start at the window's corner —
 * it is inset by the rulers. So the rail was drawn a ruler's width up and to
 * the left of the object it belonged to, and three rounds of "give it more
 * clearance below" went into compensating for a constant error that was
 * symmetric in the geometry and asymmetric in the result. The tell was the
 * user's: the top had enough room, so why did the bottom not?
 *
 * A walkthrough that points at an object is the same problem again, and it
 * arrives with the same excuse — it is only an arrow, it is only a few pixels.
 * So the conversion is one function, it takes the stage origin as an argument
 * rather than reaching for it, and it is tested. `NodeEditor` gets this right
 * by adding `getBoundingClientRect()` of `.konvajs-content`; this is that rule,
 * written down somewhere it can be asserted.
 */

export interface Camera {
  /** The camera's own offset, already in stage pixels. */
  x: number;
  y: number;
  zoom: number;
}

/** The rectangle a node occupies in world space. */
export interface WorldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The node's box, in window coordinates.
 *
 * `origin` is where the Konva stage begins in the window — the rulers' inset,
 * plus whatever the page layout puts above and left of the canvas. Passing it
 * in rather than reading it here is what keeps this pure, and passing it at
 * all is the entire point of the module.
 */
export function anchorBox(world: WorldBox, camera: Camera, origin: { x: number; y: number }): Box {
  return {
    x: world.x * camera.zoom + camera.x + origin.x,
    y: world.y * camera.zoom + camera.y + origin.y,
    width: world.width * camera.zoom,
    height: world.height * camera.zoom,
  };
}

/**
 * Whether the box is far enough on screen to be worth pointing at.
 *
 * A ring drawn round something the reader cannot see is worse than no ring:
 * it claims the walkthrough is talking about a thing that is not there. The
 * caller falls back to placing the card against the dock, which says the same
 * words without making a false claim about where to look.
 *
 * "Far enough" is a real overlap rather than a touch, because an object one
 * pixel inside the edge is not visible in any useful sense.
 */
export function onScreen(box: Box, viewport: { width: number; height: number }): boolean {
  const MIN = 24;
  const right = Math.min(box.x + box.width, viewport.width);
  const left = Math.max(box.x, 0);
  const bottom = Math.min(box.y + box.height, viewport.height);
  const top = Math.max(box.y, 0);
  return right - left >= MIN && bottom - top >= MIN;
}
