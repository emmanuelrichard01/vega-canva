import React from 'react';
import { Minus, PenLine, Spline, UnfoldHorizontal } from 'lucide-react';
import { Accordion, Row, StrokeStyleIcon } from '../panelPrimitives';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import {
  DEFAULT_MITER_LIMIT,
  MAX_MITER_LIMIT,
  MIN_MITER_LIMIT,
  type Appearance,
  type LineCap,
  type LineJoin,
  type Stroke,
  type StrokeAlign,
} from '../../../engine/model/schema';
import {
  DASH_PRESET,
  MAX_DASH_RATIO,
  STROKE_STYLE_IDS,
  STROKE_STYLE_LABELS,
  dashRatioOf,
  styleOf,
  type DashRatio,
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
  openShape: boolean;
  hasCorners: boolean;
  hasEnds: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  setStroke: (patch: Partial<Pick<Stroke, 'color' | 'width' | 'align' | 'join' | 'miterLimit' | 'cap'>>) => void;
  setStrokeStyle: (style: StrokeStyleId) => void;
  setDashRatio: (ratio: DashRatio) => void;
}

export const StrokeSection: React.FC<StrokeSectionProps> = ({
  capabilities,
  appearance,
  openShape,
  hasCorners,
  hasEnds,
  sharedPaint,
  setStroke,
  setStrokeStyle,
  setDashRatio,
}) => {
  if (!capabilities.supportsStroke || !appearance) return null;

  const style = styleOf(appearance.stroke);
  // The weight the pattern is measured against. Matches `patternWeight` in
  // `strokeStyle`, because a field showing a length derived from a clamped
  // weight has to clamp the same way or the number it shows is not the number
  // that was drawn.
  const weight = Math.max(1, appearance.stroke?.width ?? 0);
  const ratio: DashRatio = dashRatioOf(appearance.stroke) ?? DASH_PRESET.dashed!;
  const clampRatio = (n: number) => Math.min(MAX_DASH_RATIO, Math.max(0, n));

  return (
    <Accordion
      title="Stroke"
      icon={<PenLine size={13} />}
      defaultOpen={Boolean(appearance.stroke?.width || appearance.sketch)}
    >
      {capabilities.supportsFill && (
        <Row label="Color">
          <div className="prop-inline">
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

      {/*
        Weight and pattern, on one line.

        They are not two settings that happen to be adjacent — the dash is
        *derived from the weight* (`dashFor`), so a three-on two-off pattern is
        three times whatever this field says. Changing one changes what the
        other draws, and reading them apart hides the only relationship in the
        section.
      */}
      <div className="prop-grid">
        {(() => {
          const strokeWidth = sharedPaint((a) => a.stroke?.width ?? 0);
          return (
            <NumberStepper
              aria-label="Stroke weight"
              glyph={<Minus size={13} strokeWidth={3} />}
              suffix="px"
              value={strokeWidth.value ?? 0}
              mixed={strokeWidth.mixed}
              onChange={(width) => setStroke({ width })}
              min={0}
              max={100}
            />
          );
        })()}
        <SegmentedControl
          ariaLabel="Stroke style"
          fill
          mixed={sharedPaint((a) => styleOf(a.stroke)).mixed}
          value={styleOf(appearance.stroke)}
          onChange={(id) => setStrokeStyle(id as StrokeStyleId)}
          segments={STROKE_STYLE_IDS.map((id) => ({
            value: id,
            label: STROKE_STYLE_LABELS[id],
            icon: <StrokeStyleIcon style={id} />,
          }))}
        />
      </div>

      {/*
        The dash, once there is one.

        Three presets are the way in — "4,2,1,2" is a thing you tune after you
        already know what you want, not a thing you pick from — but they were
        also the way *out*, and a dashed line whose dashes are the wrong length
        had nowhere to go.

        Shown in pixels, because that is the length you are setting and what
        every other field in this section is in. What is *kept* is the
        proportion to the weight, so the section's own promise — the pattern
        scales with the weight so it stays legible — stays true for a pattern
        somebody shaped, which is precisely where an absolute array would have
        quietly repealed it. Change the weight and these two numbers move with
        it, which is the promise being visible rather than merely claimed.

        A dot has no length, so a dotted line offers only its gap.
      */}
      {style !== 'solid' && (
        <div className="prop-grid">
          {style === 'dashed' ? (
            <NumberStepper
              aria-label="Dash length"
              glyph={<StrokeStyleIcon style="dashed" />}
              suffix="px"
              value={Math.round(ratio.on * weight * 10) / 10}
              onChange={(px) => setDashRatio({ ...ratio, on: clampRatio(px / weight) })}
              min={0}
              max={Math.round(MAX_DASH_RATIO * weight)}
              step={1}
            />
          ) : (
            <span className="prop-note prop-note--inline">Dots have no length.</span>
          )}
          <NumberStepper
            aria-label="Gap between dashes"
            glyph={<UnfoldHorizontal size={13} />}
            suffix="px"
            value={Math.round(ratio.off * weight * 10) / 10}
            onChange={(px) => setDashRatio({ ...ratio, off: clampRatio(px / weight) })}
            min={1}
            max={Math.round(MAX_DASH_RATIO * weight)}
            step={1}
          />
        </div>
      )}

      {/*
        Line detail, out of its disclosure.

        It held align, cap, join and the miter limit behind a "Line detail"
        toggle, which is a reasonable instinct — four rows for settings most
        boards never touch. It was the wrong call for two reasons. Cap and Join
        are not obscure: rounding the dashes on a rectangle is one of the
        commonest things anybody wants here, and it was two clicks and a
        guessable label away. And a disclosure whose contents are *conditional*
        can be empty — on a shape with no corners and no ends, opening it
        showed a greyed-out list, so the affordance promised something it could
        not deliver.

        Flat, with a rule to say the group has changed subject. The controls
        that do not apply are still disabled with a reason, which is what makes
        them safe to show: a greyed control that explains itself teaches the
        model, and a hidden one teaches nothing.
      */}
      <div className="prop-rule" role="presentation" />
        {capabilities.supportsEdgeEffects && !openShape && (
          <Row label="Align" hint="Where the line sits relative to the shape's edge.">
            <SegmentedControl
              ariaLabel="Stroke alignment"
              fill
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

        {/* Cap and Join sit beside their labels, not under them. Three segments
            divide the 136px column at 45px each — well past a segment's natural
            32 — so stacking bought nothing and cost a row of height each. */}
        {capabilities.supportsStroke && (
          <Row label="Cap" hint="How the two ends of an open line are finished.">
            <SegmentedControl
              ariaLabel="Line cap"
              fill
              disabledReason={
                styleOf(appearance.stroke) === 'dotted'
                  ? 'A dotted line is drawn entirely from round caps, which is what makes the dots. Switch to Solid or Dashed to set a cap.'
                  : !hasEnds
                    ? 'A solid closed outline has no ends. Use a line or an open path, or add a dash, since every dash has two ends of its own.'
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
          <Row label="Join" hint="How two straight edges meet at a corner.">
            <SegmentedControl
              ariaLabel="Line join"
              fill
              disabledReason={hasCorners ? undefined : 'This shape has no straight corners, and a rounded or curved edge has no join.'}
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
                  aria-label="Miter limit"
                  glyph={<Spline size={13} />}
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
    </Accordion>
  );
};
