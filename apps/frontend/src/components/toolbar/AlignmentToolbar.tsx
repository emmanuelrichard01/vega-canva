import React from 'react';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
} from 'lucide-react';
import { RailPopover } from './RailPopover';
import { alignSelection, distributeSelection, type AlignEdge, type DistributeAxis } from '../../engine/model/align';
import type { AnyNode } from '../../engine/model/schema';

export const ALIGN_BUTTONS: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: 'left', label: 'Align left', icon: <AlignHorizontalJustifyStart size={16} /> },
  { edge: 'centerX', label: 'Align horizontal centres', icon: <AlignHorizontalJustifyCenter size={16} /> },
  { edge: 'right', label: 'Align right', icon: <AlignHorizontalJustifyEnd size={16} /> },
  { edge: 'top', label: 'Align top', icon: <AlignVerticalJustifyStart size={16} /> },
  { edge: 'middleY', label: 'Align vertical centres', icon: <AlignVerticalJustifyCenter size={16} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignVerticalJustifyEnd size={16} /> },
];

export interface AlignmentPopoverProps {
  nodes: AnyNode[];
  onApplyPatches: (patches: Array<{ id: string; changes: Record<string, unknown> }>) => void;
}

export const AlignmentPopover: React.FC<AlignmentPopoverProps> = ({ nodes, onApplyPatches }) => {
  const handleAlign = (edge: AlignEdge) => {
    const patches = alignSelection(nodes, edge);
    if (patches.length > 0) onApplyPatches(patches);
  };

  const handleDistribute = (axis: DistributeAxis) => {
    const patches = distributeSelection(nodes, axis);
    if (patches.length > 0) onApplyPatches(patches);
  };

  return (
    <RailPopover
      label="Align & distribute"
      trigger={<AlignHorizontalJustifyCenter size={16} />}
      align="start"
    >
      <span className="ctx-popover__label">Align</span>
      <div className="ctx-btn-row">
        {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
          <button
            key={edge}
            type="button"
            className="ctx-btn"
            aria-label={label}
            data-tooltip={label}
            onClick={() => handleAlign(edge)}
          >
            {icon}
          </button>
        ))}
      </div>
      {nodes.length >= 3 && (
        <>
          <span className="ctx-popover__label">Distribute</span>
          <div className="ctx-btn-row">
            <button
              type="button"
              className="ctx-btn"
              aria-label="Distribute horizontal spacing"
              data-tooltip="Distribute horizontal spacing"
              onClick={() => handleDistribute('horizontal')}
            >
              <AlignHorizontalSpaceAround size={16} />
            </button>
            <button
              type="button"
              className="ctx-btn"
              aria-label="Distribute vertical spacing"
              data-tooltip="Distribute vertical spacing"
              onClick={() => handleDistribute('vertical')}
            >
              <AlignVerticalSpaceAround size={16} />
            </button>
          </div>
        </>
      )}
    </RailPopover>
  );
};
