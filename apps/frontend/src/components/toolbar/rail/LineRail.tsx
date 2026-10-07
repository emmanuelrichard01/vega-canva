import React, { useSyncExternalStore } from 'react';
import { Radius, Type, Waypoints } from 'lucide-react';
import { lineEdit } from '../../../engine/interaction/lineEdit';
import { setLineCurved } from '../../../engine/interaction/lineVertexActions';
import { requestEditOnMount } from '../../../engine/interaction/pendingEdit';
import { isMultiPoint } from '../../../engine/model/polyline';
import type { ShapeNode } from '../../../engine/model/schema';
import { RailButton } from '../RailBase';
import { RailAnatomy, type RailVerb } from './anatomy';
import { SketchControl, StrokeControl } from './controls';
import { ShapeKindChip } from './kind';
import { drawnStrokeWidth } from './strokeDefaults';
import { appearanceOf, type SingleRail } from './types';

/**
 * A line or arrow: its run, its points and its label.
 *
 * Point editing is on double-click and Ctrl+Enter by convention; the button is
 * how anyone finds out a line can have more than two points.
 */
export const LineRail: SingleRail<ShapeNode> = ({ node, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  const lineSelection = useSyncExternalStore(lineEdit.subscribe, lineEdit.getSnapshot, lineEdit.getSnapshot);
  const editing = lineSelection?.nodeId === node.id;
  const curved = node.geometry.smooth === true;

  const verbs: RailVerb[] = [
    {
      id: 'points',
      controls: 1,
      node: (
        <RailButton
          label={editing ? 'Done editing points' : 'Edit points'}
          hint={editing ? 'Done editing points (Esc)' : 'Edit points: add corners and curves (⏎)'}
          pressed={editing}
          onClick={() => (editing ? lineEdit.end(node.id) : lineEdit.begin(node.id))}
        >
          <Waypoints size={16} />
        </RailButton>
      ),
    },
  ];
  // Only once there is a corner to round: a two-point line has none.
  if (isMultiPoint(node.geometry.vertices)) {
    verbs.push({
      id: 'curve',
      controls: 1,
      node: (
        <RailButton
          label={curved ? 'Sharpen corners' : 'Round corners'}
          hint={curved ? 'Give the corners back' : 'Draw the run as one smooth curve'}
          pressed={curved}
          onClick={() => setLineCurved(node, !curved)}
        >
          <Radius size={16} />
        </RailButton>
      ),
    });
  }
  verbs.push(
    {
      id: 'label',
      controls: 1,
      node: (
        <RailButton
          label={node.text ? 'Edit label' : 'Add label'}
          hint={node.text ? 'Edit label' : 'Add a label to this line'}
          onClick={() => requestEditOnMount(node.id)}
        >
          <Type size={15} />
        </RailButton>
      ),
    },
    { id: 'sketch', controls: 1, node: <SketchControl appearance={appearance} shades={false} onChange={setAppearance} /> }
  );

  return (
    <RailAnatomy
      kind={<ShapeKindChip node={node} />}
      kindControls={1}
      paint={<StrokeControl appearance={appearance} width={drawnStrokeWidth(node)} onChange={setAppearance} />}
      paintControls={1}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
