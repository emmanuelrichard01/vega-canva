import fs from 'fs';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

/**
 * SVG to PNG with resvg's WebAssembly build: no browser, no native module and
 * no fonts, because `text.ts` turns every word into outlines first.
 *
 * Synchronous once initialised. `raster.ts` runs it on a worker thread so a
 * card render does not stall the WebSocket traffic sharing the event loop.
 */

let ready: Promise<void> | null = null;

export function initRaster(): Promise<void> {
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

export async function renderPng(svg: string, width?: number): Promise<Uint8Array> {
  await initRaster();
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { loadSystemFonts: false },
    shapeRendering: 2,
    imageRendering: 0,
  });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}
