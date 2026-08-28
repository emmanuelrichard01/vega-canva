import React from 'react';
import { CornerDownRight, Minus, Spline } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { NumberStepper } from '../../ui/NumberStepper';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EndCapIcon } from '../connectorIcons';
import {
  END_CAP_KINDS,
  END_CAP_LABELS,
  MAX_END_SCALE,
  MIN_END_SCALE,
  type EndCapKind,
} from '../../../engine/model/connectorEnds';
import type { ConnectorNode, AnyNode } from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import type { AffordanceId } from '../../../engine/selection/affordances';

interface ConnectorSectionProps {
  node: ConnectorNode;
  affords: (id: AffordanceId) => boolean;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  set: (updates: Partial<AnyNode>) => void;
}

export const ConnectorSection: React.FC<ConnectorSectionProps> = ({
  node,
  affords,
  shared,
  set,
}) => {
  if (!affords('routing') || node.type !== 'connector') return null;

  return (
    <Accordion title="Connector" icon={<Spline size={13} />}>
      <Row stack label="Route" hint="Straight goes corner to corner. Orthogonal turns at right angles. Curved eases between the ends.">
        <SegmentedControl
          ariaLabel="Routing"
          mixed={shared((n) => (n.type === 'connector' ? n.routing : null)).mixed}
          value={node.routing}
          onChange={(routing) => set({ routing } as Partial<AnyNode>)}
          segments={[
            {
              value: 'straight', label: 'Straight', icon: <Minus size={14} />,
              hint: 'A direct line',
            },
            {
              value: 'orthogonal', label: 'Right angles', icon: <CornerDownRight size={14} />,
              hint: 'Right-angled elbows',
            },
            {
              value: 'curved', label: 'Curved', icon: <Spline size={14} />,
              hint: 'A smooth arc',
            },
          ]}
        />
      </Row>
      <Row label="End size" hint="How big the arrowheads are, relative to the stroke.">
        {(() => {
          const scale = shared((n) => (n.type === 'connector' ? n.endScale ?? 1 : null));
          return (
            <NumberStepper
              value={Math.round((scale.value ?? 1) * 100)}
              mixed={scale.mixed}
              onChange={(v) => set({ endScale: v === 100 ? undefined : v / 100 } as Partial<AnyNode>)}
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
          hint={side === 'endStart' ? 'What sits at the first point.' : 'What sits at the second point.'}
        >
          <SegmentedControl
            ariaLabel={side === 'endStart' ? 'Start of the line' : 'End of the line'}
            mixed={shared((n) => (n.type === 'connector' ? n[side] ?? 'none' : null)).mixed}
            value={node[side] ?? 'none'}
            onChange={(v) => set({ [side]: v as EndCapKind } as Partial<AnyNode>)}
            segments={END_CAP_KINDS.map((kind) => ({
              value: kind,
              label: END_CAP_LABELS[kind],
              icon: <EndCapIcon kind={kind} flip={side === 'endStart'} />,
            }))}
          />
        </Row>
      ))}
      <Row label="Label" hint="A word riding the middle of the run: yes, no, retry.">
        <input
          className="prop-input"
          value={node.label ?? ''}
          placeholder="None"
          onChange={(e) => set({ label: e.target.value || undefined } as Partial<AnyNode>)}
          aria-label="Connector label"
        />
      </Row>
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        {node.from.nodeId && node.to.nodeId
          ? 'Both ends follow the objects they are attached to.'
          : 'One end is loose. Drag it onto an object to attach it.'}
      </p>
    </Accordion>
  );
};
