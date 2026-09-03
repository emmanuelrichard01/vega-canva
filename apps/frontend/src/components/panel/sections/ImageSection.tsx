import React from 'react';
import { Sliders } from 'lucide-react';
import { Accordion } from '../panelPrimitives';
import { Slider } from '../../ui/Slider';
import {
  ADJUSTMENT_IDS,
  ADJUSTMENT_LABELS,
  ADJUSTMENT_MIN,
  ADJUSTMENT_HINTS,
  ADJUSTMENT_UNITS,
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
      {/*
        Four sliders, and the differences between them are the design.

        `origin: 0` puts the fill's anchor at as-shot rather than at the bottom
        of the range, so the bar shows the *departure* — which is the quantity —
        instead of an absolute position on a scale nobody is thinking in. On
        blur, where zero is also the minimum, that is the same thing and the
        bar simply fills from the left.

        The only mark is the origin, and it is the one that carries something:
        as-shot is the value you keep coming back to and the one a double-click
        returns to, and it was the single position on the track you could not
        see. Marks at ±50 were tried and removed — three ticks cut a bar into
        four equal segments, which reads as four separate things rather than
        one continuous quantity, and "half a turn" is not a fact anybody needs
        pointing out.

        Shift gives a tenth of a step, which matters here more than anywhere
        else in the app: the whole 200-point range is about a hundred pixels of
        track, so a pixel of movement is two points and there was no way to ask
        for one.
      */}
      {ADJUSTMENT_IDS.map((id) => (
        <Slider
          key={id}
          label={ADJUSTMENT_LABELS[id]}
          hint={ADJUSTMENT_HINTS[id]}
          unit={ADJUSTMENT_UNITS[id]}
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
