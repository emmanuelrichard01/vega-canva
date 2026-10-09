import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Group, Line, Rect } from 'react-konva';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { useStore } from '../../hooks/useStore';
import { nodeBounds } from '../../engine/SceneGraph';
import { clientToWorld } from '../../engine/interaction/clientToWorld';
import { marqueeActivity } from '../../engine/interaction/marquee';
import { stackAtPoint } from '../../engine/interaction/pick';
import { measureBetween, type MeasureBox, type MeasureSegment } from '../../engine/interaction/measure';
import { formatHud } from '../../engine/ui/hudFormat';
import { hudColors, segmentLabelOffset } from '../../engine/ui/hudPill';
import { CanvasPill, canvasPillSize } from '../hud/CanvasPill';
import { railVeil } from '../../engine/interaction/railVeil';
import { cameraSystem } from '../../engine/CameraSystem';
import { useCameraZoom } from '../../engine/useCameraZoom';
import { canvasChromeContrast, useContrast } from '../../engine/ui/contrast';
import { chromeSurfaceColor, HALO_PX, useChromeDark } from '../../engine/interaction/chromeHalo';
import './selectChrome.css';

interface Props {
  selectedIds: readonly string[];
}

function unionBox(ids: readonly string[]): MeasureBox | null {
  const { objects } = useStore.getState();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const node = objects[id];
    if (!node) continue;
    const b = nodeBounds(node);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/**
 * Hold Alt with something selected and point at another object: the distances
 * between them, as in Figma. Pointing at empty board measures nothing.
 *
 * Reads the document only on pointer moves while Alt is down, so it costs
 * nothing the rest of the time. Hidden during a move, when the smart guides
 * are the measurement that matters.
 */
export const MeasureOverlay: React.FC<Props> = ({ selectedIds }) => {
  const zoom = useCameraZoom();
  const { enhanced } = useContrast();
  // Colours are baked into Konva nodes, so a theme switch has to redraw them.
  useChromeDark();
  const moving = useSyncExternalStore(railVeil.subscribe, railVeil.getMoveSnapshot, railVeil.getMoveSnapshot);
  const marqueeing = useSyncExternalStore(marqueeActivity.subscribe, marqueeActivity.get, marqueeActivity.get);
  const [alt, setAlt] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => setAlt(e.altKey);
    const onBlur = () => setAlt(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Alt during a marquee means subtract, not measure.
  const active = alt && !moving && !marqueeing && selectedIds.length > 0;

  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      setTargetId(null);
      return;
    }
    const chosen = new Set(selectedIds);
    const onMove = (e: PointerEvent) => {
      if (!e.altKey) return setAlt(false);
      const target = e.target as Element | null;
      if (!target?.closest?.('.konvajs-content')) return setTargetId(null);
      const world = clientToWorld(e.clientX, e.clientY);
      const stack = stackAtPoint(world.x, world.y, 1 / (cameraSystem.zoom || 1));
      setTargetId(stack.find((id) => !chosen.has(id)) ?? null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [active, selectedIds]);

  const segments = useMemo<{ sel: MeasureBox; other: MeasureBox; list: MeasureSegment[] } | null>(() => {
    if (!active || !targetId) return null;
    const sel = unionBox(selectedIds);
    const other = unionBox([targetId]);
    if (!sel || !other) return null;
    return { sel, other, list: measureBetween(sel, other) };
  }, [active, targetId, selectedIds]);

  if (!segments) return null;
  const hair = 1 / (zoom || 1);
  // Enhanced contrast thickens the lines and lays a surface-coloured halo
  // under them, so they separate from whatever board content they cross.
  const { strokeScale, halo } = canvasChromeContrast(enhanced);
  const line = hair * strokeScale;
  const haloWidth = line + 2 * HALO_PX * hair;
  const surface = halo ? chromeSurfaceColor() : '';
  // The measurement colour the smart guides and spacing pills share: these are
  // distances, not selection.
  const MEASURE_COLOR = hudColors().line;

  return (
    <Group listening={false} name={EXPORT_CHROME}>
      {/* The object being measured to, outlined so it is clear which one. */}
      {halo && (
        <Rect
          x={segments.other.x}
          y={segments.other.y}
          width={segments.other.width}
          height={segments.other.height}
          stroke={surface}
          strokeWidth={haloWidth}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}
      <Rect
        x={segments.other.x}
        y={segments.other.y}
        width={segments.other.width}
        height={segments.other.height}
        stroke={MEASURE_COLOR}
        strokeWidth={line}
        perfectDrawEnabled={false}
        listening={false}
      />
      {segments.list.map((s, i) => {
        const horizontal = s.orientation === 'horizontal';
        const points = horizontal ? [s.from, s.position, s.to, s.position] : [s.position, s.from, s.position, s.to];
        const label = formatHud({ kind: 'distance', value: s.value }, zoom).text;
        const pill = canvasPillSize(label);
        const mid = (s.from + s.to) / 2;
        const offset = segmentLabelOffset(s.orientation, Math.abs(s.to - s.from) * (zoom || 1), pill);
        const lx = (horizontal ? mid : s.position) + offset.dx * hair;
        const ly = (horizontal ? s.position : mid) + offset.dy * hair;
        const arm = 4 * hair;
        const caps = horizontal
          ? [[s.from, s.position - arm, s.from, s.position + arm], [s.to, s.position - arm, s.to, s.position + arm]]
          : [[s.position - arm, s.from, s.position + arm, s.from], [s.position - arm, s.to, s.position + arm, s.to]];
        return (
          <React.Fragment key={i}>
            {halo && (
              <>
                <Line points={points} stroke={surface} strokeWidth={haloWidth} lineCap="round" perfectDrawEnabled={false} listening={false} />
                {caps.map((c, j) => (
                  <Line key={j} points={c} stroke={surface} strokeWidth={haloWidth} lineCap="round" perfectDrawEnabled={false} listening={false} />
                ))}
              </>
            )}
            <Line points={points} stroke={MEASURE_COLOR} strokeWidth={line} perfectDrawEnabled={false} listening={false} />
            {caps.map((c, j) => (
              <Line key={j} points={c} stroke={MEASURE_COLOR} strokeWidth={line} perfectDrawEnabled={false} listening={false} />
            ))}
            <CanvasPill x={lx} y={ly} text={label} tone="measure" zoom={zoom} haloColor={halo ? surface : undefined} />
          </React.Fragment>
        );
      })}
    </Group>
  );
};
