import { roughPolyline, seedFor, type SketchLevel } from '../model/rough';
import { hachure, SKETCH_FONT, SKETCH_FONT_SCALE } from '../chart/chartSketch';
import { layoutTable } from './tableLayout';
import { cellPrims, type Prim } from './tablePaint';
import type { TableSpec } from './tableTypes';
import { attr, escapeXml as esc, num } from '../export/markup';

/**
 * The table as SVG, from the same layout and paint plan the board draws.
 *
 * Text is fitted by an approximate measure — 0.56em per character is the
 * average advance of Inter at text sizes — because there is no canvas to ask
 * and a clip path per cell would make the file unreadable to anything that
 * edits it afterwards.
 */

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

function primSvg(p: Prim, font: string, sketchBold: boolean): string {
  switch (p.t) {
    case 'rect':
      return `<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}"${p.r ? ` rx="${num(p.r)}"` : ''} fill="${p.fill ? attr(p.fill) : 'none'}"${p.stroke ? ` stroke="${attr(p.stroke)}" stroke-width="${num(p.sw ?? 1)}"` : ''}${p.opacity !== undefined ? ` fill-opacity="${num(p.opacity)}"` : ''} />`;
    case 'path':
      return `<path d="${attr(p.d)}" fill="${p.fill ? attr(p.fill) : 'none'}"${p.stroke ? ` stroke="${attr(p.stroke)}" stroke-width="${num(p.sw ?? 1)}" stroke-linecap="round" stroke-linejoin="round"` : ''} />`;
    case 'text': {
      const anchor = p.anchor === 'middle' ? 'middle' : p.anchor === 'end' ? 'end' : 'start';
      return `<text x="${num(p.x)}" y="${num(p.y + p.size * 0.35)}" text-anchor="${anchor}" font-family="${esc(font)}" font-size="${num(p.size)}" font-weight="${p.bold || sketchBold ? 700 : 400}"${p.italic ? ' font-style="italic"' : ''}${p.underline ? ' text-decoration="underline"' : ''} fill="${attr(p.fill)}">${esc(p.s)}</text>`;
    }
  }
}

export function tableToSvg(
  spec: TableSpec,
  width: number,
  height: number,
  options: { id: string; sketch?: SketchLevel; sketchSeed?: number }
): string {
  const l = layoutTable(spec, width, height);
  const sketch = options.sketch;
  const seed = seedFor(options.id, options.sketchSeed);
  const font = sketch ? SKETCH_FONT : FONT;
  const k = sketch ? SKETCH_FONT_SCALE : 1;
  const factor = sketch ? 0.46 : 0.56;
  const out: string[] = [];

  const line = (x1: number, y1: number, x2: number, y2: number, w: number, color: string, n: number) =>
    sketch
      ? `<path d="${attr(roughPolyline([{ x: x1, y: y1 }, { x: x2, y: y2 }], { seed: seed + n * 13, level: sketch, closed: false }))}" fill="none" stroke="${attr(color)}" stroke-width="${num(w * 1.2)}" stroke-linecap="round" />`
      : `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${attr(color)}" stroke-width="${num(w)}" />`;

  if (l.frame.fill !== 'transparent') {
    out.push(`<rect x="0" y="0" width="${num(width)}" height="${num(height)}" rx="${sketch ? 0 : num(l.frame.radius)}" fill="${attr(l.frame.fill)}" />`);
  }
  l.cells.forEach((cell, i) => {
    if (!cell.fill) return;
    if (sketch) {
      out.push(`<rect x="${num(cell.x)}" y="${num(cell.y)}" width="${num(cell.w)}" height="${num(cell.h)}" fill="${attr(cell.fill)}" fill-opacity="0.35" />`);
      out.push(
        `<path d="${attr(hachure({ x: cell.x, y: cell.y, width: cell.w, height: cell.h }, seed + i * 7, 7))}" fill="none" stroke="${attr(cell.fill)}" stroke-width="1" opacity="0.9" />`
      );
    } else {
      out.push(`<rect x="${num(cell.x)}" y="${num(cell.y)}" width="${num(cell.w)}" height="${num(cell.h)}" fill="${attr(cell.fill)}" />`);
    }
  });
  l.segments.forEach((s, i) => out.push(line(s.x1, s.y1, s.x2, s.y2, s.width, s.color, i)));
  if (l.frame.width > 0) {
    if (sketch) {
      const ring = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 },
      ];
      out.push(`<path d="${attr(roughPolyline(ring, { seed: seed + 999, level: sketch, closed: false }))}" fill="none" stroke="${attr(l.frame.color)}" stroke-width="1.6" />`);
    } else {
      out.push(
        `<rect x="0.5" y="0.5" width="${num(width - 1)}" height="${num(height - 1)}" rx="${num(l.frame.radius)}" fill="none" stroke="${attr(l.frame.color)}" />`
      );
    }
  }

  const measure = (s: string, bold: boolean, _italic: boolean, size: number) => s.length * size * (bold ? factor + 0.04 : factor);
  for (const cell of l.cells) {
    for (const p of cellPrims(cell, l, { measure, fontScale: k })) out.push(primSvg(p, font, Boolean(sketch)));
  }

  return out.join('');
}
