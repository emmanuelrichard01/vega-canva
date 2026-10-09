import React from 'react';
import { boardSurface, textSurface } from '../../../engine/model/textSurface';
import type { TextNode, Typography } from '../../../engine/model/schema';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { RailAnatomy } from './anatomy';
import { FontControl, TextStyleControl } from './text';
import { textVerbs } from './textVerbs';
import { updateNode, type SingleRail } from './types';

/**
 * A text object leads with its style (Title to Caption) and its font (family
 * and size, the size scrubs; weight in the popover), then its colour, bold,
 * slant, paragraph (alignment and lists) and effects.
 */
export const TextRail: SingleRail<TextNode> = ({ node, conditional, tail, tailControls }) => {
  const typography = node.typography;
  const set = (patch: Partial<Typography>) => updateNode(node.id, { typography: { ...typography, ...patch } });
  return (
    <RailAnatomy
      kind={
        <>
          <TextStyleControl typography={typography} set={set} />
          <FontControl typography={typography} set={set} />
        </>
      }
      kindControls={2}
      paint={
        <ColorPickerPopover
          color={typography.color}
          onChange={(color) => set({ color })}
          contrastAgainst={textSurface(node, boardSurface())}
        />
      }
      paintControls={1}
      verbs={textVerbs(typography, set)}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
