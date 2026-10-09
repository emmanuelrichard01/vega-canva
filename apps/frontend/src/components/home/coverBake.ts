import { TEMPLATES } from '../../engine/templates/templates';
import { renderCoverSvg } from './coverRender';

/**
 * Every template's cover, drawn at build time.
 *
 * Run in Node by the `vega-template-covers` plugin in `vite.config.ts`. Without
 * a DOM, text is measured with the template kit's estimate rather than a
 * canvas. At cover size that is indistinguishable, and an `<img>` SVG cannot
 * use the page's web fonts anyway.
 *
 * A template that fails to draw is left out, never allowed to fail the build:
 * the gallery draws a missing cover in the browser, as it did before covers
 * were baked.
 */
export async function bakeCovers(): Promise<{ covers: Array<{ id: string; svg: string }>; failed: string[] }> {
  const covers: Array<{ id: string; svg: string }> = [];
  const failed: string[] = [];
  for (const template of TEMPLATES) {
    try {
      covers.push({ id: template.id, svg: await renderCoverSvg(template, false) });
    } catch (err) {
      failed.push(`${template.id}: ${String((err as Error)?.message ?? err)}`);
    }
  }
  return { covers, failed };
}
