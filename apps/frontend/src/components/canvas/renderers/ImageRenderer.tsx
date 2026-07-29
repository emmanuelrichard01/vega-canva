import React from 'react';
import { Image as KonvaImage, Rect } from 'react-konva';
import useImage from 'use-image';
import type { ImageNode } from '../../../engine/model/schema';

interface Props {
  node: ImageNode;
}

export const ImageRenderer: React.FC<Props> = React.memo(({ node }) => {
  const [image, status] = useImage(node.src, 'anonymous');

  // A broken or still-loading asset previously rendered nothing at all, which
  // is indistinguishable from the object having been deleted. A placeholder
  // keeps the object selectable and its bounds visible.
  if (status !== 'loaded' || !image) {
    return (
      <Rect
        width={node.width}
        height={node.height}
        fill="var(--surface-secondary)"
        stroke={status === 'failed' ? '#EF4444' : '#D1D5DB'}
        strokeWidth={1}
        dash={[6, 4]}
        cornerRadius={node.appearance?.cornerRadius ?? 0}
      />
    );
  }

  return (
    <KonvaImage
      image={image}
      width={node.width}
      height={node.height}
      // Konva clips natively to the corner radius; nothing read this before,
      // so rounding an image's corners had no visible effect.
      cornerRadius={node.appearance?.cornerRadius ?? 0}
    />
  );
});

ImageRenderer.displayName = 'ImageRenderer';
