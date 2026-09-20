import { roughPolyline, seedFor, type SketchLevel } from '../model/rough';
import { hachure, SKETCH_FONT, SKETCH_FONT_SCALE } from '../chart/chartSketch';
import { layoutTable } from './tableLayout';
import type { TableSpec } from './tableTypes';

/**
 * The table as SVG, from the same layout the board draws.
 *
 * Text is cut to its cell by an approximate measure — 0.56em per character is
 * the average advance of Inter at text sizes — because SVG has no ellipsis of
 * its own and a clip path per cell would make the file unreadable to anything
 * that edits it afterwards.
 */

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fitText(text: string, room: number, fontSize: number, factor: number): string {
  const str = typeof text === 'object' && text !== null
    ? String((text as { value?: unknown; text?: unknown }).value ?? (text as { text?: unknown }).text ?? '')
    : String(text ?? '');
  const per = fontSize * factor;
  if (str.length * per <= room) return str;
  const n = Math.max(0, Math.floor(room / per) - 1);
  return n <= 0 ? '' : `${str.slice(0, n).trimEnd()}…`;
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
  const out: string[] = [];

  const line = (x1: number, y1: number, x2: number, y2: number, w: number, color: string, n: number) =>
    sketch
      ? `<path d="${roughPolyline([{ x: x1, y: y1 }, { x: x2, y: y2 }], { seed: seed + n * 13, level: sketch, closed: false })}" fill="none" stroke="${color}" stroke-width="${w * 1.2}" stroke-linecap="round" />`
      : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" />`;

  if (l.frame.fill !== 'transparent') {
    out.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="${sketch ? 0 : l.frame.radius}" fill="${l.frame.fill}" />`);
  }
  l.cells.forEach((cell, i) => {
    if (!cell.fill) return;
    if (sketch) {
      out.push(`<rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" fill="${cell.fill}" fill-opacity="0.35" />`);
      out.push(
        `<path d="${hachure({ x: cell.x, y: cell.y, width: cell.w, height: cell.h }, seed + i * 7, 7)}" fill="none" stroke="${cell.fill}" stroke-width="1" opacity="0.9" />`
      );
    } else {
      out.push(`<rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" fill="${cell.fill}" />`);
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
      out.push(`<path d="${roughPolyline(ring, { seed: seed + 999, level: sketch, closed: false })}" fill="none" stroke="${l.frame.color}" stroke-width="1.6" />`);
    } else {
      out.push(
        `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${l.frame.radius}" fill="none" stroke="${l.frame.color}" />`
      );
    }
  }

  const fs = l.fontSize * k;
  for (const cell of l.cells) {
    const markRoom = cell.sort || cell.filtered ? fs : 0;
    const room = cell.w - l.padX * 2 - markRoom;
    const text = fitText(cell.text, room, fs, sketch ? 0.46 : 0.56);
    if (!text) continue;
    const anchor = cell.align === 'center' ? 'middle' : cell.align === 'right' ? 'end' : 'start';
    const x =
      cell.align === 'center' ? cell.x + cell.w / 2 : cell.align === 'right' ? cell.x + cell.w - l.padX - markRoom : cell.x + l.padX;
    const y = cell.y + cell.h / 2 + fs * 0.35;
    out.push(
      `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${esc(font)}" font-size="${fs}" font-weight="${cell.bold || sketch ? 700 : 400}"${cell.italic ? ' font-style="italic"' : ''} fill="${cell.color}">${esc(text)}</text>`
    );
  }

  return out.join('');
}
