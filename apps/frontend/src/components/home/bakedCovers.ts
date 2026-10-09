/**
 * The URL of each template's cover baked by the build, by template id.
 *
 * Empty in dev and in tests, where the gallery draws covers in the browser.
 * See `vega-template-covers` in `vite.config.ts`.
 */
import baked from 'virtual:template-covers';

export const BAKED_COVERS: Readonly<Record<string, string>> = baked ?? {};
