import React from 'react';
import { Text } from 'react-konva';
import type { TextNode } from '../../../engine/model/schema';
import { applyTextCase } from '../../../engine/model/textCase';
import { konvaFontStyle, konvaTextDecoration, shadowProps } from './shared';

interface Props {
  node: TextNode;
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  visible: boolean;
}

export const TextRenderer: React.FC<Props> = React.memo(({ node, visible }) => {
  if (!visible) return null;

  /**
   * What the box does with its contents, expressed as Konva props.
   *
   * - **Auto width** gets no `width` at all. Konva sizes a `Text` to its
   *   longest line when none is given, and `wrap="none"` stops it breaking —
   *   which together is what "the box is as wide as the words" means.
   * - **Auto height** wraps inside the width you set and grows downward, so
   *   the height comes from the content and is not imposed here.
   * - **Fixed** imposes both. Text that does not fit is truncated with an
   *   ellipsis rather than spilling out of the box, because the alternative is
   *   glyphs drawn outside the selection rectangle that nothing can catch a
   *   click on and no export accounts for.
   */
  const box =
    node.resize === 'width'
      ? { wrap: 'none' as const }
      : node.resize === 'fixed'
        ? {
            width: node.width,
            height: node.height,
            wrap: 'word' as const,
            ellipsis: true,
            // Only meaningful once a height is imposed — with no height Konva
            // has no box to align within, which is why this had no effect on a
            // text node before.
            verticalAlign: node.typography.verticalAlign,
          }
        : { width: node.width, wrap: 'word' as const };

  return (
    // No spread: growing a glyph's silhouette by stroking it would fatten the
    // letterforms rather than the shadow, so `supportsShadowSpread` is false
    // for text.
    <Text
      // Transformed here and never in the document: the stored string stays
      // what the author typed, so switching to upper case and back is lossless
      // and the editor keeps showing the real text.
      text={applyTextCase(node.text, node.typography.textCase)}
      {...shadowProps(node.appearance)}
      {...box}
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
