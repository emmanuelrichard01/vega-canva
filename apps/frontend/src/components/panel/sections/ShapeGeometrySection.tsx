import React from 'react';
import {
  ArrowRight,
  ArrowRightToLine,
  Columns3,
  Frame,
  Rows3,
  RectangleHorizontal,
  RectangleVertical,
  Shrink,
  UnfoldHorizontal,
  Hexagon,
  Minus,
  MoveRight,
  Star,
} from 'lucide-react';
import { Accordion, Row, SubGroup } from '../panelPrimitives';
import { NumberStepper } from '../../ui/NumberStepper';
import { Switch } from '../../ui/Switch';
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
  /** Set or clear the frame's column measure. */
  setLayoutGuide: (guide: LayoutGuide | undefined) => void;
}

/**
 * The two axes of a measure, so the panel writes one block rather than two.
 *
 * They are the same shape by design — see `LayoutGuide` — and rendering them
 * from a list is what keeps them the same in the panel too. Two hand-written
 * blocks is where "columns has a margin field and rows does not" comes from.
 */
const AXES: {
  key: 'columns' | 'rows';
  label: string;
  hint: string;
  fallback: LayoutAxis;
  glyph: React.ReactNode;
}[] = [
  {
    key: 'columns',
    label: 'Columns',
    hint: 'Vertical tracks, dividing the width.',
    fallback: DEFAULT_COLUMNS,
    glyph: <Columns3 size={13} />,
  },
  {
    key: 'rows',
    label: 'Rows',
    hint: 'Horizontal tracks, dividing the height. A baseline rhythm more often than eight stacked boxes.',
    fallback: DEFAULT_ROWS,
    glyph: <Rows3 size={13} />,
  },
];

/**
 * Whether a guide is exactly a preset.
 *
 * Field by field on both axes, because a preset that sets only columns is not
 * matched by a guide that also has rows — it is that preset *plus* something,
 * and lighting the chip would claim the rows came from it.
 */
function sameGuide(a: LayoutGuide | undefined, b: LayoutGuide): boolean {
  const axis = (x: LayoutAxis | undefined, y: LayoutAxis | undefined) =>
    (!x && !y) || Boolean(x && y && x.count === y.count && x.gutter === y.gutter && x.margin === y.margin);
  return axis(a?.columns, b.columns) && axis(a?.rows, b.rows);
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
  setLayoutGuide,
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
            The column measure — the *other* meaning of "grid".

            `engine/grid/` builds a grid as objects you can select and colour;
            this draws nothing that exists. It is chrome over the frame, it
            never exports, and its only job is to give edges for other things
            to line up against — which is why twelve columns is ordinary here
            and would be twelve tall slivers there.

            Things snap to it, and that is the one line separating it from the
            safe area below: a safe area is drawn and deliberately snaps to
            nothing, because a frame that promised a safe area and then quietly
            moved things into it would be worse than no guide at all. A measure
            exists to be moved onto.
          */}
          <SubGroup
            label="Measure"
            hint="Columns and rows drawn over the frame for placing things against. Never exported, and objects snap to them."
            on={Boolean(node.layoutGuide)}
            onToggle={(on) => setLayoutGuide(on ? { columns: DEFAULT_COLUMNS } : undefined)}
          >
            {node.layoutGuide && (
              <>
                {/* The measures worth one click. Twelve is twelve because of
                    what it factors into: halves, thirds, quarters and sixths
                    all land on a column boundary. */}
                <div className="grid-presets" role="group" aria-label="Measure preset">
                  {LAYOUT_GUIDE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="grid-preset"
                      data-active={sameGuide(node.layoutGuide, preset.guide) || undefined}
                      onClick={() => setLayoutGuide(preset.guide)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/*
                  Two axes, each with its own switch.

                  A count of zero would be the obvious way to turn one off and
                  is the wrong one: the normalizer drops an axis with no
                  tracks, so the field would delete itself and leave a stepper
                  showing a number that is not stored. An axis is present or it
                  is not, and the switch says which.
                */}
                {AXES.map(({ key, label, hint, fallback, glyph }) => {
                  const axis = node.layoutGuide?.[key];
                  return (
                    <React.Fragment key={key}>
                      <Row label={label} hint={hint}>
                        <Switch
                          checked={Boolean(axis)}
                          onChange={(on) =>
                            setLayoutGuide({
                              ...node.layoutGuide,
                              [key]: on ? fallback : undefined,
                            })
                          }
                        />
                      </Row>
                      {axis && (
                        <>
                          <div className="prop-grid">
                            <NumberStepper
                              aria-label={`${label} count`}
                              glyph={glyph}
                              value={axis.count}
                              onChange={(count) =>
                                setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, count } })
                              }
                              min={1}
                              max={48}
                            />
                            <NumberStepper
                              aria-label={`Gutter between ${label.toLowerCase()}`}
                              glyph={<UnfoldHorizontal size={13} />}
                              suffix="px"
                              value={axis.gutter}
                              onChange={(gutter) =>
                                setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, gutter } })
                              }
                              min={0}
                              max={200}
                            />
                          </div>
                          <Row
                            label="Margin"
                            hint="Inset from the two edges this axis runs between. The first and last tracks start here."
                          >
                            <NumberStepper
                              aria-label={`${label} margin`}
                              suffix="px"
                              value={axis.margin}
                              onChange={(margin) =>
                                setLayoutGuide({ ...node.layoutGuide, [key]: { ...axis, margin } })
                              }
                              min={0}
                              max={400}
                              step={8}
                            />
                          </Row>
                        </>
                      )}
                    </React.Fragment>
                  );
                })}

                {/*
                  Said when the numbers do not fit, rather than drawing nothing
                  and leaving you to work out why.

                  Twelve columns at a 100-unit gutter needs 1100 units of gap
                  before a single column exists, and margins can eat a frame
                  outright. Both are arithmetic somebody can fix in one edit —
                  once they know which of the three numbers is the problem.
                */}
                {!guideDraws(node, node.layoutGuide) && (
                  <p className="prop-note">
                    The gutters and margins come to more than the frame. Lower one of
                    them, or reduce the count.
                  </p>
                )}
              </>
            )}
          </SubGroup>

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
