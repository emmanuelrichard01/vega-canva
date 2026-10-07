import React from 'react';
import { Group, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import type { IconNode } from '../../../engine/model/schema';
import { objectRegistry } from '../../../engine/objects/registry';
import { artFor, bitmapFor, drawArt, fitBox, tinted } from '../../../engine/icons/iconCache';
import { iconEntryNow, subscribeIconPacks } from '../../../engine/icons/iconPacks';
import { ICON_LABEL_GAP, ICON_LABEL_SIZE } from '../../../engine/icons/iconSvg';
import { useDarkTheme } from './useDarkTheme';

/**
 * A library icon on the canvas.
 *
 * One `Shape` with a `sceneFunc`: the artwork comes from the shared cache
 * (`engine/icons/iconCache.ts`), so two thousand instances of one icon are two
 * thousand `fill(Path2D)` calls over one parse, or, far out, two thousand
 * `drawImage` calls over one bitmap. The hit region is the node's rectangle,
 * which is what a person aiming at a small icon expects and is far cheaper
 * than hit-testing the artwork.
 *
 * The caption is a separate `Text` below the box. A missing pack or icon draws
 * a neutral placeholder, never nothing and never an error.
 */
objectRegistry.register({
  type: 'icon',
  capabilities: { supportsOpacity: true, supportsComments: true },
  defaultProperties: () => ({ width: 64, height: 64 }),
});

/**
 * Whether a `w` x `h` box under the context's current transform lands on the
 * canvas at all. Konva calls every shape's `sceneFunc` whether or not it is on
 * screen; for a board of thousands, skipping the off-screen ones is most of the
 * cost of a pan.
 */
function offCanvas(native: CanvasRenderingContext2D, w: number, h: number): boolean {
  const t = native.getTransform();
  const xs = [t.e, t.a * w + t.e, t.c * h + t.e, t.a * w + t.c * h + t.e];
  const ys = [t.f, t.b * w + t.f, t.d * h + t.f, t.b * w + t.d * h + t.f];
  return (
    Math.max(...xs) < 0 ||
    Math.max(...ys) < 0 ||
    Math.min(...xs) > native.canvas.width ||
    Math.min(...ys) > native.canvas.height
  );
}

/** Below this many device pixels an icon is drawn as a swatch. */
const SWATCH_PX = 14;
const PLACEHOLDER_FILL = '#e7e7ea';
const PLACEHOLDER_STROKE = '#9a9ca3';

export const IconRenderer: React.FC<{ node: IconNode }> = ({ node }) => {
  const { pack, iconId, colour, label, width: W, height: H } = node;
  const dark = useDarkTheme();
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const entry = iconEntryNow(pack, iconId);

  // Re-render once when the pack this icon waits on arrives.
  React.useEffect(() => {
    if (entry !== undefined) return;
    return subscribeIconPacks(() => {
      if (iconEntryNow(pack, iconId) !== undefined) bump();
    });
  }, [entry, pack, iconId]);

  const key = `${pack}:${iconId}`;
  const art = entry ? artFor(key, entry) : null;

  const sceneFunc = React.useCallback(
    (ctx: Konva.Context, shape: Konva.Shape) => {
      const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
      if (offCanvas(native, W, H)) return;
      if (!art) {
        const r = Math.min(W, H) * 0.12;
        native.beginPath();
        native.roundRect(0.5, 0.5, W - 1, H - 1, r);
        native.fillStyle = PLACEHOLDER_FILL;
        native.fill();
        native.strokeStyle = PLACEHOLDER_STROKE;
        native.lineWidth = 1;
        native.stroke();
        return;
      }
      // The context's transform already includes the stage scale and pixel ratio.
      const t = native.getTransform();
      const devPx = Math.max(W * Math.hypot(t.a, t.b), H * Math.hypot(t.c, t.d));
      // A few pixels across, detail cannot be seen: one flat swatch of its main colour.
      if (devPx < SWATCH_PX) {
        const main = art.layers.find((l) => l.f && l.f !== '#ffffff')?.f;
        if (main) {
          const fit = fitBox(art, W, H);
          native.fillStyle = tinted(main, colour);
          native.fillRect(fit.x, fit.y, fit.fw, fit.fh);
          return;
        }
      }
      const bmp = bitmapFor(key, art, colour, devPx, () => shape.getLayer()?.batchDraw());
      if (bmp) {
        const fit = fitBox(art, W, H);
        native.drawImage(bmp, fit.x, fit.y, fit.fw, fit.fh);
      } else {
        drawArt(native, art, W, H, colour);
      }
    },
    [art, key, colour, W, H],
  );

  const hitFunc = React.useCallback(
    (ctx: Konva.Context, shape: Konva.Shape) => {
      if (offCanvas((ctx as unknown as { _context: CanvasRenderingContext2D })._context, W, H)) return;
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.closePath();
      ctx.fillStrokeShape(shape);
    },
    [W, H],
  );

  const captionWidth = Math.max(W, 160);

  return (
    <Group>
      <Shape
        width={W}
        height={H}
        fill="#000"
        sceneFunc={sceneFunc}
        hitFunc={hitFunc}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
      />
      {label ? (
        <Text
          x={(W - captionWidth) / 2}
          y={H + ICON_LABEL_GAP}
          width={captionWidth}
          text={label}
          align="center"
          wrap="word"
          fontFamily="Inter, sans-serif"
          fontSize={ICON_LABEL_SIZE}
          lineHeight={1.25}
          fill={dark ? '#e7e7ea' : '#222427'}
          listening={false}
        />
      ) : null}
    </Group>
  );
};
