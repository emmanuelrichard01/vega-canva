/**
 * The grain on a sticky note: one small tile, made once, repeated by Konva.
 *
 * Paper is not flat colour. A faint fibre — a few percent of light and dark
 * flecks — is what makes a sticky read as a sheet rather than as a rectangle,
 * and it is invisible below the size where it is not drawn at all. The tile is
 * deterministic (a seeded generator, not `Math.random`) so every client, every
 * export and every screenshot shows the same paper.
 */

let tile: HTMLCanvasElement | null = null;
const SIZE = 96;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paperGrain(): HTMLCanvasElement | null {
  if (tile) return tile;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rand = mulberry32(0x5eed);
  // Flecks: mostly dark, a few light, all faint.
  for (let i = 0; i < 900; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const light = rand() < 0.3;
    ctx.fillStyle = light ? `rgba(255,255,255,${0.05 + rand() * 0.07})` : `rgba(60,40,20,${0.025 + rand() * 0.035})`;
    ctx.fillRect(x, y, 1 + rand() * 0.8, 1 + rand() * 0.8);
  }
  // Fibres: a few short strokes at shallow angles.
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const len = 4 + rand() * 9;
    const a = (rand() - 0.5) * 0.9;
    ctx.strokeStyle = `rgba(80,60,30,${0.025 + rand() * 0.03})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  tile = canvas;
  return tile;
}
