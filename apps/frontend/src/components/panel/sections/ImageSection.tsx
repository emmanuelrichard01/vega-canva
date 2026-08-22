import React from 'react';
import { Sliders } from 'lucide-react';
import { Accordion } from '../panelPrimitives';
import { Slider } from '../../ui/Slider';
import {
  ADJUSTMENT_IDS,
  ADJUSTMENT_LABELS,
  ADJUSTMENT_MIN,
  hasAdjustments,
  type AdjustmentId,
} from '../../../engine/model/imageAdjustments';
import type { AnyNode, ImageNode } from '../../../engine/model/schema';
import type { AffordanceId } from '../../../engine/selection/affordances';

interface ImageSectionProps {
  node: ImageNode;
  adjustments: Record<AdjustmentId, number>;
  affords: (id: AffordanceId) => boolean;
  setAdjustment: (id: AdjustmentId, value: number) => void;
  set: (updates: Partial<AnyNode>) => void;
}

export const ImageSection: React.FC<ImageSectionProps> = ({
  node,
  adjustments,
  affords,
  setAdjustment,
  set,
}) => {
  if (!affords('image-adjust') || node.type !== 'image') return null;

  return (
    <Accordion title="Adjust" icon={<Sliders size={13} />}>
      {ADJUSTMENT_IDS.map((id) => (
        <Slider
          key={id}
          label={ADJUSTMENT_LABELS[id]}
          value={adjustments[id]}
          min={ADJUSTMENT_MIN[id]}
          max={100}
          origin={0}
          onChange={(v) => setAdjustment(id, v)}
        />
      ))}
      {hasAdjustments(adjustments) && (
        <button
          type="button"
          className="adjustments__reset"
          onClick={() => set({ filters: undefined } as Partial<AnyNode>)}
        >
          Reset adjustments
        </button>
      )}
    </Accordion>
  );
};
