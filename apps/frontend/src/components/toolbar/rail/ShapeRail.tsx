import React from 'react';
import { Type } from 'lucide-react';
import { requestEditOnMount } from '../../../engine/interaction/pendingEdit';
import { boardSurface, textSurface } from '../../../engine/model/textSurface';
import { DEFAULT_TYPOGRAPHY, type ShapeNode, type Typography } from '../../../engine/model/schema';
import { FillEditor } from '../../ui/FillEditor';
import { RailButton } from '../RailBase';
import { RailAnatomy, type RailVerb } from './anatomy';
import { CornerRadiusControl, SketchControl, StrokeControl } from './controls';
import { ShapeKindChip } from './kind';
import { LabelStyleControl } from './text';
import { drawnStrokeWidth } from './strokeDefaults';
import { appearanceOf, updateNode, type SingleRail } from './types';

/**
 * A closed shape: what it is, its paint, its words, and how it is drawn.
 *
 * The label gets one control. Empty, it offers to add one; with words in it, it
 * opens everything a text object has, so the shape's rail stays about the shape.
 */
export const ShapeRail: SingleRail<ShapeNode> = ({ node, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  const typography: Typography = node.typography ?? DEFAULT_TYPOGRAPHY;
  const setTypography = (patch: Partial<Typography>) =>
    updateNode(node.id, { typography: { ...typography, ...patch } });
  const hasLabel = Boolean(node.text && node.text.length > 0);

  const verbs: RailVerb[] = [
    hasLabel
      ? {
          id: 'label',
          controls: 1,
          node: (
            <LabelStyleControl
              typography={typography}
              set={setTypography}
              surface={textSurface(node, boardSurface())}
            />
          ),
        }
      : {
          id: 'label',
          controls: 1,
          node: (
            <RailButton label="Add text" hint="Type inside this shape (Enter)" onClick={() => requestEditOnMount(node.id)}>
              <Type size={16} />
            </RailButton>
          ),
        },
    { id: 'sketch', controls: 1, node: <SketchControl appearance={appearance} shades onChange={setAppearance} /> },
  ];
  if (node.geometry.kind === 'rect') {
    verbs.push({
      id: 'radius',
      controls: 1,
      node: <CornerRadiusControl appearance={appearance} onChange={setAppearance} />,
    });
  }

  return (
    <RailAnatomy
      kind={<ShapeKindChip node={node} />}
      kindControls={1}
      paint={
        <>
          {/* The panel's own fill editor, so a gradient survives a trip through the rail. */}
          <FillEditor paint={appearance.fill?.[0]} onChange={(fill) => setAppearance({ fill: [fill] })} />
          <StrokeControl appearance={appearance} width={drawnStrokeWidth(node)} onChange={setAppearance} />
        </>
      }
      paintControls={2}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
