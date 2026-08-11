import React, { useSyncExternalStore } from 'react';
import { Group, Line, Text } from 'react-konva';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { guideState } from '../../engine/interaction/guideState';

interface Props {
  /** Stage zoom, so the lines stay a hairline and the labels stay readable. */
  stageScale: number;
}

/** Magenta, the colour every tool in this category has used for thirty years. */
const GUIDE_COLOR = '#F0308C';

/**
 * The alignment and spacing guides drawn during a drag.
 *
 * These are the explanation for the snap, not decoration: without them an
 * object jumps for no visible reason, and the user learns to distrust the
 * feature rather than to use it.
 *
 * Held at a constant size on screen — a hairline at every zoom and a label
 * that stays legible — for the same reason the selection ring and the frame
 * name are. A guide drawn in world units is invisible at 10% and a slab at
 * 800%, which is precisely backwards: the further out you are, the more you
 * are relying on the line rather than on the pixels.
 *
 * Named as export chrome, so a PNG taken mid-drag does not contain them.
 */
export const SmartGuides: React.FC<Props> = ({ stageScale }) => {
  const guides = useSyncExternalStore(guideState.subscribe, guideState.getSnapshot, guideState.getSnapshot);
  if (guides.length === 0) return null;

  const hairline = 1 / stageScale;

  return (
    <Group listening={false} name={EXPORT_CHROME}>
      {guides.map((guide, i) => {
        const points =
          guide.orientation === 'vertical'
            ? [guide.position, guide.from, guide.position, guide.to]
            : [guide.from, guide.position, guide.to, guide.position];

        return (
          <React.Fragment key={i}>
            <Line
              points={points}
              stroke={GUIDE_COLOR}
              strokeWidth={hairline}
              // A spacing guide is a measurement, not an alignment: dashing it
              // says "this is a distance" without needing a second colour.
              dash={guide.kind === 'spacing' ? [4 * hairline, 3 * hairline] : undefined}
              perfectDrawEnabled={false}
              listening={false}
            />
            {/* End caps turn a spacing guide into something you read as a
                measured span rather than as another alignment line. */}
            {guide.kind === 'spacing' && (
              <>
                <Line points={capPoints(guide.orientation, guide.position, guide.from, hairline)} stroke={GUIDE_COLOR} strokeWidth={hairline} listening={false} perfectDrawEnabled={false} />
                <Line points={capPoints(guide.orientation, guide.position, guide.to, hairline)} stroke={GUIDE_COLOR} strokeWidth={hairline} listening={false} perfectDrawEnabled={false} />
                {guide.gap !== undefined && (
                  <Text
                    x={guide.orientation === 'horizontal' ? (guide.from + guide.to) / 2 : guide.position + 4 * hairline}
                    y={guide.orientation === 'horizontal' ? guide.position + 4 * hairline : (guide.from + guide.to) / 2}
                    text={String(Math.round(guide.gap))}
                    fontSize={10 * hairline}
                    fontFamily="Inter, sans-serif"
                    fill={GUIDE_COLOR}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                )}
              </>
            )}
          </React.Fragment>
        );
      })}
    </Group>
  );
};

/** A short tick across the end of a spacing guide. */
function capPoints(
  orientation: 'vertical' | 'horizontal',
  position: number,
  at: number,
  hairline: number
): number[] {
  const arm = 4 * hairline;
  return orientation === 'horizontal'
    ? [at, position - arm, at, position + arm]
    : [position - arm, at, position + arm, at];
}
