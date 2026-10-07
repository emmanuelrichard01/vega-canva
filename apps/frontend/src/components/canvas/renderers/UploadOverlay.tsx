import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import { claimCursor } from '../../../engine/cursor';

/**
 * What an in-flight upload looks like on top of its picture.
 *
 * - **Uploading**: a hairline along the bottom edge that fills as the bytes
 *   go. It is drawn at a constant screen size, like every other piece of
 *   chrome, so it reads the same at any zoom.
 * - **Waiting for the network**: a quiet pill, "Uploads when online".
 * - **Refused**: a pill naming the reason, with Retry when this person can.
 *
 * Konva draws to a canvas and cannot read CSS tokens, and the overlay sits on
 * arbitrary photographs, so it uses a translucent ink plate with white text:
 * legible over any picture in either theme.
 */

interface Props {
  width: number;
  height: number;
  /** 0..1 while uploading, otherwise null. */
  fraction: number | null;
  failedReason: string | null;
  queued: boolean;
  onRetry?: () => void;
}

const PLATE = 'rgba(17, 19, 22, 0.78)';
const TRACK = 'rgba(17, 19, 22, 0.32)';
const INK = '#FFFFFF';
const FONT = 'Inter, system-ui, sans-serif';

export const UploadOverlay: React.FC<Props> = ({ width, height, fraction, failedReason, queued, onRetry }) => {
  const zoom = useCameraZoom() || 1;
  const px = (n: number) => n / zoom;

  if (fraction !== null) {
    const bar = px(3);
    const inset = px(8);
    const trackWidth = Math.max(0, width - inset * 2);
    if (trackWidth <= 0) return null;
    return (
      <Group listening={false}>
        <Rect x={inset} y={height - inset - bar} width={trackWidth} height={bar} cornerRadius={bar / 2} fill={TRACK} />
        <Rect
          x={inset}
          y={height - inset - bar}
          width={Math.max(bar, trackWidth * fraction)}
          height={bar}
          cornerRadius={bar / 2}
          fill={INK}
          shadowColor="rgba(0,0,0,0.4)"
          shadowBlur={px(2)}
        />
      </Group>
    );
  }

  const label = failedReason ? (onRetry ? 'Upload failed · Retry' : 'Upload failed') : queued ? 'Uploads when online' : null;
  if (!label) return null;

  const fontSize = px(12);
  const padX = px(10);
  const pillH = px(26);
  // An estimate is enough: Inter at 12px averages about 0.56em per glyph.
  const pillW = Math.min(width - px(16), label.length * fontSize * 0.56 + padX * 2);
  if (pillW <= px(40) || height < pillH + px(16)) return null;

  return (
    <Group
      x={px(8)}
      y={height - pillH - px(8)}
      listening={Boolean(onRetry)}
      onClick={(e) => {
        e.cancelBubble = true;
        onRetry?.();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onRetry?.();
      }}
      onMouseEnter={() => {
        if (onRetry) claimCursor('upload-retry', 'pointer');
      }}
      onMouseLeave={() => claimCursor('upload-retry', null)}
    >
      <Rect width={pillW} height={pillH} cornerRadius={pillH / 2} fill={PLATE} />
      <Text
        width={pillW}
        height={pillH}
        align="center"
        verticalAlign="middle"
        text={label}
        fontSize={fontSize}
        fontFamily={FONT}
        fontStyle="500"
        fill={INK}
        listening={false}
      />
    </Group>
  );
};
