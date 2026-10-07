import React from 'react';
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartVertical,
  ArrowRight,
  ArrowRightToLine,
  Columns3,
  Hexagon,
  RectangleHorizontal,
  RectangleVertical,
  Rows3,
  Shrink,
  Star,
  UnfoldHorizontal,
} from 'lucide-react';
import { SubGroup } from '../panelPrimitives';
import { NumberField, Note, PairRow, Row, Section, SegmentedControl, Select, Switch } from '../grammar';
import {
  CALLOUT_TAILS,
  displayBounds,
  fromDisplay,
  paramSuffix,
  paramValue,
  shapeParamLabel,
  shapeParams,
  toDisplay,
} from '../../../engine/model/shapeParams';
import { EndCapIcon } from '../connectorIcons';
import { LineProfileIcon } from '../lineProfileIcons';
import { hasBend, isMultiPoint } from '../../../engine/model/polyline';
import {
  END_CAP_KINDS,
  END_CAP_LABELS,
  MAX_END_SCALE,
  MIN_END_SCALE,
  type EndAlign,
  type EndCapKind,
} from '../../../engine/model/connectorEnds';
import {
  LINE_PROFILES,
  LINE_PROFILE_LABELS,
  MAX_AMPLITUDE_SCALE,
  MAX_WAVES,
  MIN_AMPLITUDE_SCALE,
  MIN_WAVES,
  defaultEndAlign,
  dynamicWaves,
  type LineProfile,
} from '../../../engine/model/linePath';
import {
  MAX_POLYGON_SIDES,
  MAX_STAR_POINTS,
  MAX_STAR_RATIO,
  MIN_POLYGON_SIDES,
  MIN_STAR_POINTS,
  MIN_STAR_RATIO,
  type AnyNode,
} from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  LAYOUT_GUIDE_PRESETS,
  guideDraws,
  type LayoutAxis,
  type LayoutGuide,
} from '../../../engine/model/layoutGuide';
import {
  FRAME_PRESETS,
  FRAME_PRESET_GROUPS,
  framePreset,
  presetMatching,
  type FramePreset,
} from '../../../engine/model/frames';
import type { AffordanceId } from '../../../engine/selection/affordances';

const SAFE_EDGES = [
  { key: 'top', label: 'T', name: 'Top' },
  { key: 'right', label: 'R', name: 'Right' },
  { key: 'bottom', label: 'B', name: 'Bottom' },
  { key: 'left', label: 'L', name: 'Left' },
] as const;

interface ShapeGeometrySectionProps {
  node: AnyNode;
  uniformKind: boolean;
  openShape: boolean;
  affords: (id: AffordanceId) => boolean;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  setGeometry: (patch: Record<string, unknown>) => void;
  setSafeArea: (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => void;
  applyFramePreset: (preset: FramePreset) => void;
  turnFrame: () => void;
  fitFrameToContents: () => void;
  frameChildCount: number;
  setLayoutGuide: (guide: LayoutGuide | undefined) => void;
}

const AXES: {
  key: 'columns' | 'rows';
  label: string;
  hint: string;
  fallback: LayoutAxis;
  glyph: React.ReactNode;
}[] = [
  { key: 'columns', label: 'Columns', hint: 'Vertical tracks, dividing the width.', fallback: DEFAULT_COLUMNS, glyph: <Columns3 size={13} /> },
  {
    key: 'rows',
    label: 'Rows',
    hint: 'Horizontal tracks, dividing the height. A baseline rhythm more often than eight stacked boxes.',
    fallback: DEFAULT_ROWS,
    glyph: <Rows3 size={13} />,
  },
];

function sameGuide(a: LayoutGuide | undefined, b: LayoutGuide): boolean {
  const axis = (x: LayoutAxis | undefined, y: LayoutAxis | undefined) =>
    (!x && !y) || Boolean(x && y && x.count === y.count && x.gutter === y.gutter && x.margin === y.margin);
  return axis(a?.columns, b.columns) && axis(a?.rows, b.rows);
}

/**
 * The subject sections of a shape or frame: what makes this kind of object
 * what it is. Each appears only for the kind it belongs to.
 */
export const ShapeGeometrySection: React.FC<ShapeGeometrySectionProps> = ({
  node,
  uniformKind,
  openShape,
  affords,
  shared,
  setGeometry,
  setSafeArea,
  applyFramePreset,
  turnFrame,
  fitFrameToContents,
  frameChildCount,
  setLayoutGuide,
}) => {
  const params = node.type === 'shape' ? shapeParams(node.geometry.kind) : [];

  return (
    <>
      {uniformKind && node.type === 'shape' && openShape && (() => {
        const scale = shared((n) => (n.type === 'shape' ? n.geometry.endScale ?? 1 : null));
        return (
          <Section id="ends" title="Ends">
            <Row label="Head" hint="Whether the marker sits inside the line's length or projects past its end.">
              <SegmentedControl
                ariaLabel="Arrowhead alignment"
                fill
                mixed={shared((n) => (n.type === 'shape' ? n.geometry.endAlign ?? defaultEndAlign(n.geometry.lineProfile) : null)).mixed}
                value={node.geometry.endAlign ?? defaultEndAlign(node.geometry.lineProfile)}
                onChange={(v) => setGeometry({ endAlign: v as EndAlign })}
                segments={[
                  { value: 'inside', label: 'At the end', hint: 'The tip lands on the last point', icon: <ArrowRightToLine size={14} /> },
                  { value: 'extend', label: 'Past the end', hint: 'The line keeps its full length and the head projects', icon: <ArrowRight size={14} /> },
                ]}
              />
            </Row>
            <Row label="Size" hint="How big both markers are, relative to the stroke.">
              <NumberField
                label="End marker size"
                glyph="S"
                unit="%"
                min={MIN_END_SCALE * 100}
                max={MAX_END_SCALE * 100}
                step={25}
                value={scale.mixed ? 'mixed' : Math.round((scale.value ?? 1) * 100)}
                onChange={(v) => setGeometry({ endScale: v === 100 ? undefined : v / 100 })}
              />
            </Row>
            {(['endStart', 'endEnd'] as const).map((side) => (
              <Row
                stack
                key={side}
                label={side === 'endStart' ? 'Start' : 'End'}
                hint={side === 'endStart' ? 'What sits at the first end.' : 'What sits at the second end.'}
              >
                <SegmentedControl
                  ariaLabel={side === 'endStart' ? 'Start of the line' : 'End of the line'}
                  mixed={shared((n) => (n.type === 'shape' ? n.geometry[side] ?? 'none' : null)).mixed}
                  value={node.geometry[side] ?? 'none'}
                  onChange={(v) => setGeometry({ [side]: v as EndCapKind })}
                  segments={END_CAP_KINDS.map((kind) => ({
                    value: kind,
                    label: END_CAP_LABELS[kind],
                    icon: <EndCapIcon kind={kind} flip={side === 'endStart'} />,
                  }))}
                />
              </Row>
            ))}
          </Section>
        );
      })()}

      {uniformKind && node.type === 'shape' && openShape && (() => {
        const multiPoint = isMultiPoint(node.geometry.vertices) || hasBend(node.geometry.bends) || node.geometry.smooth === true;
        const profile = node.geometry.lineProfile ?? 'straight';
        const waves = shared((n) => {
          if (n.type !== 'shape') return null;
          if (typeof n.geometry.lineWaves === 'number') return n.geometry.lineWaves;
          if (n.geometry.a && n.geometry.b) {
            const dx = n.geometry.b.x - n.geometry.a.x;
            const dy = n.geometry.b.y - n.geometry.a.y;
            return dynamicWaves(Math.hypot(dx, dy), n.geometry.lineProfile);
          }
          return 6;
        });
        const amp = shared((n) => (n.type === 'shape' ? n.geometry.lineAmplitude ?? 1.0 : null));
        return (
          <Section id="line" title="Line">
            {multiPoint ? (
              <Note>
                This line takes its shape from its points. Round its corners from the floating toolbar, or open the
                point editor to bend one segment.
              </Note>
            ) : (
              <>
                <Row stack label="Style" hint="The shape the run makes on its way across. Every style takes the same ends, weight and dash.">
                  <SegmentedControl
                    ariaLabel="Line style"
                    mixed={shared((n) => (n.type === 'shape' ? n.geometry.lineProfile ?? 'straight' : null)).mixed}
                    value={profile}
                    onChange={(v) => setGeometry({ lineProfile: v === 'straight' ? undefined : (v as LineProfile) })}
                    segments={LINE_PROFILES.map((p) => ({
                      value: p,
                      label: LINE_PROFILE_LABELS[p],
                      hint: LINE_PROFILE_LABELS[p],
                      icon: <LineProfileIcon profile={p} />,
                    }))}
                  />
                </Row>
                {profile !== 'straight' && (
                  <PairRow>
                    {profile !== 'curved' ? (
                      <NumberField
                        label={profile === 'coil' ? 'Loops' : 'Repeats'}
                        glyph="N"
                        min={MIN_WAVES}
                        max={MAX_WAVES}
                        value={waves.mixed ? 'mixed' : waves.value ?? 6}
                        onChange={(v) => setGeometry({ lineWaves: v })}
                      />
                    ) : (
                      <span aria-hidden />
                    )}
                    <NumberField
                      label={profile === 'coil' ? 'Loop size' : profile === 'curved' ? 'Bow depth' : 'Wave height'}
                      glyph="A"
                      unit="%"
                      min={MIN_AMPLITUDE_SCALE * 100}
                      max={MAX_AMPLITUDE_SCALE * 100}
                      step={10}
                      value={amp.mixed ? 'mixed' : Math.round((amp.value ?? 1.0) * 100)}
                      onChange={(v) => setGeometry({ lineAmplitude: v === 100 ? undefined : v / 100 })}
                    />
                  </PairRow>
                )}
              </>
            )}
          </Section>
        );
      })()}

      {uniformKind && node.type === 'shape' && node.geometry.kind === 'star' && (
        <Section id="star" title="Star">
          <PairRow>
            <NumberField
              label="Points"
              glyph={<Star size={12} />}
              min={MIN_STAR_POINTS}
              max={MAX_STAR_POINTS}
              value={node.geometry.points ?? 5}
              onChange={(points) => setGeometry({ points })}
            />
            <NumberField
              label="Depth"
              glyph="D"
              unit="%"
              step={5}
              min={Math.round((1 - MAX_STAR_RATIO) * 100)}
              max={Math.round((1 - MIN_STAR_RATIO) * 100)}
              value={Math.round((1 - (node.geometry.innerRatio ?? 0.5)) * 100)}
              onChange={(depth) => setGeometry({ innerRatio: 1 - depth / 100 })}
            />
          </PairRow>
        </Section>
      )}

      {uniformKind && node.type === 'shape' && node.geometry.kind === 'polygon' && (
        <Section id="polygon" title="Polygon">
          <Row label="Sides">
            <NumberField
              label="Sides"
              glyph={<Hexagon size={12} />}
              min={MIN_POLYGON_SIDES}
              max={MAX_POLYGON_SIDES}
              value={node.geometry.points ?? 3}
              onChange={(points) => setGeometry({ points })}
            />
          </Row>
        </Section>
      )}

      {uniformKind && node.type === 'shape' && params.length > 0 && (
        <Section id="shape" title={shapeParamLabel(node.geometry.kind) ?? 'Shape'}>
          {params.map((param) => {
            const bounds = displayBounds(param);
            return (
              <Row key={param.field} label={param.label} hint={param.hint}>
                <NumberField
                  label={param.label}
                  glyph={param.label.charAt(0).toUpperCase()}
                  unit={paramSuffix(param)}
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  value={toDisplay(param, paramValue(node.geometry, param))}
                  onChange={(shown) => setGeometry({ [param.field]: fromDisplay(param, shown) })}
                />
              </Row>
            );
          })}
          {node.geometry.kind === 'callout' && (
            <Row stack label="Tail">
              <div className="tailpad" role="radiogroup" aria-label="Where the tail comes out">
                {CALLOUT_TAILS.map((tail) => {
                  const active = (node.geometry.tailPosition ?? 'bottom-left') === tail;
                  return (
                    <button
                      key={tail}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={tail.replace('-', ' ')}
                      className="tailpad__cell"
                      data-tail={tail}
                      data-active={active || undefined}
                      onClick={() => setGeometry({ tailPosition: tail })}
                    >
                      <span className="tailpad__dot" />
                    </button>
                  );
                })}
                <span className="tailpad__balloon" aria-hidden />
              </div>
            </Row>
          )}
        </Section>
      )}

      {affords('frame-preset') && node.type === 'frame' && (
        <Section id="frame" title="Frame" meta={presetMatching(node.width, node.height)?.label}>
          <Row label="Size" hint="Resize to a standard size. The frame keeps its top-left corner.">
            <Select
              label="Frame size"
              value={presetMatching(node.width, node.height)?.id ?? '__custom'}
              options={[
                ...(presetMatching(node.width, node.height) ? [] : [{ value: '__custom', label: 'Custom' }]),
                ...FRAME_PRESET_GROUPS.flatMap((group) =>
                  FRAME_PRESETS.filter((p) => p.group === group).map((p) => ({
                    value: p.id,
                    label: p.label,
                    detail: `${p.width} × ${p.height}`,
                    group,
                  }))
                ),
              ]}
              onChange={(id) => {
                const preset = framePreset(id);
                if (preset) applyFramePreset(preset);
              }}
            />
          </Row>
          <Row label="Orientation" hint="Swap width and height. The safe area is transposed with them.">
            <SegmentedControl
              ariaLabel="Frame orientation"
              fill
              disabledReason={node.width === node.height ? 'A square frame is the same either way up.' : undefined}
              value={node.height > node.width ? 'portrait' : 'landscape'}
              onChange={(next) => {
                const isPortrait = node.height > node.width;
                if ((next === 'portrait') === isPortrait) return;
                turnFrame();
              }}
              segments={[
                { value: 'portrait', label: 'Portrait', icon: <RectangleVertical size={14} /> },
                { value: 'landscape', label: 'Landscape', icon: <RectangleHorizontal size={14} /> },
              ]}
            />
          </Row>
          <button
            type="button"
            className="sketch-redraw"
            onClick={fitFrameToContents}
            disabled={frameChildCount === 0}
            data-tooltip={
              frameChildCount === 0
                ? 'Nothing in this frame to fit to'
                : `Fit to the ${frameChildCount} object${frameChildCount === 1 ? '' : 's'} inside`
            }
          >
            <Shrink size={13} aria-hidden="true" />
            Fit to contents
          </button>

          <SubGroup
            label="Measure"
            hint="Columns and rows drawn over the frame for placing things against. Never exported, and objects snap to them."
            on={Boolean(node.layoutGuide)}
            onToggle={(on) => setLayoutGuide(on ? { columns: DEFAULT_COLUMNS } : undefined)}
          >
            {node.layoutGuide && (
              <>
                <div className="grid-presets" role="group" aria-label="Measure preset">
                  {LAYOUT_GUIDE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="grid-preset"
                      data-active={sameGuide(node.layoutGuide, preset.guide) || undefined}
                      aria-pressed={sameGuide(node.layoutGuide, preset.guide)}
                      onClick={() => setLayoutGuide(preset.guide)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {AXES.map(({ key, label, hint, fallback, glyph }) => {
                  const axis = node.layoutGuide?.[key];
                  return (
                    <React.Fragment key={key}>
                      <Row label={label} hint={hint}>
                        <Switch
                          ariaLabel={`${label} measure`}
                          checked={Boolean(axis)}
                          onChange={(on) => setLayoutGuide({ ...node.layoutGuide, [key]: on ? fallback : undefined })}
                        />
                      </Row>
                      {axis && (
                        <PairRow>
                          <NumberField
                            label={`${label} count`}
                            glyph={glyph}
                            min={1}
                            max={48}
                            value={axis.count}
                            onChange={(count) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, count } })}
                          />
                          <NumberField
                            label={`Gutter between ${label.toLowerCase()}`}
                            glyph={<UnfoldHorizontal size={13} />}
                            unit="px"
                            min={0}
                            max={200}
                            value={axis.gutter}
                            onChange={(gutter) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, gutter } })}
                          />
                        </PairRow>
                      )}
                      {axis && (
                        <Row label="Align" hint="Stretch divides the space between the margins. Start, Centre and End give each track a fixed size and place the run.">
                          <SegmentedControl
                            ariaLabel={`${label} alignment`}
                            fill
                            value={axis.align ?? 'stretch'}
                            onChange={(v) => {
                              const align = v as NonNullable<LayoutAxis['align']>;
                              const size = align === 'stretch' ? axis.size : axis.size ?? 80;
                              setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, align: align === 'stretch' ? undefined : align, size } });
                            }}
                            segments={[
                              { value: 'stretch', label: 'Stretch', icon: <AlignHorizontalSpaceAround size={14} /> },
                              { value: 'start', label: 'Start', icon: <AlignStartVertical size={14} /> },
                              { value: 'center', label: 'Centre', icon: <AlignCenterVertical size={14} /> },
                              { value: 'end', label: 'End', icon: <AlignEndVertical size={14} /> },
                            ]}
                          />
                        </Row>
                      )}
                      {axis && (axis.align ?? 'stretch') !== 'stretch' && (
                        <Row label="Size" hint="Each track's width or height while the run is not stretched.">
                          <NumberField
                            label={`${label} track size`}
                            glyph="S"
                            unit="px"
                            min={1}
                            max={2000}
                            value={axis.size ?? 80}
                            onChange={(size) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, size } })}
                          />
                        </Row>
                      )}
                      {axis && (
                        <Row label="Margin" hint="Inset from the two edges this axis runs between. The first and last tracks start here.">
                          <NumberField
                            label={`${label} margin`}
                            glyph="M"
                            unit="px"
                            min={0}
                            max={400}
                            step={8}
                            value={axis.margin}
                            onChange={(margin) => setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, margin } })}
                          />
                        </Row>
                      )}
                    </React.Fragment>
                  );
                })}
                {!guideDraws(node, node.layoutGuide) && (
                  <Note>The gutters and margins come to more than the frame. Lower one of them, or reduce the count.</Note>
                )}
              </>
            )}
          </SubGroup>

          <Row stack label="Safe area" hint="Where content is guaranteed to survive. A guide only: nothing is clipped or moved, and it never appears in an export.">
            <PairRow>
              {SAFE_EDGES.slice(0, 2).map(({ key, label, name }) => (
                <NumberField
                  key={key}
                  label={`${name} safe area`}
                  glyph={label}
                  unit="px"
                  min={0}
                  step={8}
                  value={Math.round(node.safeArea?.[key] ?? 0)}
                  onChange={(v) => setSafeArea(key, v)}
                />
              ))}
            </PairRow>
            <PairRow>
              {SAFE_EDGES.slice(2).map(({ key, label, name }) => (
                <NumberField
                  key={key}
                  label={`${name} safe area`}
                  glyph={label}
                  unit="px"
                  min={0}
                  step={8}
                  value={Math.round(node.safeArea?.[key] ?? 0)}
                  onChange={(v) => setSafeArea(key, v)}
                />
              ))}
            </PairRow>
          </Row>
        </Section>
      )}
    </>
  );
};
