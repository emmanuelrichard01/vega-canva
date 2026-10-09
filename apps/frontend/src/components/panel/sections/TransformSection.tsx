import React, { useState } from 'react';
import { FlipHorizontal2, FlipVertical2, Lock, RotateCw, Unlock } from 'lucide-react';
import { IconToggle, NumberField, PairRow, Section } from '../grammar';
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
  flipped: { x: boolean; y: boolean; mixedX: boolean; mixedY: boolean };
  onFlip: (axis: 'x' | 'y') => void;
  /** Grid-slot or frame membership, shown under the geometry. */
  children?: React.ReactNode;
}

/**
 * Layout: where the object is and how big. First after the subject, as in
 * every design tool, because it is the most-read block in the panel.
 *
 * Every field scrubs by its letter. Values are written once per edit (Enter,
 * an arrow, or the end of a drag), so a scrub is one undo step. Skew is the
 * one advanced control: it shows when the selection is skewed, and otherwise
 * waits behind the section's ⋯.
 */
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
  flipped,
  onFlip,
  children,
}) => {
  const skewX = shared((n) => n.skewX ?? 0);
  const skewY = shared((n) => n.skewY ?? 0);
  const skewed = skewX.mixed || skewY.mixed || Boolean(skewX.value) || Boolean(skewY.value);
  const [skewAsked, setSkewAsked] = useState(false);
  const showSkew = skewed || skewAsked;
  return (
    <Section
      id="layout"
      title="Layout"
      menu={[
        {
          kind: 'item',
          id: 'skew',
          label: 'Show skew',
          checked: showSkew,
          disabled: skewed,
          onSelect: () => setSkewAsked((v) => !v),
        },
      ]}
    >
      <PairRow linked>
        <NumberField
          label="X position"
          glyph="X"
          value={Math.round(bounds?.x ?? node.x)}
          onChange={(v) => setOrigin('x', v)}
        />
        <span aria-hidden />
        <NumberField
          label="Y position"
          glyph="Y"
          value={Math.round(bounds?.y ?? node.y)}
          onChange={(v) => setOrigin('y', v)}
        />
      </PairRow>
      <PairRow linked>
        <NumberField
          label="Width"
          glyph="W"
          min={1}
          value={Math.round(bounds?.width ?? node.width)}
          disabledReason={resizeBlockedReason}
          onChange={(v) => resizeSelection('width', v)}
        />
        <IconToggle
          label={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          pressed={aspectLocked}
          onClick={() => setAspectLocked((v) => !v)}
        >
          {aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
        </IconToggle>
        <NumberField
          label="Height"
          glyph="H"
          min={1}
          value={Math.round(bounds?.height ?? node.height)}
          disabledReason={resizeBlockedReason}
          onChange={(v) => resizeSelection('height', v)}
        />
      </PairRow>
      <div className="pg-rotation-row">
        <NumberField
          label="Rotation"
          glyph={<RotateCw size={12} />}
          unit="deg"
          step={15}
          value={rotationShared.mixed ? 'mixed' : Math.round(rotationShared.value ?? 0)}
          onNudge={(d) => nudgeEach('rotation', d)}
          onChange={(v) => set({ rotation: v })}
        />
        <IconToggle
          label="Flip horizontal"
          pressed={flipped.x}
          mixed={flipped.mixedX}
          onClick={() => onFlip('x')}
        >
          <FlipHorizontal2 size={14} />
        </IconToggle>
        <IconToggle
          label="Flip vertical"
          pressed={flipped.y}
          mixed={flipped.mixedY}
          onClick={() => onFlip('y')}
        >
          <FlipVertical2 size={14} />
        </IconToggle>
      </div>
      {showSkew && (
        <PairRow>
          <NumberField
            label="Skew horizontal"
            glyph="SX"
            unit="deg"
            step={5}
            min={-89}
            max={89}
            value={skewX.mixed ? 'mixed' : Math.round(skewX.value ?? 0)}
            onNudge={(d) => nudgeEach('skewX', d)}
            onChange={(v) => set({ skewX: v === 0 ? undefined : v } as Partial<AnyNode>)}
          />
          <NumberField
            label="Skew vertical"
            glyph="SY"
            unit="deg"
            step={5}
            min={-89}
            max={89}
            value={skewY.mixed ? 'mixed' : Math.round(skewY.value ?? 0)}
            onNudge={(d) => nudgeEach('skewY', d)}
            onChange={(v) => set({ skewY: v === 0 ? undefined : v } as Partial<AnyNode>)}
          />
        </PairRow>
      )}
      {children}
    </Section>
  );
};
