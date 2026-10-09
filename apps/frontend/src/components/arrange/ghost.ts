import type React from 'react';
import { arrangeGhost } from '../../engine/arrange/preview';
import { isPlan, type Plan } from '../../engine/arrange/plans';

/** What a plan would look like on the board, or nothing when it would change nothing. */
export function ghostOf(plan: Plan) {
  if (!isPlan(plan) || plan.patches.length === 0) return null;
  return { boxes: plan.landed, reference: plan.reference };
}

/**
 * Pointing at a control, or reaching it from the keyboard, draws its result on
 * the board; leaving takes it away. Keyboard focus counts only when visible, so
 * a click does not leave a ghost behind once the pointer moves on.
 */
export function ghostHandlers(plan: Plan): Pick<
  React.HTMLAttributes<HTMLElement>,
  'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur'
> {
  return {
    onPointerEnter: () => arrangeGhost.set(ghostOf(plan)),
    onPointerLeave: () => arrangeGhost.set(null),
    onFocus: (e) => {
      if (e.currentTarget.matches(':focus-visible')) arrangeGhost.set(ghostOf(plan));
    },
    onBlur: () => arrangeGhost.set(null),
  };
}

/** Why a control is off, or what it would do: the tooltip a plan earns. */
export function planHint(plan: Plan, label: string, done: string): string {
  if (!isPlan(plan)) return plan.reason;
  return plan.patches.length === 0 ? done : label;
}
