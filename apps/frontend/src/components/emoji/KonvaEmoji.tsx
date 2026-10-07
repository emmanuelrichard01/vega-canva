import React, { useCallback, useSyncExternalStore } from 'react';
import { Image as KImage, Text } from 'react-konva';
import { engineEvents } from '../../engine/EventBus';
import { cameraSystem } from '../../engine/CameraSystem';
import { codeOf } from '../../engine/emoji/emojiCode';
import { bucketFor, emojiBitmap, emojiCanvasEpoch } from '../../engine/emoji/emojiCanvas';

const subscribeCamera = (fn: () => void) => engineEvents.on('CameraChanged', fn);

/**
 * The raster bucket an emoji `worldSize` units square needs right now.
 *
 * Subscribed through the bucket rather than the zoom, so a board full of
 * stamped notes re-renders its emoji only when a zoom crosses a bucket edge —
 * a handful of times across the whole zoom range — instead of on every frame
 * of a pinch.
 */
export function useEmojiBucket(worldSize: number): number {
  const read = useCallback(() => {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return bucketFor(worldSize * cameraSystem.zoom * dpr);
  }, [worldSize]);
  return useSyncExternalStore(subscribeCamera, read, read);
}

interface Props {
  native: string;
  x?: number;
  y?: number;
  /** World units, square. */
  size: number;
  opacity?: number;
}

/**
 * An emoji on the canvas, crisp at any zoom.
 *
 * Draws the shared raster from `emojiCanvas`; until it arrives nothing is
 * drawn (the fetch is a few milliseconds and a glyph flashing first would be
 * worse), and if the artwork does not exist the platform glyph is drawn in its
 * place so the stamp is never silently empty.
 */
export const KonvaEmoji: React.FC<Props> = React.memo(({ native, x = 0, y = 0, size, opacity }) => {
  const bucket = useEmojiBucket(size);
  useSyncExternalStore(emojiCanvasEpoch.subscribe, emojiCanvasEpoch.get, emojiCanvasEpoch.get);
  const { image, failed } = emojiBitmap(codeOf(native), bucket);
  if (image) {
    return <KImage image={image} x={x} y={y} width={size} height={size} opacity={opacity} listening={false} perfectDrawEnabled={false} />;
  }
  if (!failed) return null;
  return (
    <Text
      text={native}
      x={x}
      y={y}
      width={size}
      height={size}
      fontSize={size * 0.84}
      align="center"
      verticalAlign="middle"
      opacity={opacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
});

KonvaEmoji.displayName = 'KonvaEmoji';
