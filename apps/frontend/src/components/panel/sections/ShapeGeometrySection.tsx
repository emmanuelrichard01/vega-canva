import React from 'react';
import {
  ArrowRight,
  ArrowRightToLine,
  Frame,
  Hexagon,
  Minus,
  MoveRight,
  Star,
} from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EndCapIcon } from '../connectorIcons';
import { LineProfileIcon } from '../lineProfileIcons';
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
  MAX_WAVES,
  MIN_WAVES,
  defaultEndAlign,
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
import type { AffordanceId } from '../../../engine/selection/affordances';

const SAFE_EDGES = [
  { key: 'top', label: 'T' },
  { key: 'right', label: 'R' },
  { key: 'bottom', label: 'B' },
  { key: 'left', label: 'L' },
] as const;

interface ShapeGeometrySectionProps {
  node: AnyNode;
  uniformKind: boolean;
  openShape: boolean;
  affords: (id: AffordanceId) => boolean;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  setGeometry: (patch: Record<string, unknown>) => void;
  setSafeArea: (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => void;
}

export const ShapeGeometrySection: React.FC<ShapeGeometrySectionProps> = ({
  node,
  uniformKind,
  openShape,
  affords,
  shared,
  setGeometry,
  setSafeArea,
}) => {
  return (
    <>
      {uniformKind && node.type === 'shape' && openShape && (
        <Accordion title="Ends" icon={<MoveRight size={13} />}>
          <Row stack label="Head" hint="Whether the marker sits inside the line's length or projects past its end.">
            <SegmentedControl
              ariaLabel="Arrowhead alignment"
              mixed={shared((n) => (n.type === 'shape'
                ? n.geometry.endAlign ?? defaultEndAlign(n.geometry.lineProfile)
                : null)).mixed}
              value={node.geometry.endAlign ?? defaultEndAlign(node.geometry.lineProfile)}
              onChange={(v) => setGeometry({ endAlign: v as EndAlign })}
              segments={[
                { value: 'inside', label: 'At the end', hint: 'The tip lands on the last point', icon: <ArrowRightToLine size={14} /> },
                { value: 'extend', label: 'Past the end', hint: 'The line keeps its full length and the head projects', icon: <ArrowRight size={14} /> },
              ]}
            />
          </Row>
          <Row label="End size" hint="How big both markers are, relative to the stroke.">
            {(() => {
              const scale = shared((n) => (n.type === 'shape' ? n.geometry.endScale ?? 1 : null));
              return (
                <NumberStepper
                  value={Math.round((scale.value ?? 1) * 100)}
                  mixed={scale.mixed}
                  onChange={(v) => setGeometry({ endScale: v === 100 ? undefined : v / 100 })}
                  min={MIN_END_SCALE * 100}
                  max={MAX_END_SCALE * 100}
                  step={25}
                  suffix="%"
                />
              );
            })()}
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
        </Accordion>
      )}

      {uniformKind && node.type === 'shape' && openShape && (
        <Accordion title="Line" icon={<Minus size={13} />}>
          <Row stack label="Style" hint="The shape the run makes on its way across. Every style takes the same ends, weight and dash.">
            <SegmentedControl
              ariaLabel="Line style"
              mixed={shared((n) => (n.type === 'shape' ? n.geometry.lineProfile ?? 'straight' : null)).mixed}
              value={node.geometry.lineProfile ?? 'straight'}
              onChange={(v) => setGeometry({ lineProfile: v === 'straight' ? undefined : (v as LineProfile) })}
              segments={LINE_PROFILES.map((profile) => ({
                value: profile,
                label: LINE_PROFILE_LABELS[profile],
                hint: LINE_PROFILE_LABELS[profile],
                icon: <LineProfileIcon profile={profile} />,
              }))}
            />
          </Row>
          {(node.geometry.lineProfile ?? 'straight') !== 'straight'
            && node.geometry.lineProfile !== 'curved' && (
            <Row
              label={node.geometry.lineProfile === 'coil' ? 'Loops' : 'Repeats'}
              hint="How many times the shape repeats along the run. More makes them tighter, not smaller."
            >
              {(() => {
                const waves = shared((n) => (n.type === 'shape' ? n.geometry.lineWaves ?? 6 : null));
                return (
                  <NumberStepper
                    value={waves.value ?? 6}
                    mixed={waves.mixed}
                    onChange={(v) => setGeometry({ lineWaves: v })}
                    min={MIN_WAVES}
                    max={MAX_WAVES}
                  />
                );
              })()}
            </Row>
          )}
        </Accordion>
      )}

      {uniformKind && node.type === 'shape' && node.geometry.kind === 'star' && (
        <Accordion title="Star" icon={<Star size={13} />}>
          <Row label="Points">
            <NumberStepper
              value={node.geometry.points ?? 5}
              onChange={(points) => setGeometry({ points })}
              min={MIN_STAR_POINTS}
              max={MAX_STAR_POINTS}
            />
          </Row>
          <Row label="Depth">
            <NumberStepper
              value={Math.round((1 - (node.geometry.innerRatio ?? 0.5)) * 100)}
              onChange={(depth) => setGeometry({ innerRatio: 1 - depth / 100 })}
              min={Math.round((1 - MAX_STAR_RATIO) * 100)}
              max={Math.round((1 - MIN_STAR_RATIO) * 100)}
              step={5}
            />
          </Row>
        </Accordion>
      )}

      {uniformKind && node.type === 'shape' && node.geometry.kind === 'polygon' && (
        <Accordion title="Polygon" icon={<Hexagon size={13} />}>
          <Row label="Sides">
            <NumberStepper
              value={node.geometry.points ?? 3}
              onChange={(points) => setGeometry({ points })}
              min={MIN_POLYGON_SIDES}
              max={MAX_POLYGON_SIDES}
            />
          </Row>
        </Accordion>
      )}

      {affords('frame-preset') && node.type === 'frame' && (
        <Accordion
          title="Safe area"
          icon={<Frame size={13} />}
          defaultOpen={Boolean(node.safeArea)}
          badge={node.safeArea ? 'On' : undefined}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {SAFE_EDGES.map(({ key, label }) => (
              <NumberStepper
                key={key}
                value={Math.round(node.safeArea?.[key] ?? 0)}
                onChange={(v) => setSafeArea(key, v)}
                label={label}
                min={0}
                step={8}
              />
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            A guide only. Nothing is clipped or moved, and it never appears in an export.
          </p>
        </Accordion>
      )}
    </>
  );
};
