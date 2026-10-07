import React, { useSyncExternalStore } from 'react';
import { Trash2 } from 'lucide-react';
import { pathEdit } from '../../../engine/interaction/pathEdit';
import {
  alignPickedAnchors,
  deletePickedAnchor,
  setPickedAnchorMode,
} from '../../../engine/interaction/pathAnchorActions';
import type { PathNode } from '../../../engine/model/schema';
import { FillEditor } from '../../ui/FillEditor';
import { RailButton, VectorEditIcon } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { ALIGN_BUTTONS } from '../railConstants';
import { RailAnatomy, type RailVerb } from './anatomy';
import { CornerIcon, SketchControl, StrokeControl, SymmetricIcon } from './controls';
import { KindLabel } from './kind';
import { kindOf } from './kindOf';
import { drawnStrokeWidth } from './strokeDefaults';
import { appearanceOf, type SingleRail } from './types';

/** Point editing goes through the direct-select tool, which owns the anchor handles. */
function setTool(id: 'select' | 'direct-select') {
  window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: id }));
}

/**
 * A pen or boolean path.
 *
 * While its points are open the rail becomes the point editor: paint steps
 * aside, and the anchor tools take its place, acting on the picked points or,
 * with none picked, on all of them.
 */
export const VectorRail: SingleRail<PathNode> = ({ node, subject, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  const selection = useSyncExternalStore(pathEdit.subscribe, pathEdit.getSnapshot, pathEdit.getSnapshot);
  const editing = selection?.nodeId === node.id;
  const picked = selection?.anchors.length ?? 0;
  const kind = kindOf(node, subject);

  const toggleEditing = () => {
    if (editing) {
      pathEdit.exit();
      setTool('select');
    } else {
      setTool('direct-select');
      pathEdit.enter(node.id);
    }
  };

  const editButton: RailVerb = {
    id: 'points',
    controls: 1,
    node: (
      <RailButton
        label={editing ? 'Done editing points' : 'Edit points'}
        hint={editing ? 'Done editing points (Esc)' : 'Edit points (A)'}
        pressed={editing}
        onClick={toggleEditing}
      >
        <VectorEditIcon size={15} />
      </RailButton>
    ),
  };

  if (editing) {
    const scope = picked > 0 ? 'selected points' : 'all points';
    const verbs: RailVerb[] = [
      editButton,
      {
        id: 'corner',
        controls: 1,
        node: (
          <RailButton label="Corner" hint={`Make ${scope} sharp`} onClick={() => setPickedAnchorMode('corner')}>
            <CornerIcon rounded={false} />
          </RailButton>
        ),
      },
      {
        id: 'smooth',
        controls: 1,
        node: (
          <RailButton label="Smooth" hint={`Make ${scope} curved`} onClick={() => setPickedAnchorMode('smooth')}>
            <CornerIcon rounded />
          </RailButton>
        ),
      },
      {
        id: 'symmetric',
        controls: 1,
        node: (
          <RailButton
            label="Symmetric"
            hint={`Make ${scope} symmetric: equal handles either side`}
            onClick={() => setPickedAnchorMode('mirrored')}
          >
            <SymmetricIcon />
          </RailButton>
        ),
      },
    ];
    // Aligning needs two points to mean anything.
    if (picked > 1) {
      verbs.push({
        id: 'align',
        controls: 1,
        node: (
          <RailPopover label="Align points" trigger={ALIGN_BUTTONS[0].icon}>
            <span className="ctx-popover__label">Align {picked} points</span>
            <div className="ctx-shape-grid">
              {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
                <button
                  key={edge}
                  type="button"
                  className="ctx-shape-btn"
                  aria-label={label}
                  data-tooltip={label}
                  onClick={() => alignPickedAnchors(edge)}
                >
                  {icon}
                </button>
              ))}
            </div>
          </RailPopover>
        ),
      });
    }
    if (picked > 0) {
      verbs.push({
        id: 'delete',
        controls: 1,
        node: (
          <RailButton label="Delete points" hint="Remove selected points (Del)" onClick={() => deletePickedAnchor()}>
            <Trash2 size={15} />
          </RailButton>
        ),
      });
    }
    return (
      <RailAnatomy
        kind={<KindLabel icon={kind.icon} name={picked > 0 ? `${picked} ${picked === 1 ? 'point' : 'points'}` : kind.name} />}
        verbs={verbs}
        conditional={null}
        tail={tail}
        tailControls={tailControls}
      />
    );
  }

  return (
    <RailAnatomy
      kind={<KindLabel icon={kind.icon} name={kind.name} />}
      paint={
        <>
          <FillEditor paint={appearance.fill?.[0]} onChange={(fill) => setAppearance({ fill: [fill] })} />
          <StrokeControl appearance={appearance} width={drawnStrokeWidth(node)} onChange={setAppearance} />
        </>
      }
      paintControls={2}
      verbs={[editButton]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};

/**
 * A pencil stroke: its ink, and whether it is sketched.
 *
 * Sketching redraws it from its centreline as a line gone over twice, which is
 * a second way to draw rather than a filter over the first.
 */
export const FreehandRail: SingleRail<PathNode> = ({ node, subject, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  const kind = kindOf(node, subject);
  return (
    <RailAnatomy
      kind={<KindLabel icon={kind.icon} name={kind.name} />}
      paint={<StrokeControl appearance={appearance} width={drawnStrokeWidth(node)} onChange={setAppearance} />}
      paintControls={1}
      verbs={[
        { id: 'sketch', controls: 1, node: <SketchControl appearance={appearance} shades={false} onChange={setAppearance} /> },
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
