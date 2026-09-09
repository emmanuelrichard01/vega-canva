import React from 'react';
import { RailPopover } from './RailPopover';
import { ShapeIcon } from '../workspace/shapeIcons';
import { SHAPE_BY_PRESET, SHAPE_PRESETS, type ShapePreset } from '../workspace/shapeCatalog';
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
        {SHAPE_PRESETS.map((preset: ShapePreset) => {
          const geom = SHAPE_BY_PRESET[preset].geometry;
          const active = geom.kind === currentKind && (!geom.points || geom.points === currentPoints);
          return (
            <button
              key={preset}
              type="button"
              className="ctx-shape-chip"
              aria-pressed={active}
              aria-label={SHAPE_BY_PRESET[preset].label}
              data-tooltip={SHAPE_BY_PRESET[preset].label}
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
