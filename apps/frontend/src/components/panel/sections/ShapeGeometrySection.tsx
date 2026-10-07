import React from 'react';
import {
  ArrowRight,
  ArrowRightToLine,
  Hexagon,
  Star,
} from 'lucide-react';
import { NumberField, Note, PairRow, Row, Section, SegmentedControl } from '../grammar';
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
import type { LayoutGuide } from '../../../engine/model/layoutGuide';
import type { AffordanceId } from '../../../engine/selection/affordances';
import { FrameSection } from './FrameSection';

interface ShapeGeometrySectionProps {
  node: AnyNode;
  uniformKind: boolean;
  openShape: boolean;
  affords: (id: AffordanceId) => boolean;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  setGeometry: (patch: Record<string, unknown>) => void;
  setSafeArea: (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => void;
  turnFrame: () => void;
  fitFrameToContents: () => void;
  frameChildCount: number;
  setLayoutGuide: (guide: LayoutGuide | undefined) => void;
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
        <FrameSection
          node={node}
          shared={shared}
          setSafeArea={setSafeArea}
          turnFrame={turnFrame}
          fitFrameToContents={fitFrameToContents}
          frameChildCount={frameChildCount}
          setLayoutGuide={setLayoutGuide}
        />
      )}
    </>
  );
};
