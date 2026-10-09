import React, { useSyncExternalStore } from 'react';
import { ArrowLeftRight, ChevronDown, Type, Waypoints } from 'lucide-react';
import { lineEdit } from '../../../engine/interaction/lineEdit';
import { reshapeLine, setLineCurved, swapLineEnds } from '../../../engine/interaction/lineVertexActions';
import { requestEditOnMount } from '../../../engine/interaction/pendingEdit';
import { flattenToPath } from '../../../engine/document/vectorOps';
import { END_CAP_KINDS, END_CAP_LABELS, MAX_END_SCALE, MIN_END_SCALE, type EndCapKind } from '../../../engine/model/connectorEnds';
import { LINE_PROFILES, LINE_PROFILE_LABELS, ROUTE_PROFILES, isRouteProfile, type LineProfile } from '../../../engine/model/linePath';
import { hasBend, isMultiPoint } from '../../../engine/model/polyline';
import { buildStroke, dashFor, styleOf, STROKE_STYLE_IDS, STROKE_STYLE_LABELS, type StrokeStyleId } from '../../../engine/model/strokeStyle';
import { DEFAULT_INK, type ShapeNode } from '../../../engine/model/schema';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EndCapIcon } from '../../panel/connectorIcons';
import { LineProfileIcon } from '../../panel/lineProfileIcons';
import { LineSpecimen } from '../../panel/lineSpecimen';
import { PopoverSlider, RailButton, VectorEditIcon } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy, type RailVerb } from './anatomy';
import { SketchControl, StrokeControl } from './controls';
import { EndsGlyph } from './ConnectorRail';
import { drawnStrokeWidth } from './strokeDefaults';
import { appearanceOf, type SingleRail } from './types';

/** A specimen of a dash pattern, drawn at the size of the profile glyphs beside it. */
const PatternIcon: React.FC<{ style: StrokeStyleId }> = ({ style }) => (
  <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" focusable="false">
    <line
      x1="3"
      y1="7"
      x2="19"
      y2="7"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeDasharray={style === 'dashed' ? '4 3.5' : style === 'dotted' ? '0 3.6' : undefined}
    />
  </svg>
);

/**
 * A line or arrow, on the rail: its path, its paint, its ends, its label.
 *
 * Lean on purpose, the FigJam order. The kind chip *is* the line's style — its
 * path and its pattern — so the rail does not carry a second swatch for the
 * same thing; the heads are one control with both ends and their size inside;
 * and "swap direction" sits on the rail only while there is a direction to
 * swap (the two ends differ). Editing points stays reachable by double-click
 * and ⏎, and keeps a button here because that is how anyone learns a line can
 * have more than two.
 */
export const LineRail: SingleRail<ShapeNode> = ({ node, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  const lineSelection = useSyncExternalStore(lineEdit.subscribe, lineEdit.getSnapshot, lineEdit.getSnapshot);
  const editing = lineSelection?.nodeId === node.id;
  const start: EndCapKind = node.geometry.endStart ?? 'none';
  const end: EndCapKind = node.geometry.endEnd ?? 'none';
  const multiPoint =
    isMultiPoint(node.geometry.vertices) || hasBend(node.geometry.bends) || node.geometry.smooth === true;
  const profile: LineProfile = node.geometry.lineProfile ?? 'straight';
  const pattern = styleOf(appearance.stroke);
  const width = drawnStrokeWidth(node);
  const name = start !== 'none' || end !== 'none' ? 'Arrow' : 'Line';

  const setProfile = (v: string) =>
    reshapeLine(node, { lineProfile: v === 'straight' ? undefined : (v as LineProfile) });
  const profileSegments = (profiles: readonly LineProfile[]) =>
    profiles.map((p) => ({ value: p, hint: LINE_PROFILE_LABELS[p], icon: <LineProfileIcon profile={p} /> }));

  const setPattern = (style: StrokeStyleId) => {
    const stroke = appearance.stroke ?? { color: DEFAULT_INK, width };
    // Dashes and dots read as marks only with round ends; a solid line keeps
    // whatever cap it had.
    const cap = style === 'solid' ? stroke.cap : stroke.cap ?? 'round';
    setAppearance({ stroke: buildStroke({ ...stroke, width: stroke.width || width, cap }, dashFor(style, stroke.width || width)) });
  };

  const style = (
    <RailPopover
      label="Line style"
      align="start"
      trigger={
        <span className="rail-kind">
          <LineSpecimen
            profile={profile}
            endStart={start}
            endEnd={end}
            run={multiPoint ? (node.geometry.smooth ? 'rounded' : 'corners') : 'two-point'}
          />
          <span className="rail-kind__name">{name}</span>
          <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
        </span>
      }
    >
      {multiPoint ? (
        <>
          {/* A profile runs along one segment; a run of corners takes its shape from its points. */}
          <span className="ctx-popover__label">Corners</span>
          <SegmentedControl
            ariaLabel="Corners"
            value={node.geometry.smooth ? 'rounded' : 'sharp'}
            onChange={(v) => setLineCurved(node, v === 'rounded')}
            segments={[
              { value: 'sharp', label: 'Sharp', hint: 'Sharp corners', icon: <LineSpecimen run="corners" /> },
              { value: 'rounded', label: 'Rounded', hint: 'One smooth curve through the points', icon: <LineSpecimen run="rounded" /> },
            ]}
          />
        </>
      ) : (
        <>
          {/* Two rows of one choice: the routes a diagram line takes, then the
              marks that say something about the line itself. Only one of the
              six is ever pressed. */}
          <span className="ctx-popover__label">Path</span>
          <SegmentedControl
            ariaLabel="Line path"
            value={profile}
            onChange={setProfile}
            segments={profileSegments(ROUTE_PROFILES)}
          />
          <span className="ctx-popover__label">Decorative</span>
          <SegmentedControl
            ariaLabel="Decorative line"
            value={profile}
            onChange={setProfile}
            segments={profileSegments(LINE_PROFILES.filter((p) => !isRouteProfile(p)))}
          />
        </>
      )}
      <span className="ctx-popover__label">Pattern</span>
      <SegmentedControl
        ariaLabel="Stroke pattern"
        value={pattern}
        onChange={(v) => setPattern(v as StrokeStyleId)}
        segments={STROKE_STYLE_IDS.map((id) => ({
          value: id,
          hint: STROKE_STYLE_LABELS[id],
          icon: <PatternIcon style={id} />,
        }))}
      />
      <div className="ctx-popover__rule" role="presentation" />
      <button type="button" className="ctx-popover__action" onClick={() => flattenToPath(node.id)}>
        <VectorEditIcon size={14} />
        Convert to vector path
      </button>
    </RailPopover>
  );

  const capSegments = (flip: boolean) =>
    END_CAP_KINDS.map((kind) => ({
      value: kind,
      hint: END_CAP_LABELS[kind],
      icon: <EndCapIcon kind={kind} flip={flip} />,
    }));

  const verbs: RailVerb[] = [
    {
      id: 'ends',
      controls: 1,
      node: (
        <RailPopover label="Ends" align="start" trigger={<EndsGlyph start={start} end={end} />}>
          <span className="ctx-popover__label">Start</span>
          <SegmentedControl
            ariaLabel="Start"
            value={start}
            onChange={(v) => reshapeLine(node, { endStart: v as EndCapKind })}
            segments={capSegments(true)}
          />
          <span className="ctx-popover__label">End</span>
          <SegmentedControl
            ariaLabel="End"
            value={end}
            onChange={(v) => reshapeLine(node, { endEnd: v as EndCapKind })}
            segments={capSegments(false)}
          />
          {/* One size for both: a big head on a small tail reads as a mistake. */}
          <PopoverSlider
            label="Size"
            value={Math.round((node.geometry.endScale ?? 1) * 100)}
            min={MIN_END_SCALE * 100}
            max={MAX_END_SCALE * 100}
            step={25}
            suffix="%"
            onChange={(v) => reshapeLine(node, { endScale: v === 100 ? undefined : v / 100 })}
          />
          {start !== end && (
            <>
              <div className="ctx-popover__rule" role="presentation" />
              <button type="button" className="ctx-popover__action" onClick={() => swapLineEnds(node)}>
                <ArrowLeftRight size={14} aria-hidden />
                Swap direction
              </button>
            </>
          )}
        </RailPopover>
      ),
    },
  ];
  // Only while there is a direction: two equal ends swap into themselves.
  if (start !== end) {
    verbs.push({
      id: 'swap',
      controls: 1,
      node: (
        <RailButton label="Swap direction" hint="Swap direction" onClick={() => swapLineEnds(node)}>
          <ArrowLeftRight size={16} />
        </RailButton>
      ),
    });
  }
  verbs.push(
    {
      id: 'label',
      controls: 1,
      node: (
        <RailButton
          label={node.text ? 'Edit label' : 'Add label'}
          hint={node.text ? 'Edit label · drag it along the line to move it' : 'Add a label to this line'}
          onClick={() => requestEditOnMount(node.id)}
        >
          <Type size={15} />
        </RailButton>
      ),
    },
    { id: 'sketch', controls: 1, node: <SketchControl appearance={appearance} shades={false} onChange={setAppearance} /> },
    {
      id: 'points',
      controls: 1,
      node: (
        <RailButton
          label={editing ? 'Done editing points' : 'Edit points'}
          hint={editing ? 'Done editing points (Esc)' : 'Edit points: corners and curves (⏎)'}
          pressed={editing}
          onClick={() => (editing ? lineEdit.end(node.id) : lineEdit.begin(node.id))}
        >
          <Waypoints size={16} />
        </RailButton>
      ),
    }
  );

  return (
    <RailAnatomy
      kind={style}
      kindControls={1}
      paint={<StrokeControl appearance={appearance} width={width} onChange={setAppearance} />}
      paintControls={1}
      verbs={verbs}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
