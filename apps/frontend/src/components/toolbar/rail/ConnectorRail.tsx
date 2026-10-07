import React from 'react';
import { Type } from 'lucide-react';
import { END_CAP_KINDS, END_CAP_LABELS, MAX_END_SCALE, MIN_END_SCALE, type EndCapKind } from '../../../engine/model/connectorEnds';
import type { Routing } from '../../../engine/model/connector';
import type { ConnectorNode } from '../../../engine/model/schema';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EndCapIcon, RouteIcon } from '../../panel/connectorIcons';
import { PopoverSlider } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy } from './anatomy';
import { SketchControl, StrokeControl } from './controls';
import { drawnStrokeWidth } from './strokeDefaults';
import { appearanceOf, updateNode, type SingleRail } from './types';
import { ROUTE_SEGMENTS } from './routeSegments';


/** Both ends in the order they are drawn, so the rail says which way it points unopened. */
export const EndsGlyph: React.FC<{ start: EndCapKind; end: EndCapKind }> = ({ start, end }) => (
  <span className="rail-ends">
    <EndCapIcon kind={start} flip />
    <EndCapIcon kind={end} />
  </span>
);

/**
 * A connector: its route leads, then its stroke, ends, label and hand.
 *
 * These are drawing decisions you make repeatedly while laying out a diagram,
 * so they sit on the object rather than at the bottom of the inspector.
 */
export const ConnectorRail: SingleRail<ConnectorNode> = ({ node, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  const update = (updates: Record<string, unknown>) => updateNode(node.id, updates);

  return (
    <RailAnatomy
      kind={
        <RailPopover label="Route" trigger={<RouteIcon routing={node.routing} />} align="start">
          <span className="ctx-popover__label">Route</span>
          <SegmentedControl
            ariaLabel="Routing"
            value={node.routing}
            onChange={(routing) => update({ routing: routing as Routing })}
            segments={ROUTE_SEGMENTS}
          />
        </RailPopover>
      }
      kindControls={1}
      paint={<StrokeControl appearance={appearance} width={drawnStrokeWidth(node)} onChange={setAppearance} />}
      paintControls={1}
      verbs={[
        {
          id: 'ends',
          controls: 1,
          node: (
            <RailPopover
              label="Ends"
              trigger={<EndsGlyph start={node.endStart ?? 'none'} end={node.endEnd ?? 'none'} />}
              align="start"
            >
              <span className="ctx-popover__label">Start</span>
              <SegmentedControl
                ariaLabel="Start cap"
                value={node.endStart ?? 'none'}
                onChange={(v) => update({ endStart: v as EndCapKind })}
                segments={END_CAP_KINDS.map((k) => ({
                  value: k,
                  label: END_CAP_LABELS[k],
                  hint: END_CAP_LABELS[k],
                  icon: <EndCapIcon kind={k} flip />,
                }))}
              />
              <span className="ctx-popover__label">End</span>
              <SegmentedControl
                ariaLabel="End cap"
                value={node.endEnd ?? 'none'}
                onChange={(v) => update({ endEnd: v as EndCapKind })}
                segments={END_CAP_KINDS.map((k) => ({
                  value: k,
                  label: END_CAP_LABELS[k],
                  hint: END_CAP_LABELS[k],
                  icon: <EndCapIcon kind={k} />,
                }))}
              />
              {/* One size for both: a big head on a small tail reads as a mistake. */}
              <PopoverSlider
                label="Size"
                value={Math.round((node.endScale ?? 1) * 100)}
                min={MIN_END_SCALE * 100}
                max={MAX_END_SCALE * 100}
                step={25}
                suffix="%"
                onChange={(v) => update({ endScale: v === 100 ? undefined : v / 100 })}
              />
            </RailPopover>
          ),
        },
        {
          id: 'label',
          controls: 1,
          node: (
            <RailPopover label="Label" trigger={<Type size={16} />} align="start">
              <label className="ctx-popover__label" htmlFor={`rail-connector-label-${node.id}`}>
                Label
              </label>
              <input
                id={`rail-connector-label-${node.id}`}
                className="prop-input"
                value={node.label ?? ''}
                placeholder="yes, no, retry"
                onChange={(e) => update({ label: e.target.value || undefined })}
              />
            </RailPopover>
          ),
        },
        {
          id: 'sketch',
          controls: 1,
          node: <SketchControl appearance={appearance} shades={false} onChange={setAppearance} />,
        },
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
