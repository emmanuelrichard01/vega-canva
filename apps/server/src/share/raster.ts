import fs from 'fs';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

/**
 * SVG to PNG, in WebAssembly.
 *
 * Unfurlers want a PNG or JPEG; none of them take SVG. resvg is the renderer
 * of choice for that — accurate, no browser, no native module — and the WASM
 * build means the server image needs no platform binary and no system
 * libraries, on Alpine or anywhere else. Text never reaches it: `text.ts`
 * turns every word into outlines first, so it needs no fonts either.
 */

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  if (!ready) {
    const wasm = fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'));
    ready = initWasm(wasm).catch((err) => {
      // A second init after a success throws; anything else is real.
      if (!String(err?.message ?? err).includes('Already initialized')) {
        ready = null;
        throw err;
      }
    });
  }
  return ready;
}

export async function svgToPng(svg: string, width?: number): Promise<Buffer> {
  await init();
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { loadSystemFonts: false },
    shapeRendering: 2,
    imageRendering: 0,
  });
  const png = resvg.render().asPng();
  resvg.free();
  return Buffer.from(png);
}
