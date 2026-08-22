import React from 'react';
import { RailPopover } from './RailPopover';
import {
  SHAPE_KINDS,
  PRESET_GEOMETRY,
  SHAPE_LABELS,
  ShapeIcon,
  type ShapePreset,
} from '../workspace/shapeIcons';
import type { ShapeNode } from '../../engine/model/schema';

export interface ShapeSwapperProps {
  node: ShapeNode;
  onSwap: (geometry: { kind: any; points?: number }) => void;
}

export const ShapeSwapper: React.FC<ShapeSwapperProps> = ({ node, onSwap }) => {
  const currentKind = node.geometry?.kind;
  const currentPoints = node.geometry?.points;

  return (
    <RailPopover
      label="Change shape"
      align="start"
      trigger={<ShapeIcon kind={(currentKind as ShapePreset) || 'rect'} size={15} />}
    >
      <span className="ctx-popover__label">Change shape</span>
      <div className="ctx-shape-grid">
        {SHAPE_KINDS.map((preset: ShapePreset) => {
          const geom = PRESET_GEOMETRY[preset];
          const active = geom.kind === currentKind && (!geom.points || geom.points === currentPoints);
          return (
            <button
              key={preset}
              type="button"
              className="ctx-shape-chip"
              aria-pressed={active}
              aria-label={SHAPE_LABELS[preset]}
              data-tooltip={SHAPE_LABELS[preset]}
              onClick={() => {
                onSwap({
                  kind: geom.kind,
                  points: geom.points,
                });
              }}
            >
              <ShapeIcon kind={preset} size={18} />
            </button>
          );
        })}
      </div>
    </RailPopover>
  );
};
