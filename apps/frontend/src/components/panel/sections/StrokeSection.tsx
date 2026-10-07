import React, { useContext, useSyncExternalStore } from 'react';
import { Minus, Spline, UnfoldHorizontal } from 'lucide-react';
import { StrokeStyleIcon } from '../panelPrimitives';
import { ColorChip, NumberField, Note, PairRow, PanelSubjectContext, Row, Section, SegmentedControl } from '../grammar';
import { isSectionOpen, setSectionOpen, subscribeSections } from '../grammar/sectionState';
import { EyedropperButton } from '../../ui/EyedropperButton';
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

/**
 * Where the line sits against the edge, drawn as a band around the outline.
 * The faint rectangle is the shape's own edge.
 */
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
      <rect x={band.x} y={band.y} width={band.w} height={band.h} fill="none" stroke="currentColor" strokeWidth="2" />
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

const DEFAULT_STROKE_COLOR = '#1F2937';

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
  setAppearance: (patch: Partial<Appearance>) => void;
}

/**
 * Stroke: the outline, as a list of one.
 *
 * With no stroke the section is its header and `+`. With one: colour, then
 * weight beside pattern (the dash is a multiple of the weight, so they are
 * read together), then alignment. Cap, join and miter limit are behind the
 * section's ⋯, and appear on their own once any of them is set. A line-like object always has a
 * stroke, because the stroke is the object; it never offers to remove it.
 */
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
  setAppearance,
}) => {
  const subject = useContext(PanelSubjectContext);
  const readDetails = () => isSectionOpen(subject, 'stroke-details', false);
  const detailsWanted = useSyncExternalStore(subscribeSections, readDetails, readDetails);

  if (!capabilities.supportsStroke || !appearance) return null;

  const removable = Boolean(capabilities.supportsFill);
  const widthShared = sharedPaint((a) => a.stroke?.width ?? 0);
  const empty = removable && !widthShared.mixed && !(appearance.stroke && appearance.stroke.width > 0);

  const style = styleOf(appearance.stroke);
  const weight = Math.max(1, appearance.stroke?.width ?? 0);
  const ratio: DashRatio = dashRatioOf(appearance.stroke) ?? DASH_PRESET.dashed!;
  const clampRatio = (n: number) => Math.min(MAX_DASH_RATIO, Math.max(0, n));
  const colour = sharedPaint((a) => a.stroke?.color ?? 'transparent');
  const miter = sharedPaint((a) => a.stroke?.miterLimit ?? DEFAULT_MITER_LIMIT);
  const onLength = sharedPaint((a) => Math.round((dashRatioOf(a.stroke) ?? DASH_PRESET.dashed!).on * Math.max(1, a.stroke?.width ?? 0) * 10) / 10);
  const offLength = sharedPaint((a) => Math.round((dashRatioOf(a.stroke) ?? DASH_PRESET.dashed!).off * Math.max(1, a.stroke?.width ?? 0) * 10) / 10);
  const capShared = sharedPaint((a) => a.stroke?.cap ?? 'butt');
  const joinShared = sharedPaint((a) => a.stroke?.join ?? 'miter');
  /** Cap, Join and Miter: shown on request, or whenever one is already set. */
  const customised =
    capShared.mixed || joinShared.mixed || miter.mixed ||
    (capShared.value ?? 'butt') !== 'butt' ||
    (joinShared.value ?? 'miter') !== 'miter' ||
    (miter.value ?? DEFAULT_MITER_LIMIT) !== DEFAULT_MITER_LIMIT;
  const showDetails = detailsWanted || customised;

  return (
    <Section
      id="stroke"
      title="Stroke"
      empty={empty}
      onAdd={empty ? () => setStroke({ color: appearance.stroke?.color ?? DEFAULT_STROKE_COLOR, width: 2 }) : undefined}
      addLabel="Add stroke"
      menu={[
        {
          kind: 'item',
          id: 'details',
          label: 'Line ends and corners',
          checked: showDetails,
          disabled: customised,
          disabledReason: customised ? 'Shown while a cap, join or miter limit is set' : undefined,
          onSelect: () => setSectionOpen(subject, 'stroke-details', !detailsWanted),
        },
      ]}
    >
      {capabilities.supportsFill && (
        <div className="pg-list-item">
          <ColorChip
            label="Stroke"
            value={colour.mixed ? 'mixed' : appearance.stroke?.color ?? 'transparent'}
            allowNone={false}
            onChange={(color) => setStroke({ color })}
          />
          <EyedropperButton label="Pick a stroke colour from the screen" onPick={(color) => setStroke({ color })} />
          {removable && (
            <button
              type="button"
              className="pg-icon-btn"
              aria-label="Remove stroke"
              data-tooltip="Remove stroke"
              onClick={() => setAppearance({ stroke: undefined })}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <PairRow>
        <NumberField
          label="Stroke weight"
          glyph={<Minus size={13} strokeWidth={3} />}
          unit="px"
          min={0}
          max={100}
          value={widthShared.mixed ? 'mixed' : widthShared.value ?? 0}
          onChange={(width) => setStroke({ width })}
        />
        <SegmentedControl
          ariaLabel="Stroke style"
          fill
          mixed={sharedPaint((a) => styleOf(a.stroke)).mixed}
          value={style}
          onChange={(id) => setStrokeStyle(id as StrokeStyleId)}
          segments={STROKE_STYLE_IDS.map((id) => ({
            value: id,
            label: STROKE_STYLE_LABELS[id],
            icon: <StrokeStyleIcon style={id} />,
          }))}
        />
      </PairRow>

      {style !== 'solid' && (
        <PairRow>
          {style === 'dashed' ? (
            <NumberField
              label="Dash length"
              glyph={<StrokeStyleIcon style="dashed" />}
              unit="px"
              min={0}
              max={Math.round(MAX_DASH_RATIO * weight)}
              value={onLength.mixed ? 'mixed' : Math.round(ratio.on * weight * 10) / 10}
              onChange={(px) => setDashRatio({ ...ratio, on: clampRatio(px / weight) })}
            />
          ) : (
            <Note>Dots have no length.</Note>
          )}
          <NumberField
            label="Gap between dashes"
            glyph={<UnfoldHorizontal size={13} />}
            unit="px"
            min={1}
            max={Math.round(MAX_DASH_RATIO * weight)}
            value={offLength.mixed ? 'mixed' : Math.round(ratio.off * weight * 10) / 10}
            onChange={(px) => setDashRatio({ ...ratio, off: clampRatio(px / weight) })}
          />
        </PairRow>
      )}

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

      {showDetails && (<>
      <Row label="Cap" hint="How the two ends of an open line are finished.">
        <SegmentedControl
          ariaLabel="Line cap"
          fill
          disabledReason={
            style === 'dotted'
              ? 'A dotted line is drawn entirely from round caps, which is what makes the dots. Switch to Solid or Dashed to set a cap.'
              : !hasEnds
                ? 'A solid closed outline has no ends. Use a line or an open path, or add a dash, since every dash has two ends of its own.'
                : undefined
          }
          mixed={capShared.mixed}
          value={appearance.stroke?.cap ?? 'butt'}
          onChange={(cap) => setStroke({ cap: cap as LineCap })}
          segments={[
            { value: 'butt', label: 'Flat', icon: <StrokeCapIcon cap="butt" /> },
            { value: 'round', label: 'Round', icon: <StrokeCapIcon cap="round" /> },
            { value: 'square', label: 'Square', icon: <StrokeCapIcon cap="square" /> },
          ]}
        />
      </Row>

      <Row label="Join" hint="How two straight edges meet at a corner.">
        <SegmentedControl
          ariaLabel="Line join"
          fill
          disabledReason={hasCorners ? undefined : 'This shape has no straight corners, and a rounded or curved edge has no join.'}
          mixed={joinShared.mixed}
          value={appearance.stroke?.join ?? 'miter'}
          onChange={(join) => setStroke({ join: join as LineJoin })}
          segments={[
            { value: 'miter', label: 'Miter', icon: <StrokeJoinIcon join="miter" /> },
            { value: 'round', label: 'Round', icon: <StrokeJoinIcon join="round" /> },
            { value: 'bevel', label: 'Bevel', icon: <StrokeJoinIcon join="bevel" /> },
          ]}
        />
      </Row>

      <Row label="Miter" hint="How far a sharp corner may extend before it is cut flat. Only a miter join has one.">
        <NumberField
          label="Miter limit"
          glyph={<Spline size={13} />}
          min={MIN_MITER_LIMIT}
          max={MAX_MITER_LIMIT}
          value={miter.mixed ? 'mixed' : miter.value ?? DEFAULT_MITER_LIMIT}
          onChange={(miterLimit) => setStroke({ miterLimit })}
          disabledReason={
            !hasCorners
              ? 'This shape has no straight corners.'
              : (appearance.stroke?.join ?? 'miter') !== 'miter'
                ? 'Only a miter join has a limit. Switch Join to Miter to set one.'
                : undefined
          }
        />
      </Row>
      </>)}
    </Section>
  );
};
