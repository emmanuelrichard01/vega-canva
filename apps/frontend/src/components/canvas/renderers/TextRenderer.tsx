import React from 'react';
import { Text } from 'react-konva';
import type { TextNode } from '../../../engine/model/schema';
import { konvaFontStyle, konvaTextDecoration } from './shared';

interface Props {
  node: TextNode;
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  visible: boolean;
}

export const TextRenderer: React.FC<Props> = React.memo(({ node, visible }) => {
  if (!visible) return null;

  return (
    <Text
      text={node.text}
      width={node.width}
      fontSize={node.typography.fontSize}
      fontFamily={node.typography.fontFamily}
      // Weight and slant are composed into Konva's single fontStyle string in
      // exactly one place — see shared.ts.
      fontStyle={konvaFontStyle(node.typography)}
      textDecoration={konvaTextDecoration(node.typography)}
      fill={node.typography.color}
      align={node.typography.align}
      lineHeight={node.typography.lineHeight}
      letterSpacing={node.typography.letterSpacing}
    />
  );
});

TextRenderer.displayName = 'TextRenderer';
