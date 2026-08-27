import React from 'react';
import { Lock, Move, Unlock } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
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
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr)', gap: 'var(--space-2)', alignItems: 'center' }}>
        <NumberStepper value={Math.round(bounds?.x ?? node.x)} onChange={(v: number) => setOrigin('x', v)} label="X" />
        <span aria-hidden />
        <NumberStepper value={Math.round(bounds?.y ?? node.y)} onChange={(v: number) => setOrigin('y', v)} label="Y" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px minmax(0, 1fr)', gap: 'var(--space-2)', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <NumberStepper
            value={Math.round(bounds?.width ?? node.width)}
            onChange={(v: number) => resizeSelection('width', v)}
            label="W"
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
            min={1}
            disabledReason={resizeBlockedReason}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '6px', alignItems: 'center' }}>
        <NumberStepper
          value={Math.round(rotationShared.value ?? 0)}
          mixed={rotationShared.mixed}
          onChange={(v: number) => set({ rotation: v })}
          onNudge={(d: number) => nudgeEach('rotation', d)}
          label="R"
          suffix="deg"
          step={15}
        />
      </div>
      <Row stack label="Skew" hint="Slants the object about its centre, in degrees.">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '6px', width: '100%', alignItems: 'center' }}>
          {(['skewX', 'skewY'] as const).map((axis) => {
            const s = shared((n) => n[axis] ?? 0);
            return (
              <NumberStepper
                key={axis}
                value={Math.round(s.value ?? 0)}
                mixed={s.mixed}
                onChange={(v: number) => set({ [axis]: v === 0 ? undefined : v } as Partial<AnyNode>)}
                onNudge={(d: number) => nudgeEach(axis, d)}
                label={axis === 'skewX' ? 'X' : 'Y'}
                suffix="deg"
                min={-89} max={89}
                step={5}
              />
            );
          })}
        </div>
      </Row>
    </Accordion>
  );
};
