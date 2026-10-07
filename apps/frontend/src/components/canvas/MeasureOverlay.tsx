import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { useStore } from '../../hooks/useStore';
import { nodeBounds } from '../../engine/SceneGraph';
import { clientToWorld } from '../../engine/interaction/clientToWorld';
import { stackAt } from '../../engine/interaction/pick';
import { formatDistance, measureBetween, type MeasureBox, type MeasureSegment } from '../../engine/interaction/measure';
import { railVeil } from '../../engine/interaction/railVeil';
import { useCameraZoom } from '../../engine/useCameraZoom';
import { canvasChromeContrast, useContrast } from '../../engine/ui/contrast';
import { chromeSurfaceColor, HALO_PX } from '../../engine/interaction/chromeHalo';

interface Props {
  selectedIds: readonly string[];
}

/** The same magenta as the smart guides: both are measurements, not selection. */
const MEASURE_COLOR = '#F0308C';
/** The label pill: a deeper magenta, so white 11px text clears 4.5:1 (about 5.7:1). */
const LABEL_FILL = '#C21A6E';
const LABEL_INK = '#FFFFFF';

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
  const moving = useSyncExternalStore(railVeil.subscribe, railVeil.getMoveSnapshot, railVeil.getMoveSnapshot);
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

  const active = alt && !moving && selectedIds.length > 0;

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
      const stack = stackAt(Object.values(useStore.getState().objects), world.x, world.y);
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
        const label = formatDistance(s.value);
        const labelW = (label.length * 6.4 + 10) * hair;
        const labelH = 16 * hair;
        const mid = (s.from + s.to) / 2;
        const lx = horizontal ? mid - labelW / 2 : s.position + 6 * hair;
        const ly = horizontal ? s.position + 6 * hair : mid - labelH / 2;
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
            <Rect x={lx} y={ly} width={labelW} height={labelH} cornerRadius={3 * hair} fill={LABEL_FILL} listening={false} />
            <Text
              x={lx}
              y={ly}
              width={labelW}
              height={labelH}
              align="center"
              verticalAlign="middle"
              text={label}
              fontSize={11 * hair}
              fontStyle="600"
              fontFamily="Inter, sans-serif"
              fill={LABEL_INK}
              listening={false}
              perfectDrawEnabled={false}
            />
          </React.Fragment>
        );
      })}
    </Group>
  );
};
