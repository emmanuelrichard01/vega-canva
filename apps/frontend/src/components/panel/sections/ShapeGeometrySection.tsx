import React from 'react';
import {
  ArrowRight,
  ArrowRightToLine,
  Frame,
  RectangleHorizontal,
  RectangleVertical,
  Shrink,
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
  FRAME_PRESETS,
  FRAME_PRESET_GROUPS,
  framePreset,
  presetMatching,
  type FramePreset,
} from '../../../engine/model/frames';
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
  /** Resize this frame to a named size, keeping its top-left corner. */
  applyFramePreset: (preset: FramePreset) => void;
  /** Swap the frame's width and height, transposing its safe area with them. */
  turnFrame: () => void;
  /** Shrink the frame to the union of what it contains. */
  fitFrameToContents: () => void;
  /** How many objects this frame owns, so the fit control can explain itself. */
  frameChildCount: number;
}

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

      {uniformKind && node.type === 'shape' && openShape && (() => {
        /** Whether this line's own points describe its shape. See `polyline.ts`. */
        const multiPoint =
          isMultiPoint(node.geometry.vertices) ||
          hasBend(node.geometry.bends) ||
          node.geometry.smooth === true;
        return (
        <Accordion title="Line" icon={<Minus size={13} />}>
          {/*
            A run of corners takes its shape from its own points, so the profile
            has nothing to apply to and the renderer ignores it. Withdrawn here
            rather than left inert: this panel is driven by a capability
            registry precisely so a control cannot outlive what honours it, and
            the toolbar's copy of this decision was already gated.

            Said out loud rather than left as a gap, because an option that
            disappears with no explanation reads as a bug.
          */}
          {multiPoint ? (
            <Row stack label="Style">
              <p className="panel-note">
                This line takes its shape from its points. Round its corners from
                the floating toolbar, or open the point editor to bend one segment.
              </p>
            </Row>
          ) : (
          <>
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
          {(node.geometry.lineProfile ?? 'straight') !== 'straight' && (
            <Row
              label={
                node.geometry.lineProfile === 'coil'
                  ? 'Loop size'
                  : node.geometry.lineProfile === 'curved'
                    ? 'Bow depth'
                    : 'Wave height'
              }
              hint={
                node.geometry.lineProfile === 'coil'
                  ? 'How large the loops are, relative to the baseline.'
                  : 'Height / amplitude of the profile curve.'
              }
            >
              {(() => {
                const amp = shared((n) => (n.type === 'shape' ? n.geometry.lineAmplitude ?? 1.0 : null));
                return (
                  <NumberStepper
                    value={Math.round((amp.value ?? 1.0) * 100)}
                    mixed={amp.mixed}
                    onChange={(v) => setGeometry({ lineAmplitude: v === 100 ? undefined : v / 100 })}
                    min={MIN_AMPLITUDE_SCALE * 100}
                    max={MAX_AMPLITUDE_SCALE * 100}
                    step={10}
                    suffix="%"
                  />
                );
              })()}
            </Row>
          )}
          </>
          )}
        </Accordion>
        );
      })()}

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
          title="Frame"
          icon={<Frame size={13} />}
          defaultOpen
          badge={presetMatching(node.width, node.height)?.label}
        >
          {/*
            The size, by name.

            A frame is one of the few things on a board whose dimensions have
            a *name* — 1440x1024 is "Desktop", 595x842 is "A4" — and until now
            the only place that name existed was the tool that made it. Resize
            a frame by dragging and there was no way back to the size it was
            born at, short of typing four digits into the Transform block from
            memory.

            The badge on the header says which one it currently is, and says
            nothing when it is not one — a frame one unit off a preset has been
            resized deliberately, and calling it Desktop would be worse than
            calling it nothing.
          */}
          <Row stack label="Size" hint="Resize to a standard size. The frame keeps its top-left corner.">
            <select
              className="prop-select"
              value={presetMatching(node.width, node.height)?.id ?? '__custom'}
              onChange={(e) => {
                const preset = framePreset(e.target.value);
                if (preset) applyFramePreset(preset);
              }}
            >
              {!presetMatching(node.width, node.height) && (
                <option value="__custom">Custom</option>
              )}
              {FRAME_PRESET_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {FRAME_PRESETS.filter((p) => p.group === group).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.width} × {p.height}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Row>

          {/*
            Orientation, which is why the list above is still short.

            Half the sizes anybody wants are a listed size on its side — a
            landscape phone, a portrait slide, an A4 turned for a certificate.
            Listing both of every one would double a catalogue that is
            deliberately kept readable, to buy a single bit of information. One
            toggle buys the same bit.

            It swaps the frame's own width and height rather than looking a
            preset up, so it works on a custom size too. A square frame has no
            orientation to choose, and the control says so rather than offering
            two buttons that do the same nothing.
          */}
          <Row label="Orientation" hint="Swap width and height. The safe area is transposed with them.">
            <SegmentedControl
              ariaLabel="Frame orientation"
              fill
              disabledReason={
                node.width === node.height
                  ? 'A square frame is the same either way up.'
                  : undefined
              }
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

          {/*
            Shrink to what is actually in it.

            A frame drawn around existing work is almost never the right size
            for it, and the alternative is dragging four edges in while
            watching for the moment something clips. This reads the frame's own
            members — the containment the frame already maintains — and fits
            the box to their union plus a margin.

            Disabled when the frame is empty rather than hidden, with the
            reason: an empty frame fitted to its contents would collapse to
            nothing, and a control that silently does that is worse than one
            that explains itself.
          */}
          <Row stack label="Contents">
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
          </Row>

          <div className="prop-rule" role="presentation" />

          {/*
            The safe area, which used to be this whole section.

            It is a guide rather than a size, so it sits under the rule with the
            things that describe the frame rather than the things that change
            its box.
          */}
          <Row stack label="Safe area" hint="Where content is guaranteed to survive. A guide only — nothing is clipped or moved, and it never appears in an export.">
            <div className="prop-grid">
              {SAFE_EDGES.map(({ key, label }) => (
                <NumberStepper
                  key={key}
                  value={Math.round(node.safeArea?.[key] ?? 0)}
                  onChange={(v) => setSafeArea(key, v)}
                  label={label}
                  suffix="px"
                  min={0}
                  step={8}
                />
              ))}
            </div>
          </Row>
        </Accordion>
      )}
    </>
  );
};
