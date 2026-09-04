import React from 'react';
import { ArrowLeftRight, CornerDownRight, Link2Off, Minus, Spline, Squircle } from 'lucide-react';
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
  /** What each end is bound to, by name, for the attachment row. */
  boundNames: { from?: string; to?: string };
}

/**
 * The two ends, as a native select each.
 *
 * ## Why not two segmented controls
 *
 * They were, and each was six segments on its own stacked row — two rows of
 * six tiles for a pair of settings that are read *against each other*. "Which
 * way does this arrow point" is one question, and it was laid out as two,
 * eighty pixels apart, with no way to see both answers without moving your
 * eyes between them.
 *
 * Side by side they are one row and one glance, and the swap between them is
 * the operation the arrangement makes obvious: an arrow drawn the wrong way
 * round is the commonest thing to want to fix here, and it used to be two
 * separate edits through two separate pickers.
 *
 * A native `select` is the right control at this size for the reason
 * `FontWeightSelect` is not: six short names with a glyph each fit a menu the
 * platform draws, and there is nothing to preview that the trigger cannot
 * already show. What it buys is keyboard behaviour, type-ahead and an overlay
 * that escapes a 260px panel — which a six-tile group in half a row cannot.
 */
const EndPicker: React.FC<{
  side: 'endStart' | 'endEnd';
  value: EndCapKind;
  mixed: boolean;
  onChange: (kind: EndCapKind) => void;
}> = ({ side, value, mixed, onChange }) => (
  <span className="end-picker">
    <EndCapIcon kind={value} flip={side === 'endStart'} />
    <select
      className="end-picker__select"
      value={mixed ? '' : value}
      aria-label={side === 'endStart' ? 'Start of the line' : 'End of the line'}
      onChange={(e) => onChange(e.target.value as EndCapKind)}
    >
      {mixed && <option value="">Mixed</option>}
      {END_CAP_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {END_CAP_LABELS[kind]}
        </option>
      ))}
    </select>
  </span>
);

export const ConnectorSection: React.FC<ConnectorSectionProps> = ({
  node,
  affords,
  shared,
  set,
  boundNames,
}) => {
  if (!affords('routing') || node.type !== 'connector') return null;

  const startShared = shared((n) => (n.type === 'connector' ? n.endStart ?? 'none' : null));
  const endShared = shared((n) => (n.type === 'connector' ? n.endEnd ?? 'none' : null));

  return (
    <Accordion title="Connector" icon={<Spline size={13} />}>
      <Row stack label="Route" hint="Straight goes corner to corner. Right angles turns at the elbows. Curved eases between the ends.">
        <SegmentedControl
          ariaLabel="Routing"
          fill
          mixed={shared((n) => (n.type === 'connector' ? n.routing : null)).mixed}
          value={node.routing}
          onChange={(routing) => set({ routing } as Partial<AnyNode>)}
          segments={[
            { value: 'straight', label: 'Straight', icon: <Minus size={14} />, hint: 'A direct line' },
            { value: 'orthogonal', label: 'Right angles', icon: <CornerDownRight size={14} />, hint: 'Right-angled elbows' },
            { value: 'curved', label: 'Curved', icon: <Spline size={14} />, hint: 'A smooth arc' },
          ]}
        />
      </Row>

      {/*
        Rounded elbows, and only where there are elbows.

        A straight run has no corners and a curved one is already a curve, so
        on either of those this would be a number that changes nothing —
        which is the thing this panel keeps deciding not to offer. It appears
        with the routing that has them.

        Each corner takes the radius it can afford rather than the one asked
        for: an elbow a few units from a box's edge is ordinary, and a fixed
        radius there would run past the next corner and draw a knot. See
        `connectorCorners.ts`.
      */}
      {node.routing === 'orthogonal' && (
        <Row label="Corners" hint="Rounds the elbows. A tight elbow rounds as far as it can and no further.">
          {(() => {
            const radius = shared((n) => (n.type === 'connector' ? n.cornerRadius ?? 0 : null));
            return (
              <NumberStepper
                aria-label="Elbow radius"
                glyph={<Squircle size={13} />}
                suffix="px"
                value={Math.round(radius.value ?? 0)}
                mixed={radius.mixed}
                onChange={(v) => set({ cornerRadius: v > 0 ? v : undefined } as Partial<AnyNode>)}
                min={0}
                max={200}
                step={2}
              />
            );
          })()}
        </Row>
      )}

      {/*
        Both ends on one line, with the swap between them.

        "Which way does this arrow point" is one question, and it was laid out
        as two stacked rows of six tiles — eighty pixels apart, with no way to
        see both answers at once. The swap is the operation the arrangement
        makes obvious, and it is the commonest fix here: an arrow drawn the
        wrong way round used to be two edits through two pickers.

        The button swaps the **caps**, not the ends. Reversing the connector
        itself is below, and the two are genuinely different: one changes what
        is drawn, the other changes which object the arrow leaves from — and a
        connector bound at both ends has a direction that its label and its
        routing both read.
      */}
      <Row stack label="Ends" hint="What sits at each end of the run.">
        <div className="end-pair">
          <EndPicker
            side="endStart"
            value={(startShared.value ?? 'none') as EndCapKind}
            mixed={startShared.mixed}
            onChange={(kind) => set({ endStart: kind } as Partial<AnyNode>)}
          />
          <button
            type="button"
            className="end-pair__swap"
            data-tooltip="Swap the two ends"
            aria-label="Swap the two ends"
            onClick={() =>
              set({
                endStart: node.endEnd ?? 'none',
                endEnd: node.endStart ?? 'none',
              } as Partial<AnyNode>)
            }
          >
            <ArrowLeftRight size={13} />
          </button>
          <EndPicker
            side="endEnd"
            value={(endShared.value ?? 'none') as EndCapKind}
            mixed={endShared.mixed}
            onChange={(kind) => set({ endEnd: kind } as Partial<AnyNode>)}
          />
        </div>
      </Row>

      <Row label="End size" hint="How big the arrowheads are, relative to the stroke.">
        {(() => {
          const scale = shared((n) => (n.type === 'connector' ? n.endScale ?? 1 : null));
          return (
            <NumberStepper
              aria-label="End size"
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

      <Row label="Label" hint="A word riding the middle of the run: yes, no, retry.">
        <input
          className="prop-input"
          value={node.label ?? ''}
          placeholder="None"
          onChange={(e) => set({ label: e.target.value || undefined } as Partial<AnyNode>)}
          aria-label="Connector label"
        />
      </Row>

      <div className="prop-rule" role="presentation" />

      {/*
        What this arrow actually joins, named.

        It was a sentence — "Both ends follow the objects they are attached to"
        — which says the *state* and not the *fact*. On a board of forty boxes
        the question is which two, and the panel knew and did not say. A
        connector is the one object whose entire meaning is the pair at its
        ends, so the pair is the thing to show.

        Reversing swaps the ends themselves rather than their caps: it changes
        which object the arrow leaves from, which is what "this dependency runs
        the other way" means. Withheld unless both ends are bound, because
        reversing a half-attached connector swaps a real object for a loose
        point and leaves the arrow pointing into empty space.
      */}
      <Row label="Joins">
        <span className="connector-bond">
          <span className="connector-bond__end" data-loose={!node.from.nodeId || undefined}>
            {boundNames.from ?? 'Loose'}
          </span>
          <span className="connector-bond__arrow" aria-hidden="true">→</span>
          <span className="connector-bond__end" data-loose={!node.to.nodeId || undefined}>
            {boundNames.to ?? 'Loose'}
          </span>
        </span>
      </Row>
      <Row stack label="Direction">
        <button
          type="button"
          className="sketch-redraw"
          disabled={!node.from.nodeId || !node.to.nodeId}
          data-tooltip={
            node.from.nodeId && node.to.nodeId
              ? 'Point the arrow the other way'
              : 'Both ends have to be attached to reverse'
          }
          onClick={() => set({ from: node.to, to: node.from } as Partial<AnyNode>)}
        >
          <ArrowLeftRight size={13} aria-hidden="true" />
          Reverse
        </button>
      </Row>
      {(!node.from.nodeId || !node.to.nodeId) && (
        <p className="prop-note">
          <Link2Off size={11} aria-hidden="true" /> One end is loose. Drag it onto an
          object to attach it.
        </p>
      )}
    </Accordion>
  );
};
