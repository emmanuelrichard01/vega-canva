import React, { useEffect, useMemo } from 'react';
import { SquaresUnite } from 'lucide-react';
import { RailPopover } from './RailPopover';
import { BOOLEAN_BUTTONS } from './railConstants';
import { booleanPreview } from '../../engine/interaction/booleanPreview';
import { applyBoolean, previewBoolean, type BooleanPlan } from '../../engine/document/vectorOps';
import { BOOLEAN_OPS, type BooleanOp } from '../../engine/model/pathBoolean';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import type { AnyNode, Appearance } from '../../engine/model/schema';
import '../arrange/arrange.css';

/**
 * Combine shapes: union, subtract, intersect and exclude.
 *
 * Each one draws its exact result on the board while it is pointed at or
 * focused, from the same geometry the press commits, so the outline is the
 * answer rather than a guess from four similar icons. Each one that cannot
 * apply says why. A selection that holds things no outline can be made of (a
 * note, an image) shows the panel with every operation off and the reason,
 * rather than quietly combining the shapes it can and leaving the rest.
 *
 * Destructive, and labelled so: the result is one new path and the operands
 * are removed, in one undo step.
 */

/**
 * What decides a combine's answer for one node: where it is, how it is turned,
 * its outline and its corner radius. Selections with the same key get the
 * same plans, so moving across the list never re-clips polygons.
 */
const planKeyOf = (n: AnyNode | undefined): string =>
  n
    ? JSON.stringify([
        n.id,
        n.x,
        n.y,
        n.width,
        n.height,
        n.rotation,
        n.scaleX,
        n.scaleY,
        n.zIndex,
        n.locked,
        'geometry' in n ? n.geometry : null,
        (n as { appearance?: Appearance }).appearance?.cornerRadius ?? null,
      ])
    : '';

const CombineList: React.FC<{ ids: readonly string[]; blocked: string | null; close: () => void }> = ({ ids, blocked, close }) => {
  const key = useStore((s) => (blocked ? '' : ids.map((id) => planKeyOf(s.objects[id])).join('|')));
  const plans = useMemo(
    () =>
      blocked
        ? null
        : (Object.fromEntries(BOOLEAN_OPS.map((op) => [op, previewBoolean(op, ids)])) as Record<BooleanOp, BooleanPlan>),
    // The key is the geometry; `ids` is part of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, blocked]
  );
  // The preview must not outlive the panel that drew it.
  useEffect(() => () => booleanPreview.set(null), []);

  const count = ids.length;
  return (
    <div className="arr-panel">
      {blocked && <p className="ctx-popover__note arr-note">{blocked}</p>}
      <div className="rail-list" role="group" aria-label="Combine" onPointerLeave={() => booleanPreview.set(null)}>
        {BOOLEAN_OPS.map((op) => {
          const plan = plans?.[op];
          const refusal = blocked ?? (plan && 'refusal' in plan ? plan.refusal : null);
          const preview = plan && 'geometry' in plan ? plan.geometry : null;
          return (
            <button
              key={op}
              type="button"
              className="rail-list__item"
              disabled={Boolean(refusal)}
              data-tooltip={refusal && !blocked ? refusal : undefined}
              onPointerEnter={() => booleanPreview.set(preview)}
              onFocus={() => booleanPreview.set(preview)}
              onBlur={() => booleanPreview.set(null)}
              onClick={() => {
                booleanPreview.set(null);
                const id = applyBoolean(op, ids);
                if (id) editor.select(id);
                close();
              }}
            >
              {BOOLEAN_BUTTONS[op].icon}
              <span className="rail-list__label">{BOOLEAN_BUTTONS[op].label}</span>
            </button>
          );
        })}
      </div>
      {!blocked && (
        <p className="ctx-popover__note arr-note">
          Replaces the {count} {count === 1 ? 'object' : 'objects'} with one path. Undo brings them back.
        </p>
      )}
    </div>
  );
};

export interface CombineControlProps {
  ids: readonly string[];
  /** Why nothing here can combine, when the selection holds something without an outline. */
  blocked: string | null;
}

/** The rail's Combine trigger. Nothing is planned until it opens. */
export const CombineControl: React.FC<CombineControlProps> = ({ ids, blocked }) => (
  <RailPopover label="Combine shapes" trigger={<SquaresUnite size={16} />} align="start">
    {(close) => <CombineList ids={ids} blocked={blocked} close={close} />}
  </RailPopover>
);
