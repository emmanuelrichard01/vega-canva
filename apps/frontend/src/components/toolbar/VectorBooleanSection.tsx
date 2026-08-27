import React from 'react';
import { BOOLEAN_OPS, type BooleanOp } from '../../engine/model/pathBoolean';
import { RailButton } from './RailBase';
import { BOOLEAN_BUTTONS } from './railConstants';
import { booleanPreview } from '../../engine/interaction/booleanPreview';
import type { CompoundGeometry } from '../../engine/model/schema';

export type BooleanPlan = { geometry: CompoundGeometry } | { refusal: string };

export interface VectorBooleanSectionProps {
  booleanPlans: Record<BooleanOp, BooleanPlan>;
  onApplyBoolean: (op: BooleanOp) => void;
}

export const VectorBooleanSection: React.FC<VectorBooleanSectionProps> = ({
  booleanPlans,
  onApplyBoolean,
}) => {
  return (
    <>
      {BOOLEAN_OPS.map((op) => {
        const plan = booleanPlans[op];
        const blocked = 'refusal' in plan;
        return (
          <RailButton
            key={op}
            label={BOOLEAN_BUTTONS[op].label}
            disabled={blocked}
            hint={blocked ? plan.refusal : BOOLEAN_BUTTONS[op].label}
            onHover={(over) =>
              booleanPreview.set(over && !blocked ? plan.geometry : null)
            }
            onClick={() => {
              booleanPreview.set(null);
              onApplyBoolean(op);
            }}
          >
            {BOOLEAN_BUTTONS[op].icon}
          </RailButton>
        );
      })}
    </>
  );
};
