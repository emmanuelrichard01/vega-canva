import React from 'react';
import { Lock, Move, Unlock } from 'lucide-react';
import { Accordion } from '../panelPrimitives';
import { NumberStepper } from '../../ui/NumberStepper';
import type { AnyNode } from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';

interface TransformSectionProps {
  bounds: { x: number; y: number; width: number; height: number } | null;
  node: AnyNode;
  aspectLocked: boolean;
  setAspectLocked: React.Dispatch<React.SetStateAction<boolean>>;
  resizeBlockedReason?: string;
  rotationShared: Shared<number | undefined>;
  setOrigin: (axis: 'x' | 'y', value: number) => void;
  resizeSelection: (axis: 'width' | 'height', value: number) => void;
  set: (updates: Partial<AnyNode>) => void;
  nudgeEach: (
    key: 'x' | 'y' | 'rotation' | 'opacity' | 'skewX' | 'skewY',
    delta: number,
    min?: number,
    max?: number
  ) => void;
  shared: <T>(read: (node: AnyNode) => T) => Shared<T>;
}

export const TransformSection: React.FC<TransformSectionProps> = ({
  bounds,
  node,
  aspectLocked,
  setAspectLocked,
  resizeBlockedReason,
  rotationShared,
  setOrigin,
  resizeSelection,
  set,
  nudgeEach,
  shared,
}) => {
  return (
    <Accordion title="Transform" icon={<Move size={13} />}>
      {/*
        Three inline grids became one class.

        They declared the same `1fr 28px 1fr` three times over, which is three
        places to change one column and three chances to change two of them.
        The middle track is the aspect lock's, and the empty span above it is
        what keeps X and Y on the same rail as W and H — that alignment is the
        whole reason the position row carries a gap it does not use.
      */}
      <div className="prop-grid prop-grid--linked">
        <NumberStepper value={Math.round(bounds?.x ?? node.x)} onChange={(v: number) => setOrigin('x', v)} label="X" suffix="px" />
        <span aria-hidden />
        <NumberStepper value={Math.round(bounds?.y ?? node.y)} onChange={(v: number) => setOrigin('y', v)} label="Y" suffix="px" />
      </div>
      <div className="prop-grid prop-grid--linked">
        <div style={{ minWidth: 0 }}>
          <NumberStepper
            value={Math.round(bounds?.width ?? node.width)}
            onChange={(v: number) => resizeSelection('width', v)}
            label="W"
            suffix="px"
            min={1}
            disabledReason={resizeBlockedReason}
          />
        </div>
        {/* Sized to the column it sits in. It was a default 32px `.btn-icon`
            inside a 26px track, so it overhung its own column by six pixels
            and crowded the height field beside it. */}
        <button
          className="btn-icon btn-icon--sm"
          onClick={() => setAspectLocked((v) => !v)}
          data-tooltip={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          aria-pressed={aspectLocked}
          style={{
            alignSelf: 'center',
            color: aspectLocked ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: aspectLocked ? 'var(--surface-hover)' : 'transparent',
          }}
        >
          {aspectLocked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <div style={{ minWidth: 0 }}>
          <NumberStepper
            value={Math.round(bounds?.height ?? node.height)}
            onChange={(v: number) => resizeSelection('height', v)}
            label="H"
            suffix="px"
            min={1}
            disabledReason={resizeBlockedReason}
          />
        </div>
      </div>
      {/*
        Rotation and skew on one line, which is what they are.

        Rotation sat alone in a two-column grid with an empty second half — a
        row deliberately half-blank, which reads as a control that failed to
        render rather than as a layout. All three are angles about the centre,
        so they belong together and the row says so by holding them.

        Rotation keeps the 15° step: it is the one angle people want on the
        eighths, and Shift already takes ten of them. Skew steps by 5, because
        a slant past about twenty degrees stops being a slant.
      */}
      <div className="prop-grid prop-grid--thirds">
        <NumberStepper
          value={Math.round(rotationShared.value ?? 0)}
          mixed={rotationShared.mixed}
          onChange={(v: number) => set({ rotation: v })}
          onNudge={(d: number) => nudgeEach('rotation', d)}
          label="R"
          suffix="deg"
          step={15}
        />
        {(['skewX', 'skewY'] as const).map((axis) => {
            const s = shared((n) => n[axis] ?? 0);
            return (
              <NumberStepper
                key={axis}
                value={Math.round(s.value ?? 0)}
                mixed={s.mixed}
                onChange={(v: number) => set({ [axis]: v === 0 ? undefined : v } as Partial<AnyNode>)}
                onNudge={(d: number) => nudgeEach(axis, d)}
                /* `S` for skew, with its axis — `X` alone beside `R` would be
                   the position field's letter on a row about angles. */
                label={axis === 'skewX' ? 'SX' : 'SY'}
                suffix="deg"
                min={-89} max={89}
                step={5}
              />
            );
        })}
      </div>
    </Accordion>
  );
};
