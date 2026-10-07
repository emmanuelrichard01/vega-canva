import React from 'react';
import { ArrowLeftRight, Plus, Scaling, Squircle, X } from 'lucide-react';
import { NumberField, Note, Row, Section, SegmentedControl, Select, Switch, writePatches } from '../grammar';
import { EndCapIcon, RouteIcon } from '../connectorIcons';
import {
  END_CAP_KINDS,
  END_CAP_LABELS,
  MAX_END_SCALE,
  MIN_END_SCALE,
  type EndCapKind,
} from '../../../engine/model/connectorEnds';
import { labelEditStore, labelsOf, sentenceCase } from '../../../engine/model/connectorLabelLayout';
import { jumpStyleOf } from '../../../engine/model/connectorRouter/routeBoard';
import type { ConnectorLabel, ConnectorNode, AnyNode } from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import type { AffordanceId } from '../../../engine/selection/affordances';
import { useStore } from '../../../hooks/useStore';
import './connectorSection.css';

interface ConnectorSectionProps {
  node: ConnectorNode;
  affords: (id: AffordanceId) => boolean;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  set: (updates: Partial<AnyNode>) => void;
  /** What each end is bound to, by name, for the attachment row. */
  boundNames: { from?: string; to?: string };
}

type Jumps = 'arc' | 'gap' | 'none';

const END_OPTIONS = (flip: boolean) =>
  END_CAP_KINDS.map((kind) => ({ value: kind, label: END_CAP_LABELS[kind], icon: <EndCapIcon kind={kind} flip={flip} /> }));

const JUMP_OPTIONS: Array<{ value: Jumps; label: string; detail: string }> = [
  { value: 'arc', label: 'Hop', detail: 'Arcs over lines below it' },
  { value: 'gap', label: 'Gap', detail: 'Lines below it break' },
  { value: 'none', label: 'None', detail: 'Lines simply cross' },
];

const nanoLabelId = () => Math.random().toString(36).slice(2, 8);

/** A connector's labels as the document has them now, not as some earlier render saw them. */
function currentLabels(id: string): ConnectorLabel[] {
  const node = useStore.getState().objects[id];
  return node?.type === 'connector' ? labelsOf(node as ConnectorNode) : [];
}

/**
 * One label's text. Enter keeps the edit, Escape puts the text back, and
 * leaving the field keeps it. The edit is written against the labels the
 * document holds when it lands, so a label someone else added or changed in
 * the meantime is kept. While the field has focus a change from elsewhere does
 * not overwrite what is being typed; once it loses focus it shows the
 * document's text again.
 */
const LabelField: React.FC<{
  connectorId: string;
  label: ConnectorLabel;
  index: number;
  write: (next: ConnectorLabel[]) => void;
}> = ({ connectorId, label, index, write }) => {
  const [value, setValue] = React.useState(label.text);
  const focused = React.useRef(false);
  const cancelled = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setValue(label.text);
  }, [label.text]);
  return (
    <input
      className="conn-labels__input"
      value={value}
      aria-label={`Label ${index + 1}`}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          // Handled here: Escape must not also clear the selection.
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        focused.current = false;
        const labels = currentLabels(connectorId);
        const now = labels.find((l) => l.id === label.id);
        if (cancelled.current) {
          cancelled.current = false;
          setValue(now?.text ?? label.text);
          return;
        }
        if (!now) return;
        const text = sentenceCase(value);
        if (text === now.text) {
          setValue(now.text);
          return;
        }
        write(text ? labels.map((l) => (l.id === label.id ? { ...l, text } : l)) : labels.filter((l) => l.id !== label.id));
      }}
    />
  );
};

/**
 * Connector: how the run is routed, what sits at its ends, and the words on it.
 *
 * Built from the panel grammar like every other section. Rows appear with
 * the routing that uses them: corners and line jumps only for a routed line
 * (a curve has no elbows and does not jump), avoidance for anything that is
 * not straight. Numbers scrub, and on a mixed selection a scrub moves each
 * connector by the same amount instead of flattening them to one value.
 */
export const ConnectorSection: React.FC<ConnectorSectionProps> = ({ node, affords, shared, set, boundNames }) => {
  if (!affords('routing') || node.type !== 'connector') return null;

  /** Every selected connector, collected through `shared`, which visits each node. */
  const selection = (): ConnectorNode[] => {
    const out: ConnectorNode[] = [];
    shared((n) => {
      if (n.type === 'connector') out.push(n as ConnectorNode);
      return null;
    });
    return out;
  };
  const nudgeEach = (read: (c: ConnectorNode) => number, write: (c: ConnectorNode, v: number) => Record<string, unknown>, delta: number) =>
    writePatches(selection().map((c) => ({ id: c.id, changes: write(c, read(c) + delta) })));

  const routing = shared((n) => (n.type === 'connector' ? n.routing : null));
  const avoid = shared((n) => (n.type === 'connector' ? Boolean(n.avoid) : null));
  const jumps = shared((n) => (n.type === 'connector' ? jumpStyleOf(n as ConnectorNode) : null));
  const radius = shared((n) => (n.type === 'connector' ? n.cornerRadius ?? 8 : null));
  const startShared = shared((n) => (n.type === 'connector' ? n.endStart ?? 'none' : null));
  const endShared = shared((n) => (n.type === 'connector' ? n.endEnd ?? 'none' : null));
  const scale = shared((n) => (n.type === 'connector' ? n.endScale ?? 1 : null));

  const labels = labelsOf(node);
  const multi = selection().length > 1;
  const writeLabels = (next: ConnectorLabel[]) =>
    set({ labels: next.length > 0 ? next : undefined, label: next[0]?.text } as Partial<AnyNode>);

  const clampScale = (v: number) => Math.min(MAX_END_SCALE, Math.max(MIN_END_SCALE, v));

  return (
    <Section id="connector" title="Connector">
      <Row stack label="Route" hint="Straight goes end to end. Elbow turns at right angles. Curved sweeps between the ends.">
        <SegmentedControl
          ariaLabel="Routing"
          fill
          mixed={routing.mixed}
          value={node.routing}
          onChange={(next) => set({ routing: next } as Partial<AnyNode>)}
          segments={[
            { value: 'straight', label: 'Straight', icon: <RouteIcon routing="straight" />, hint: 'A direct line' },
            { value: 'orthogonal', label: 'Elbow', icon: <RouteIcon routing="orthogonal" />, hint: 'Right-angled turns' },
            { value: 'curved', label: 'Curved', icon: <RouteIcon routing="curved" />, hint: 'A smooth sweep' },
          ]}
        />
      </Row>

      {node.routing !== 'straight' && (
        <Row label="Avoid objects" hint="Route around shapes in the way instead of through them.">
          <Switch
            ariaLabel="Avoid objects"
            checked={avoid.mixed ? 'mixed' : Boolean(avoid.value)}
            onChange={(on) => set({ avoid: on ? true : undefined } as Partial<AnyNode>)}
          />
        </Row>
      )}

      {node.routing === 'orthogonal' && (
        <>
          <Row label="Corners" hint="Rounds the elbows. A tight elbow rounds as far as it can and no further.">
            <NumberField
              label="Elbow radius"
              glyph={<Squircle size={13} />}
              unit="px"
              value={radius.mixed ? 'mixed' : Math.round(radius.value ?? 8)}
              min={0}
              max={200}
              step={2}
              onChange={(v) => set({ cornerRadius: Math.max(0, Math.round(v)) } as Partial<AnyNode>)}
              onNudge={(d) =>
                nudgeEach(
                  (c) => c.cornerRadius ?? 8,
                  (_c, v) => ({ cornerRadius: Math.min(200, Math.max(0, Math.round(v))) }),
                  d
                )
              }
            />
          </Row>
          <Row label="Line jumps" hint="What this line draws where it crosses lines below it.">
            <Select<Jumps>
              label="Line jumps"
              value={jumps.mixed ? 'mixed' : ((jumps.value ?? 'none') as Jumps)}
              options={JUMP_OPTIONS}
              onChange={(v) => set({ jumps: v } as Partial<AnyNode>)}
            />
          </Row>
        </>
      )}

      <Row stack label="Ends" hint="What sits at each end of the run.">
        <div className="end-pair">
          <Select<EndCapKind>
            label="Start of the line"
            value={startShared.mixed ? 'mixed' : ((startShared.value ?? 'none') as EndCapKind)}
            options={END_OPTIONS(true)}
            onChange={(kind) => set({ endStart: kind } as Partial<AnyNode>)}
          />
          <button
            type="button"
            className="pg-icon-btn"
            data-tooltip="Swap the two ends"
            aria-label="Swap the two ends"
            onClick={() =>
              writePatches(
                selection().map((c) => ({ id: c.id, changes: { endStart: c.endEnd ?? 'none', endEnd: c.endStart ?? 'none' } }))
              )
            }
          >
            <ArrowLeftRight size={13} aria-hidden="true" />
          </button>
          <Select<EndCapKind>
            label="End of the line"
            value={endShared.mixed ? 'mixed' : ((endShared.value ?? 'none') as EndCapKind)}
            options={END_OPTIONS(false)}
            onChange={(kind) => set({ endEnd: kind } as Partial<AnyNode>)}
          />
        </div>
      </Row>

      <Row label="End size" hint="How big the arrowheads are, relative to the stroke.">
        <NumberField
          label="End size"
          glyph={<Scaling size={13} />}
          unit="%"
          value={scale.mixed ? 'mixed' : Math.round((scale.value ?? 1) * 100)}
          min={MIN_END_SCALE * 100}
          max={MAX_END_SCALE * 100}
          step={25}
          onChange={(v) => {
            const next = clampScale(v / 100);
            set({ endScale: next === 1 ? undefined : next } as Partial<AnyNode>);
          }}
          onNudge={(d) =>
            nudgeEach(
              (c) => (c.endScale ?? 1) * 100,
              (_c, v) => {
                const next = clampScale(v / 100);
                return { endScale: next === 1 ? undefined : next };
              },
              d
            )
          }
        />
      </Row>

      {/* Words belong to one connector, so they are edited one connector at a time. */}
      {!multi && (
      <Row stack label="Labels" hint="Words on the run. The line breaks around each one. Double-click the line to place one.">
        <div className="conn-labels">
          {labels.map((label, i) => (
            <div className="conn-labels__row" key={label.id}>
              <LabelField connectorId={node.id} label={label} index={i} write={writeLabels} />
              <button
                type="button"
                className="pg-icon-btn"
                aria-label={`Remove label ${i + 1}`}
                data-tooltip="Remove"
                onClick={() => writeLabels(currentLabels(node.id).filter((l) => l.id !== label.id))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="conn-labels__add"
            onClick={() => {
              // Typed on the line itself, where it will sit: the middle first,
              // then either side of it.
              const t = [0.5, 0.25, 0.75, 0.375, 0.625][labels.length % 5];
              labelEditStore.set({ connectorId: node.id, labelId: nanoLabelId(), t, isNew: true });
            }}
          >
            <Plus size={13} aria-hidden="true" />
            Add label
          </button>
        </div>
      </Row>
      )}

      <Row label="Joins">
        <span className="connector-bond">
          <span className="connector-bond__end" data-loose={!node.from.nodeId || undefined}>
            {boundNames.from ?? 'Loose'}
          </span>
          <span className="connector-bond__arrow" aria-hidden="true">
            →
          </span>
          <span className="connector-bond__end" data-loose={!node.to.nodeId || undefined}>
            {boundNames.to ?? 'Loose'}
          </span>
          <button
            type="button"
            className="pg-icon-btn conn-reverse"
            disabled={!node.from.nodeId || !node.to.nodeId}
            aria-label="Reverse direction"
            data-tooltip={
              node.from.nodeId && node.to.nodeId ? 'Point the arrow the other way' : 'Both ends have to be attached to reverse'
            }
            onClick={() => set({ from: node.to, to: node.from } as Partial<AnyNode>)}
          >
            <ArrowLeftRight size={13} aria-hidden="true" />
          </button>
        </span>
      </Row>
      {(!node.from.nodeId || !node.to.nodeId) && <Note>One end is loose. Drag it onto an object to attach it.</Note>}
    </Section>
  );
};
