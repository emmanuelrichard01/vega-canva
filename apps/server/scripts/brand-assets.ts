/**
 * Draw every brand raster the web app ships, from the vector mark.
 *
 *   npx tsx scripts/brand-assets.ts [--site https://vscanva.vercel.app]
 *
 * Writes into `apps/frontend/public`:
 *
 *   favicon.svg           the tab icon, with a dark-mode variant built in
 *   favicon.ico           16, 32 and 48 px, for everything that ignores SVG
 *   favicon-96x96.png     Google's search result icon wants a multiple of 48
 *   apple-touch-icon.png  180 px, opaque — iOS rounds the corners itself
 *   icons/icon-*.png      the installed app icon, as drawn
 *   icons/maskable-*.png  the same, inside Android's safe zone, full bleed
 *   og-image.png          the site's own share card, 1200×630
 *   og-board.png          a board's card when the server cannot be asked
 *
 * These used to be exported by hand, and the install icons had quietly kept an
 * older logo — a black V with an orange parallelogram — while the tab showed
 * the current mark. Generating them from one geometry is what stops that
 * happening again. Rerun after changing `src/share/brand.ts` or the card.
 */
import fs from 'fs';
import path from 'path';
import { BRAND_AMBER, BRAND_INK, BRAND_PAPER, MARK_SPARKLE, MARK_V, markSvg } from '../src/share/brand';
import { privateCardSvg, siteCardSvg } from '../src/share/cardSvg';
import { svgToPng } from '../src/share/raster';

const PUBLIC = path.resolve(__dirname, '..', '..', 'frontend', 'public');
const siteArg = process.argv.indexOf('--site');
const site = siteArg > 0 ? process.argv[siteArg + 1] : 'https://vscanva.vercel.app';

const square = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

/** A rounded tile with transparent corners: favicons and the "any" app icon. */
const tileIcon = (size: number) => square(size, markSvg({ size, radius: 12 }));

/** Full bleed, artwork shrunk into the 80% circle Android may mask to. */
const maskableIcon = (size: number) => square(size, markSvg({ size, radius: 0, inset: 0.62 }));

/** iOS masks the corners itself and shows transparency as black. */
const touchIcon = (size: number) => square(size, markSvg({ size, radius: 0, inset: 0.78 }));

/**
 * The tab icon, as SVG, following the browser's colour scheme.
 *
 * On a dark tab strip a near-black tile has no edge at all and the mark reads
 * as a floating V. In dark mode the tile lifts a step and takes a hairline, so
 * it keeps its shape. Everything else is the same drawing.
 */
const faviconSvg = () =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  `<style>.t{fill:${BRAND_INK}}.e{fill:none}@media (prefers-color-scheme:dark){.t{fill:#262626}.e{stroke:#fff;stroke-opacity:.18;stroke-width:2}}</style>` +
  '<rect class="t" width="100" height="100" rx="12"/>' +
  `<path d="${MARK_V}" fill="${BRAND_AMBER}"/>` +
  `<path d="${MARK_SPARKLE}" fill="${BRAND_PAPER}"/>` +
  '<rect class="e" x="1" y="1" width="98" height="98" rx="11"/>' +
  '</svg>\n';

/** PNGs packed into an ICO container, which every browser since IE11 reads. */
function ico(pngs: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function write(file: string, data: Buffer | string) {
  const target = path.join(PUBLIC, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  console.log(`  ${file.padEnd(28)} ${(Buffer.byteLength(data) / 1024).toFixed(1)} kB`);
}

async function main() {
  console.log(`Writing brand assets to ${PUBLIC}`);
  await write('favicon.svg', faviconSvg());

  const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await svgToPng(tileIcon(size)) })));
  await write('favicon.ico', ico(small));
  await write('favicon-96x96.png', await svgToPng(tileIcon(96)));
  await write('apple-touch-icon.png', await svgToPng(touchIcon(180)));

  for (const size of [192, 512]) {
    await write(`icons/icon-${size}.png`, await svgToPng(tileIcon(size)));
    await write(`icons/maskable-${size}.png`, await svgToPng(maskableIcon(size)));
  }

  await write('og-image.png', await svgToPng(siteCardSvg({ domain: new URL(site).host })));
  await write('og-board.png', await svgToPng(privateCardSvg()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
