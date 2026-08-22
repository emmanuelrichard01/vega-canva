import React from 'react';
import { PenLine } from 'lucide-react';
import { Accordion, Details, Row, StrokeStyleIcon } from '../panelPrimitives';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { FillStyleIcon, SketchLevelIcon } from '../sketchIcons';
import {
  DEFAULT_MITER_LIMIT,
  MAX_MITER_LIMIT,
  MIN_MITER_LIMIT,
  type Appearance,
  type FillStyle,
  type LineCap,
  type LineJoin,
  type SketchLevel,
  type Stroke,
  type StrokeAlign,
} from '../../../engine/model/schema';
import {
  STROKE_STYLE_IDS,
  STROKE_STYLE_LABELS,
  styleOf,
  type StrokeStyleId,
} from '../../../engine/model/strokeStyle';
import type { Shared } from '../../../engine/model/selection';

const ALIGN_BAND: Record<'inside' | 'center' | 'outside', { x: number; y: number; w: number; h: number }> = {
  inside: { x: 4, y: 3, w: 12, h: 6 },
  center: { x: 3, y: 2, w: 14, h: 8 },
  outside: { x: 2, y: 1, w: 16, h: 10 },
};

export const StrokeAlignIcon: React.FC<{ align: 'inside' | 'center' | 'outside' }> = ({ align }) => {
  const band = ALIGN_BAND[align];
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
      <rect x="3" y="2" width="14" height="8" fill="none" stroke="currentColor" strokeOpacity="0.3" />
      <rect
        x={band.x}
        y={band.y}
        width={band.w}
        height={band.h}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
};

export const StrokeCapIcon: React.FC<{ cap: LineCap }> = ({ cap }) => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    <line x1="14" y1="1" x2="14" y2="11" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
    <path d="M 4 6 L 14 6" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap={cap} />
  </svg>
);

export const StrokeJoinIcon: React.FC<{ join: LineJoin }> = ({ join }) => (
  <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
    <path
      d="M 3 11 L 3 4 L 17 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinejoin={join}
      strokeLinecap="butt"
      strokeMiterlimit={10}
    />
  </svg>
);

interface StrokeSectionProps {
  capabilities: {
    supportsStroke?: boolean;
    supportsFill?: boolean;
    supportsEdgeEffects?: boolean;
  };
  appearance: Appearance | undefined;
  sketchable: boolean;
  allClosed: boolean;
  openShape: boolean;
  hasCorners: boolean;
  hasEnds: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  setStroke: (patch: Partial<Pick<Stroke, 'color' | 'width' | 'align' | 'join' | 'miterLimit' | 'cap'>>) => void;
  setStrokeStyle: (style: StrokeStyleId) => void;
  setAppearance: (patch: Partial<Appearance>) => void;
}

export const StrokeSection: React.FC<StrokeSectionProps> = ({
  capabilities,
  appearance,
  sketchable,
  allClosed,
  openShape,
  hasCorners,
  hasEnds,
  sharedPaint,
  setStroke,
  setStrokeStyle,
  setAppearance,
}) => {
  if (!capabilities.supportsStroke || !appearance) return null;

  return (
    <Accordion
      title="Stroke"
      icon={<PenLine size={13} />}
      defaultOpen={Boolean(appearance.stroke?.width || appearance.sketch)}
    >
      {capabilities.supportsFill && (
        <Row label="Color">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ColorPickerPopover
              color={appearance.stroke?.color ?? 'transparent'}
              mixed={sharedPaint((a) => a.stroke?.color ?? 'transparent').mixed}
              onChange={(color) => setStroke({ color })}
            />
            <EyedropperButton
              label="Pick a stroke colour from the screen"
              onPick={(color) => setStroke({ color })}
            />
          </div>
        </Row>
      )}

      <Row label="Weight" hint="Thickness of the outline, in pixels. Zero removes it.">
        {(() => {
          const strokeWidth = sharedPaint((a) => a.stroke?.width ?? 0);
          return (
            <NumberStepper
              value={strokeWidth.value ?? 0}
              mixed={strokeWidth.mixed}
              onChange={(width) => setStroke({ width })}
              min={0}
              max={100}
            />
          );
        })()}
      </Row>

      <Row label="Style" hint="Solid, dashed or dotted. The pattern scales with the weight so it stays legible.">
        <SegmentedControl
          ariaLabel="Stroke style"
          mixed={sharedPaint((a) => styleOf(a.stroke)).mixed}
          value={styleOf(appearance.stroke)}
          onChange={(id) => setStrokeStyle(id as StrokeStyleId)}
          segments={STROKE_STYLE_IDS.map((id) => ({
            value: id,
            label: STROKE_STYLE_LABELS[id],
            icon: <StrokeStyleIcon style={id} />,
          }))}
        />
      </Row>

      {sketchable && appearance && (
        <Row stack label="Sketch" hint="Draw this by hand. The result is stable and never re-randomises.">
          {(() => {
            const sketch = sharedPaint((a) => a.sketch ?? 'off');
            return (
              <SegmentedControl
                ariaLabel="Hand-drawn sketch"
                mixed={sketch.mixed}
                value={String(sketch.value ?? 'off')}
                onChange={(v) =>
                  setAppearance({ sketch: v === 'off' ? undefined : (v as SketchLevel) })
                }
                segments={[
                  { value: 'off', label: 'Off — a ruled shape', icon: <SketchLevelIcon level="off" /> },
                  { value: 'light', label: 'Light — one confident pass', icon: <SketchLevelIcon level="light" /> },
                  { value: 'medium', label: 'Medium — drawn twice', icon: <SketchLevelIcon level="medium" /> },
                  { value: 'heavy', label: 'Heavy — twice, and past every corner', icon: <SketchLevelIcon level="heavy" /> },
                ]}
              />
            );
          })()}
        </Row>
      )}

      {sketchable && capabilities.supportsFill && appearance?.sketch && allClosed && (
        <Row label="Shading" hint="How the inside is filled: flat colour, or pen strokes laid across it.">
          {(() => {
            const style = sharedPaint((a) => a.fillStyle ?? 'solid');
            return (
              <SegmentedControl
                ariaLabel="Sketch fill style"
                mixed={style.mixed}
                value={String(style.value ?? 'solid')}
                onChange={(v) =>
                  setAppearance({ fillStyle: v === 'solid' ? undefined : (v as FillStyle) })
                }
                segments={[
                  { value: 'solid', label: 'Solid — a flat fill', icon: <FillStyleIcon style="solid" /> },
                  { value: 'hachure', label: 'Hachure — parallel pen strokes', icon: <FillStyleIcon style="hachure" /> },
                  { value: 'crosshatch', label: 'Cross-hatch — two sets, crossed', icon: <FillStyleIcon style="crosshatch" /> },
                ]}
              />
            );
          })()}
        </Row>
      )}

      <Details label="Line detail">
        {capabilities.supportsEdgeEffects && !openShape && (
          <Row label="Align" hint="Where the line sits relative to the shape's edge.">
            <SegmentedControl
              ariaLabel="Stroke alignment"
              mixed={sharedPaint((a) => a.stroke?.align ?? 'center').mixed}
              value={appearance.stroke?.align ?? 'center'}
              onChange={(align) => setStroke({ align: align as StrokeAlign })}
              segments={[
                { value: 'inside', label: 'Inside', icon: <StrokeAlignIcon align="inside" /> },
                { value: 'center', label: 'Center', icon: <StrokeAlignIcon align="center" /> },
                { value: 'outside', label: 'Outside', icon: <StrokeAlignIcon align="outside" /> },
              ]}
            />
          </Row>
        )}

        {capabilities.supportsStroke && (
          <Row stack label="Cap" hint="How the two ends of an open line are finished.">
            <SegmentedControl
              ariaLabel="Line cap"
              disabledReason={
                styleOf(appearance.stroke) === 'dotted'
                  ? 'A dotted line is drawn entirely from round caps — that is what makes the dots. Switch to Solid or Dashed to set a cap.'
                  : !hasEnds
                    ? 'A solid closed outline has no ends. Use a line or an open path, or add a dash — every dash has two ends of its own.'
                    : undefined
              }
              mixed={sharedPaint((a) => a.stroke?.cap ?? 'butt').mixed}
              value={appearance.stroke?.cap ?? 'butt'}
              onChange={(cap) => setStroke({ cap: cap as LineCap })}
              segments={[
                { value: 'butt', label: 'Flat', icon: <StrokeCapIcon cap="butt" /> },
                { value: 'round', label: 'Round', icon: <StrokeCapIcon cap="round" /> },
                { value: 'square', label: 'Square', icon: <StrokeCapIcon cap="square" /> },
              ]}
            />
          </Row>
        )}

        {capabilities.supportsStroke && (
          <Row stack label="Join" hint="How two straight edges meet at a corner.">
            <SegmentedControl
              ariaLabel="Line join"
              disabledReason={hasCorners ? undefined : 'This shape has no straight corners — a rounded or curved edge has no join.'}
              mixed={sharedPaint((a) => a.stroke?.join ?? 'miter').mixed}
              value={appearance.stroke?.join ?? 'miter'}
              onChange={(join) => setStroke({ join: join as LineJoin })}
              segments={[
                { value: 'miter', label: 'Miter', icon: <StrokeJoinIcon join="miter" /> },
                { value: 'round', label: 'Round', icon: <StrokeJoinIcon join="round" /> },
                { value: 'bevel', label: 'Bevel', icon: <StrokeJoinIcon join="bevel" /> },
              ]}
            />
          </Row>
        )}

        {capabilities.supportsStroke && (
          <Row label="Miter" hint="How far a sharp corner may extend before it is cut flat. Only a miter join has one.">
            {(() => {
              const limit = sharedPaint((a) => a.stroke?.miterLimit ?? DEFAULT_MITER_LIMIT);
              return (
                <NumberStepper
                  value={limit.value ?? DEFAULT_MITER_LIMIT}
                  mixed={limit.mixed}
                  onChange={(miterLimit) => setStroke({ miterLimit })}
                  min={MIN_MITER_LIMIT}
                  max={MAX_MITER_LIMIT}
                  disabledReason={
                    !hasCorners
                      ? 'This shape has no straight corners.'
                      : (appearance.stroke?.join ?? 'miter') !== 'miter'
                        ? 'Only a miter join has a limit. Switch Join to Miter to set one.'
                        : undefined
                  }
                />
              );
            })()}
          </Row>
        )}
      </Details>
    </Accordion>
  );
};
