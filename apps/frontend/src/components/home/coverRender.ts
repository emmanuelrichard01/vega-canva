import type { Template } from '../../engine/templates/templates';
import { renderBoardSvg } from './boardSvg';

/**
 * A template's cover as an SVG document: the one recipe for it.
 *
 * The build bakes every cover with this (`vite.config.ts`, `coverBake.ts`) so
 * the gallery loads finished files from the CDN. The browser runs the same
 * function only for a template the build did not bake (in dev, for example),
 * so a baked cover and a live one cannot drift apart.
 */

/** The hint `build(limit)` takes for a cover: a silhouette, not the whole board. */
export const COVER_LIMIT = 150;
/** Roughly how wide a cover is shown; frame names are sized for it. */
export const COVER_WIDTH = 420;
/** Samples per plotted curve. Past this, a 420px cover cannot show the difference. */
export const COVER_SAMPLES = 240;

export async function renderCoverSvg(template: Template, cooperative?: boolean): Promise<string> {
  const { svg } = await renderBoardSvg(template.build(COVER_LIMIT), {
    idPrefix: `c${template.id}-`,
    displayWidth: COVER_WIDTH,
    ground: null,
    maxSamples: COVER_SAMPLES,
    cooperative,
  });
  return compactSvg(svg);
}

/** Attributes that hold geometry in world units, and nothing a person reads. */
const GEOMETRY_ATTR =
  /\s(d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|viewBox|transform|stroke-width|font-size|letter-spacing)="([^"]*)"/g;
const LONG_DECIMAL = /-?\d+\.\d{2,}/g;

/**
 * Geometry rounded to a tenth of a world unit.
 *
 * A board several thousand units wide is drawn about 420px across, so a
 * tenth of a unit is around a hundredth of a pixel, and the fifteen digits
 * after it are bytes nobody can see. A curve-heavy cover shrinks to about half.
 * Only geometry attributes are touched: text content and colours stay exactly
 * as written.
 */
export function compactSvg(svg: string): string {
  return svg.replace(GEOMETRY_ATTR, (_m, name: string, value: string) => {
    const short = value.replace(LONG_DECIMAL, (n) => String(Math.round(Number(n) * 10) / 10));
    return ` ${name}="${short}"`;
  });
}
