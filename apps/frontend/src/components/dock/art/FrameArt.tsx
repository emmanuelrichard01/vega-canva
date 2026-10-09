import React, { useMemo } from 'react';
import { n, Tile, type Paint, type Scene } from './DataArt';

/**
 * The Frame seat's sizes, as lit tiles in the chart and grid family.
 *
 * Each preset is drawn as the thing it stands for (a monitor, a phone, a
 * sheet of A4, a story) at the preset's true proportions, on the same plate,
 * light and palette as `DataArt`. So Phone, Tablet and Story are told apart by
 * shape before their names are read, and a sheet mixing frames with charts
 * and grids reads as one set. Colours are the `.data-art` tokens
 * (`dataArt.css`), so themes and increased contrast follow for free.
 */

/** What a frame preset is drawn as: the presets' own `icon` ids, plus the hand-sized frame. */
export type FrameArtKind =
  | 'custom' | 'desktop' | 'laptop' | 'tablet' | 'phone' | 'slide' | 'square' | 'portrait' | 'story' | 'video' | 'link' | 'page' | 'card';

interface Box { x: number; y: number; w: number; h: number }

/** The largest box of the frame's own proportions inside `maxW` × `maxH`, centred on the plate. */
function fitBox(width: number, height: number, maxW: number, maxH: number, cy = 23): Box {
  const s = Math.min(maxW / width, maxH / height);
  const w = width * s;
  const h = height * s;
  return { x: n(32 - w / 2), y: n(cy - h / 2), w: n(w), h: n(h) };
}

/** A box pulled in by `d` at the sides, `top` and `bottom`. */
const inset = (b: Box, d: number, top = d, bottom = d): Box => ({ x: b.x + d, y: b.y + top, w: b.w - 2 * d, h: b.h - top - bottom });

type Layout = 'web' | 'app' | 'tiles';

/** Bars of interface on a lit screen. */
function ScreenUi({ b, layout }: { b: Box; layout: Layout }) {
  const u = Math.min(b.w, b.h);
  const pad = Math.max(1.4, u * 0.1);
  const bar = Math.max(1.2, u * 0.09);
  if (layout === 'tiles') {
    const gw = (b.w - pad * 3) / 2;
    const gh = (b.h - pad * 4 - bar) / 2;
    return (
      <g className="da-a-pop">
        <rect className="da-screen-ink" x={n(b.x + pad)} y={n(b.y + pad)} width={n(b.w * 0.5)} height={n(bar)} rx={n(bar / 2)} />
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            className="da-screen-card"
            x={n(b.x + pad + (i % 2) * (gw + pad))}
            y={n(b.y + pad * 2 + bar + Math.floor(i / 2) * (gh + pad))}
            width={n(gw)}
            height={n(gh)}
            rx={1}
          />
        ))}
      </g>
    );
  }
  if (layout === 'app') {
    const cardH = (b.h - pad * 4 - bar) / 2.4;
    return (
      <g className="da-a-rise">
        <rect className="da-screen-ink" x={n(b.x + pad)} y={n(b.y + pad * 1.6)} width={n(b.w * 0.55)} height={n(bar)} rx={n(bar / 2)} />
        <rect className="da-screen-card" x={n(b.x + pad)} y={n(b.y + pad * 2.6 + bar)} width={n(b.w - pad * 2)} height={n(cardH)} rx={1.2} />
        <rect className="da-screen-card" x={n(b.x + pad)} y={n(b.y + pad * 3.4 + bar + cardH)} width={n(b.w - pad * 2)} height={n(cardH * 0.7)} rx={1.2} />
      </g>
    );
  }
  // A page in a browser: a side column, a heading, and a hero.
  const side = b.w * 0.22;
  return (
    <g className="da-a-spread">
      <rect className="da-screen-card" x={n(b.x + pad)} y={n(b.y + pad)} width={n(side)} height={n(b.h - pad * 2)} rx={1} />
      <rect className="da-screen-ink" x={n(b.x + pad * 2 + side)} y={n(b.y + pad * 1.4)} width={n((b.w - side - pad * 3) * 0.7)} height={n(bar)} rx={n(bar / 2)} />
      <rect className="da-screen-card" x={n(b.x + pad * 2 + side)} y={n(b.y + pad * 2.4 + bar)} width={n(b.w - side - pad * 3)} height={n(b.h - pad * 3.4 - bar)} rx={1} />
    </g>
  );
}

/** A lit screen: the wallpaper gradient, then its interface. */
function Screen({ p, b, layout, r = 0.8 }: { p: Paint; b: Box; layout: Layout; r?: number }) {
  return (
    <>
      <rect className="da-mark" x={b.x} y={b.y} width={b.w} height={b.h} rx={r} fill={p.fill(0)} />
      <ScreenUi b={b} layout={layout} />
    </>
  );
}

/** Ruled lines of text from `b`'s top, `gap` apart, the last one short. */
function TextLines({ b, rows, gap }: { b: Box; rows: number; gap: number }) {
  let d = '';
  for (let i = 0; i < rows; i += 1) {
    const y = n(b.y + i * gap);
    if (i > 0 && y > b.y + b.h) break;
    d += `M${n(b.x)} ${y}H${n(b.x + b.w * (i === rows - 1 ? 0.55 : 1))}`;
  }
  return <path className="da-text-line" d={d} />;
}

/** A sheet of paper, or a card, lying on the plate with its own shadow. */
function Sheet({ b, r = 0.8 }: { b: Box; r?: number }) {
  return (
    <>
      <rect className="da-sheet-shadow" x={n(b.x + 0.4)} y={n(b.y + 1)} width={b.w} height={b.h} rx={r} />
      <rect className="da-paper" x={b.x} y={b.y} width={b.w} height={b.h} rx={r} />
    </>
  );
}

function frameScene(kind: FrameArtKind, width: number, height: number): Scene {
  return (p) => {
    switch (kind) {
      case 'desktop': {
        const b = fitBox(width, height, 42, 25, 20.5);
        const foot = b.y + b.h;
        return (
          <>
            <path className="da-bezel" d={`M30.4 ${n(foot)}h3.2l1.1 4.6h-5.4Z`} />
            <rect className="da-bezel" x={25} y={n(foot + 4.2)} width={14} height={1.6} rx={0.8} />
            <rect className="da-bezel" x={b.x} y={b.y} width={b.w} height={b.h} rx={1.6} />
            <Screen p={p} b={inset(b, 1.3)} layout="web" />
          </>
        );
      }
      case 'laptop': {
        const b = fitBox(width, height, 36, 24, 20.5);
        const base = b.y + b.h;
        return (
          <>
            <rect className="da-bezel" x={b.x} y={b.y} width={b.w} height={b.h} rx={1.8} />
            <Screen p={p} b={inset(b, 1.3, 1.6, 1.3)} layout="web" />
            <path className="da-bezel" d={`M${n(b.x - 4)} ${n(base)}H${n(b.x + b.w + 4)}l-1.6 2.6H${n(b.x - 2.4)}Z`} />
            <rect className="da-screen-card" x={29} y={n(base)} width={6} height={0.9} rx={0.45} />
          </>
        );
      }
      case 'tablet': {
        const b = fitBox(width, height, 38, 33);
        return (
          <>
            <rect className="da-bezel" x={b.x} y={b.y} width={b.w} height={b.h} rx={3} />
            <Screen p={p} b={inset(b, 1.9)} layout="tiles" r={1.4} />
          </>
        );
      }
      case 'phone': {
        const b = fitBox(width, height, 38, 34);
        const screen = inset(b, 1.2);
        return (
          <>
            <rect className="da-bezel" x={b.x} y={b.y} width={b.w} height={b.h} rx={3.4} />
            <Screen p={p} b={screen} layout="app" r={2.4} />
            <rect className="da-bezel" x={29.6} y={n(screen.y + 1)} width={4.8} height={1.5} rx={0.75} />
          </>
        );
      }
      case 'slide': {
        const b = fitBox(width, height, 44, 29);
        const t = inset(b, b.w * 0.09, b.h * 0.16);
        return (
          <>
            <Sheet b={b} r={1.2} />
            <rect className="da-mark da-a-reach" x={n(t.x)} y={n(t.y)} width={n(t.w * 0.62)} height={n(Math.max(2, b.h * 0.12))} rx={1} fill={p.fill(0)} />
            <TextLines b={{ x: t.x, y: t.y + b.h * 0.3, w: t.w * 0.48, h: t.h - b.h * 0.3 }} rows={3} gap={Math.max(2.2, b.h * 0.13)} />
            <rect className="da-mark da-a-pop" x={n(t.x + t.w * 0.58)} y={n(t.y + b.h * 0.24)} width={n(t.w * 0.42)} height={n(t.h - b.h * 0.24)} rx={1} fill={p.fill(1, 1)} />
          </>
        );
      }
      case 'square':
      case 'portrait':
      case 'story': {
        const b = fitBox(width, height, 40, 33);
        const story = kind === 'story';
        const img: Box = story ? b : { x: b.x, y: b.y, w: b.w, h: b.h * 0.72 };
        const r = story ? 2.4 : 1.2;
        return (
          <>
            <Sheet b={b} r={r} />
            <rect className="da-mark" x={img.x} y={img.y} width={img.w} height={img.h} rx={r} fill={p.fill(0, 1)} />
            <circle className="da-mark da-a-pop" cx={n(img.x + img.w * 0.7)} cy={n(img.y + img.h * 0.3)} r={n(Math.max(1.6, b.w * 0.09))} fill={p.fill(1)} />
            <path
              className="da-mark"
              fill={p.fill(2)}
              d={`M${n(img.x)} ${n(img.y + img.h)}L${n(img.x + img.w * 0.36)} ${n(img.y + img.h * 0.52)}L${n(img.x + img.w * 0.6)} ${n(img.y + img.h * 0.8)}L${n(img.x + img.w * 0.78)} ${n(img.y + img.h * 0.64)}L${n(img.x + img.w)} ${n(img.y + img.h * 0.92)}V${n(img.y + img.h)}Z`}
            />
            {story ? (
              [0, 1, 2].map((i) => (
                <rect
                  key={i}
                  className={i === 0 ? 'da-screen-ink' : 'da-screen-card'}
                  x={n(b.x + 1.4 + i * ((b.w - 2.8) / 3))}
                  y={n(b.y + 1.3)}
                  width={n((b.w - 2.8) / 3 - 0.8)}
                  height={0.9}
                  rx={0.45}
                />
              ))
            ) : (
              <>
                <circle className="da-mark" cx={n(b.x + 2.8)} cy={n(b.y + b.h * 0.86)} r={1.5} fill={p.fill(3)} />
                <TextLines b={{ x: b.x + 5.4, y: b.y + b.h * 0.86, w: b.w * 0.5, h: 0 }} rows={1} gap={0} />
              </>
            )}
          </>
        );
      }
      case 'video': {
        const b = fitBox(width, height, 44, 28);
        const r = Math.max(3, b.h * 0.2);
        const cy = b.y + b.h / 2;
        return (
          <>
            <rect className="da-mark" x={b.x} y={b.y} width={b.w} height={b.h} rx={1.6} fill={p.fill(3, 1)} />
            <circle className="da-mark da-a-pop" cx={32} cy={n(cy)} r={n(r)} fill={p.fill(4)} />
            <path className="da-play" d={`M${n(32 - r * 0.32)} ${n(cy - r * 0.45)}l${n(r * 0.8)} ${n(r * 0.45)}l${n(-r * 0.8)} ${n(r * 0.45)}Z`} />
            <rect className="da-screen-card" x={n(b.x + 2)} y={n(b.y + b.h - 2.6)} width={n(b.w - 4)} height={0.9} rx={0.45} />
            <rect className="da-screen-ink" x={n(b.x + 2)} y={n(b.y + b.h - 2.6)} width={n((b.w - 4) * 0.4)} height={0.9} rx={0.45} />
          </>
        );
      }
      case 'link': {
        const b = fitBox(width, height, 44, 22, 19);
        return (
          <>
            <Sheet b={{ x: b.x, y: b.y, w: b.w, h: b.h + 8 }} r={1.4} />
            <rect className="da-mark" x={b.x} y={b.y} width={b.w} height={b.h} rx={1.4} fill={p.fill(2, 1)} />
            <rect className="da-mark da-a-reach" x={n(b.x + 2.4)} y={n(b.y + b.h * 0.34)} width={n(b.w * 0.5)} height={n(Math.max(2, b.h * 0.16))} rx={1} fill={p.fill(0)} />
            <TextLines b={{ x: b.x + 2.4, y: b.y + b.h + 3, w: b.w * 0.7, h: 4 }} rows={2} gap={2.6} />
          </>
        );
      }
      case 'page': {
        const b = fitBox(width, height, 36, 34);
        const fold = Math.max(3, b.w * 0.2);
        const m = b.w * 0.16;
        const outline = (dx: number, dy: number) =>
          `M${n(b.x + dx)} ${n(b.y + dy)}h${n(b.w - fold)}l${n(fold)} ${n(fold)}V${n(b.y + b.h + dy)}H${n(b.x + dx)}Z`;
        return (
          <>
            <path className="da-sheet-shadow" d={outline(0.4, 1)} />
            <path className="da-paper" d={outline(0, 0)} />
            <path className="da-fold" d={`M${n(b.x + b.w - fold)} ${b.y}v${n(fold)}h${n(fold)}Z`} />
            <rect className="da-mark da-a-reach" x={n(b.x + m)} y={n(b.y + m)} width={n(b.w * 0.42)} height={n(Math.max(1.6, b.h * 0.07))} rx={0.8} fill={p.fill(0)} />
            <TextLines b={{ x: b.x + m, y: b.y + m + b.h * 0.18, w: b.w - m * 2, h: b.h - m * 2 - b.h * 0.18 }} rows={6} gap={Math.max(2.2, b.h * 0.1)} />
          </>
        );
      }
      case 'card': {
        const b = fitBox(width, height, 42, 26);
        return (
          <>
            <Sheet b={b} r={1.6} />
            <circle className="da-mark da-a-pop" cx={n(b.x + b.w * 0.2)} cy={n(b.y + b.h * 0.36)} r={n(Math.max(2, b.h * 0.15))} fill={p.fill(3)} />
            <TextLines b={{ x: b.x + b.w * 0.1, y: b.y + b.h * 0.66, w: b.w * 0.55, h: b.h * 0.3 }} rows={2} gap={Math.max(2.2, b.h * 0.14)} />
            <rect className="da-mark" x={n(b.x + b.w * 0.72)} y={n(b.y + b.h * 0.18)} width={n(b.w * 0.16)} height={n(b.w * 0.16)} rx={0.6} fill={p.fill(0, 2)} />
          </>
        );
      }
      default: {
        // Sized by hand: a dashed frame with its name tab and handles, as it looks mid-drag.
        const b: Box = { x: 14, y: 13, w: 34, h: 23 };
        const hs = 2.6;
        const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
        return (
          <>
            <rect className="da-frame-fill" x={b.x} y={b.y} width={b.w} height={b.h} />
            <rect className="da-dash" x={b.x} y={b.y} width={b.w} height={b.h} />
            <path className="da-text-line" d={`M${b.x} ${b.y - 3.4}h10`} />
            {corners.map(([x, y]) => (
              <rect key={`${x}-${y}`} className="da-handle" x={n(x - hs / 2)} y={n(y - hs / 2)} width={hs} height={hs} rx={0.5} />
            ))}
            <path className="da-cursor da-a-pop" d={`M${b.x + b.w + 0.6} ${b.y + b.h + 0.6}l6 2.3-2.5 1.1-1.1 2.5Z`} />
          </>
        );
      }
    }
  };
}

/**
 * A frame size as a lit tile. `width` and `height` are the preset's, used
 * only for proportion; `size` is the tile's width in pixels (it is 4:3).
 */
export const FrameArt = React.memo(function FrameArt({
  kind,
  width = 1,
  height = 1,
  size = 64,
}: {
  kind: FrameArtKind;
  width?: number;
  height?: number;
  size?: number;
}) {
  const scene = useMemo(() => frameScene(kind, width, height), [kind, width, height]);
  return <Tile scene={scene} size={size} kind={`frame-${kind}`} />;
});
