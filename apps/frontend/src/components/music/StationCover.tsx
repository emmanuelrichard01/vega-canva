import React, { useEffect, useRef } from 'react';
import { createRng, mixSeed } from '../../engine/music/rng';
import type { StationId } from '../../engine/music/stations';

/**
 * Small generative cover art for a station, drawn once to a canvas.
 *
 * Each station has its own motif and palette; the variation seed moves the
 * details, so a new variation gets new art. Static: nothing animates here.
 */
const PALETTES: Record<StationId, readonly string[]> = {
  ambient: ['#dfe7e2', '#9fb8ad', '#5f7f74', '#2f4a43'],
  piano: ['#efe7da', '#c9b79c', '#8a7358', '#3c3226'],
  lofi: ['#ead9c6', '#d39a77', '#8c5a4a', '#3a2a33'],
  synth: ['#1d1533', '#5b2a86', '#e1488a', '#ffb36b'],
  house: ['#14232b', '#1f5f6b', '#3fb5a3', '#e8d27a'],
  retro: ['#1b1b2f', '#3a7bd5', '#f2c94c', '#eb5757'],
};

function paint(ctx: CanvasRenderingContext2D, size: number, station: StationId, seed: number) {
  const rng = createRng(mixSeed(seed, 0xc0fe));
  const [bg, a, b, c] = PALETTES[station];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  switch (station) {
    case 'ambient': {
      // Layered horizon bands.
      for (let i = 0; i < 5; i++) {
        const y = size * (0.35 + i * 0.13 + rng.next() * 0.05);
        ctx.fillStyle = [a, b, c][i % 3];
        ctx.globalAlpha = 0.35 + i * 0.12;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= size; x += size / 8) ctx.lineTo(x, y + Math.sin(x / size * Math.PI * 2 + i + rng.next()) * size * 0.04);
        ctx.lineTo(size, size);
        ctx.lineTo(0, size);
        ctx.fill();
      }
      break;
    }
    case 'piano': {
      // Keys, with a few pressed.
      const keys = 7;
      const w = size / keys;
      for (let i = 0; i < keys; i++) {
        ctx.fillStyle = rng.chance(0.3) ? a : bg;
        ctx.fillRect(i * w + 1, size * 0.45, w - 2, size * 0.55);
      }
      ctx.fillStyle = c;
      for (const i of [0, 1, 3, 4, 5]) ctx.fillRect((i + 0.68) * w, size * 0.45, w * 0.64, size * 0.32);
      ctx.fillStyle = b;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(size * (0.25 + rng.next() * 0.5), size * 0.22, size * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lofi': {
      // A record, slightly off centre.
      const cx = size * (0.45 + rng.next() * 0.1);
      const cy = size * 0.55;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, size / 64);
      for (let r = 0.14; r < 0.36; r += 0.045) {
        ctx.beginPath();
        ctx.arc(cx, cy, size * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = a;
      ctx.fillRect(size * 0.08, size * 0.08, size * 0.22, size * 0.04);
      break;
    }
    case 'synth': {
      // Sun over a perspective grid.
      const sun = ctx.createLinearGradient(0, size * 0.1, 0, size * 0.55);
      sun.addColorStop(0, c);
      sun.addColorStop(1, b);
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(size / 2, size * 0.48, size * 0.26, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = bg;
      for (let i = 0; i < 4; i++) ctx.fillRect(0, size * (0.3 + i * 0.05), size, size * 0.012 * (i + 1));
      ctx.strokeStyle = b;
      ctx.lineWidth = Math.max(1, size / 80);
      const horizon = size * 0.52;
      for (let i = 0; i < 6; i++) {
        const y = horizon + Math.pow(i / 5, 1.8) * size * 0.48;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(size / 2 + i * size * 0.04, horizon);
        ctx.lineTo(size / 2 + i * size * 0.3, size);
        ctx.stroke();
      }
      break;
    }
    case 'house': {
      // Concentric pulses.
      const rings = 5 + rng.int(0, 2);
      for (let i = rings; i > 0; i--) {
        ctx.fillStyle = [a, b, c][i % 3];
        ctx.globalAlpha = 0.25 + (rings - i) * 0.12;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, (size * 0.48 * i) / rings, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'retro': {
      // A pixel landscape.
      const px = size / 12;
      for (let x = 0; x < 12; x++) {
        const h = 3 + rng.int(0, 3);
        for (let y = 12 - h; y < 12; y++) {
          ctx.fillStyle = y === 12 - h ? c : a;
          ctx.fillRect(x * px, y * px, px, px);
        }
      }
      ctx.fillStyle = b;
      ctx.fillRect(px * (2 + rng.int(0, 7)), px * 2, px * 2, px * 2);
      break;
    }
  }
  ctx.globalAlpha = 1;
}

/** `fluid` lets CSS size the canvas; `size` is then only its drawing resolution. */
export const StationCover: React.FC<{ station: StationId; seed: number; size: number; className?: string; fluid?: boolean }> = ({
  station,
  seed,
  size,
  className,
  fluid = false,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, size, station, seed);
  }, [station, seed, size]);
  return <canvas ref={ref} className={className} width={size} height={size} style={fluid ? undefined : { width: size, height: size }} aria-hidden="true" />;
};
