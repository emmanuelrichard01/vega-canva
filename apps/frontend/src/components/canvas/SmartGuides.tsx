import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Group, Line } from 'react-konva';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { guideState } from '../../engine/interaction/guideState';
import type { Guide } from '../../engine/interaction/smartGuides';
import { chromeSurfaceColor, HALO_PX, useChromeDark } from '../../engine/interaction/chromeHalo';
import { canvasChromeContrast, useContrast } from '../../engine/ui/contrast';
import { formatHud } from '../../engine/ui/hudFormat';
import { hudColors, segmentLabelOffset } from '../../engine/ui/hudPill';
import { CanvasPill, canvasPillSize } from '../hud/CanvasPill';

interface Props {
  /** Stage zoom, so the lines stay a hairline and the labels stay readable. */
  stageScale: number;
}

/**
 * What the guides are snapped to, as a string: changes only when a guide
 * lands somewhere new, not when the same snap is held across pointer moves.
 */
export function guideSignature(guides: readonly Guide[]): string {
  return guides.map((g) => `${g.orientation[0]}${g.kind[0]}${Math.round(g.position * 10)}`).join('|');
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The alignment and spacing guides drawn during a drag.
 *
 * These are the explanation for the snap, not decoration: without them an
 * object jumps for no visible reason, and the user learns to distrust the
 * feature rather than to use it.
 *
 * - **Alignment** guides are a solid hairline; **spacing** guides are dashed,
 *   capped and carry a distance pill, as Figma's equal-gap markers do. One
 *   colour for both, the measurement magenta, shared with the Alt measurement
 *   and the HUD's distance pills.
 * - **Landing.** When a guide appears somewhere new the guides pulse once, a
 *   short brightening, which is the felt "click" of the snap. Holding the same
 *   snap does not pulse again. Reduced motion skips it.
 * - Held at a constant size on screen, and named as export chrome, so a PNG
 *   taken mid-drag does not contain them. Increased contrast lays a surface
 *   halo under the lines and rings the pills.
 */
export const SmartGuides: React.FC<Props> = ({ stageScale }) => {
  const guides = useSyncExternalStore(guideState.subscribe, guideState.getSnapshot, guideState.getSnapshot);
  // Colours are baked into Konva nodes, so a theme switch has to redraw them.
  useChromeDark();
  const { enhanced } = useContrast();
  const groupRef = useRef<Konva.Group>(null);
  const signature = guideSignature(guides);
  const lastSignature = useRef('');

  useEffect(() => {
    const group = groupRef.current;
    const landed = signature !== '' && signature !== lastSignature.current;
    lastSignature.current = signature;
    if (!group || !landed || reducedMotion()) return;
    group.opacity(0.45);
    const tween = new Konva.Tween({ node: group, duration: 0.16, opacity: 1, easing: Konva.Easings.EaseOut });
    tween.play();
    return () => {
      tween.destroy();
      group.opacity(1);
    };
  }, [signature]);

  if (guides.length === 0) return null;

  const zoom = stageScale || 1;
  const hairline = 1 / zoom;
  const { strokeScale, halo } = canvasChromeContrast(enhanced);
  const width = hairline * strokeScale;
  const haloWidth = width + 2 * HALO_PX * hairline;
  const surface = halo ? chromeSurfaceColor() : undefined;
  const color = hudColors().line;

  return (
    <Group ref={groupRef} listening={false} name={EXPORT_CHROME}>
      {guides.map((guide, i) => {
        const vertical = guide.orientation === 'vertical';
        const points = vertical
          ? [guide.position, guide.from, guide.position, guide.to]
          : [guide.from, guide.position, guide.to, guide.position];
        const spacing = guide.kind === 'spacing';
        const caps = spacing
          ? [capPoints(guide.orientation, guide.position, guide.from, hairline), capPoints(guide.orientation, guide.position, guide.to, hairline)]
          : [];
        let label: React.ReactNode = null;
        if (spacing && guide.gap !== undefined) {
          const text = formatHud({ kind: 'distance', value: guide.gap }, zoom).text;
          const pill = canvasPillSize(text);
          // A vertical guide measures a vertical span, so its pill reads along it.
          const along = vertical ? 'vertical' : 'horizontal';
          const offset = segmentLabelOffset(along, Math.abs(guide.to - guide.from) * zoom, pill);
          const mid = (guide.from + guide.to) / 2;
          label = (
            <CanvasPill
              x={(vertical ? guide.position : mid) + offset.dx * hairline}
              y={(vertical ? mid : guide.position) + offset.dy * hairline}
              text={text}
              tone="measure"
              zoom={zoom}
              haloColor={surface}
            />
          );
        }
        return (
          <React.Fragment key={i}>
            {surface && (
              <>
                <Line points={points} stroke={surface} strokeWidth={haloWidth} lineCap="round" perfectDrawEnabled={false} listening={false} />
                {caps.map((c, j) => (
                  <Line key={j} points={c} stroke={surface} strokeWidth={haloWidth} lineCap="round" perfectDrawEnabled={false} listening={false} />
                ))}
              </>
            )}
            <Line
              points={points}
              stroke={color}
              strokeWidth={width}
              // A spacing guide is a measurement, not an alignment: dashing it
              // says "this is a distance" without needing a second colour.
              dash={spacing ? [4 * hairline, 3 * hairline] : undefined}
              perfectDrawEnabled={false}
              listening={false}
            />
            {caps.map((c, j) => (
              <Line key={j} points={c} stroke={color} strokeWidth={width} listening={false} perfectDrawEnabled={false} />
            ))}
            {label}
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
