import React from 'react';
import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { useStore } from '../../hooks/useStore';
import { useCameraZoom } from '../../engine/useCameraZoom';
import { nodeBounds } from '../../engine/SceneGraph';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { canEditObjects } from '../../engine/model/permissions';
import { liveTransformStore } from '../../engine/model/liveTransformStore';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { ThemeService } from '../../engine/ThemeService';
import {
  QUICK_SIDES,
  flowSide,
  offersQuickCreate,
  previousInChain,
  quickCreate,
  quickCreateTabAllowed,
  quickCreateTarget,
  trackBoardFocus,
  type QuickSide,
} from '../../engine/interaction/connectorQuickCreate';

interface Props {
  selectedIds: string[];
  activeTool: string;
}

/** Chrome colour, the same as the selection box and handles. */
const CHROME = '#3B82F6';
/** How far outside the object's side a magnet sits, in screen px: clear of the resize handles. */
const OFFSET_SCREEN = 28;
const RADIUS_SCREEN = 8;
/** How close the pointer has to come to the object, in screen px, for the magnets to show. */
const REACH_SCREEN = 56;

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};

/**
 * The four quick-create magnets around a selected shape or note, and the
 * Tab / Shift+Tab keys that drive the same action. See
 * `connectorQuickCreate.ts` for what they make and where.
 *
 * Magnets show only while the pointer is near the object, so a selection you
 * are reading is not ringed with buttons. Hovering one previews where the
 * copy will land.
 */
export const QuickCreateMagnets: React.FC<Props> = ({ selectedIds, activeTool }) => {
  const zoom = useCameraZoom();
  const id = selectedIds.length === 1 ? selectedIds[0] : null;
  const node = useStore((s) => (id ? s.objects[id] : undefined));
  const gesture = React.useSyncExternalStore(
    (fn) => liveTransformStore.subscribeGlobal(fn),
    () => liveTransformStore.active,
    () => false
  );
  const group = React.useRef<Konva.Group>(null);
  const [near, setNear] = React.useState(false);
  const [hover, setHover] = React.useState<QuickSide | null>(null);

  const eligible = activeTool === 'select' && offersQuickCreate(node) && canEditObjects();
  const box = eligible && node ? nodeBounds(node) : null;

  // Pointer proximity, read from the stage this layer is on.
  React.useEffect(() => {
    if (!box) {
      setNear(false);
      return;
    }
    const stage = group.current?.getStage();
    if (!stage) return;
    const onMove = () => {
      const p = stage.getRelativePointerPosition();
      if (!p) return;
      const reach = (REACH_SCREEN + OFFSET_SCREEN) / zoom;
      setNear(p.x > box.minX - reach && p.x < box.maxX + reach && p.y > box.minY - reach && p.y < box.maxY + reach);
    };
    stage.on('pointermove.quickcreate', onMove);
    onMove();
    return () => {
      stage.off('pointermove.quickcreate');
    };
  }, [box?.minX, box?.minY, box?.maxX, box?.maxY, zoom]);

  // Whether the board has focus: the stage and canvas are not focusable, so
  // a press on them leaves focus on the body, as a press on chrome does too.
  // The last press tells the two apart.
  const boardFocus = React.useRef<ReturnType<typeof trackBoardFocus> | null>(null);
  React.useEffect(() => {
    const container = () => group.current?.getStage()?.container() ?? null;
    const tracker = trackBoardFocus(
      window,
      (node) => {
        const c = container();
        return Boolean(c && node instanceof Node && c.contains(node));
      },
      () => document.body
    );
    boardFocus.current = tracker;
    return () => {
      tracker.dispose();
      boardFocus.current = null;
    };
  }, []);

  // Tab grows the chain; Shift+Tab steps back along it.
  React.useEffect(() => {
    if (!eligible || !id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      // Only when the board has focus: Tab elsewhere moves between controls,
      // and taking it there would trap keyboard users.
      const active = document.activeElement;
      const container = group.current?.getStage()?.container();
      const allowed = quickCreateTabAllowed({
        active,
        activeInBoard: Boolean(container && active && container.contains(active)),
        boardFocused: boardFocus.current?.focused() ?? false,
        body: document.body,
        canEdit: canEditObjects(),
        busy: isTyping(e.target) || Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
      });
      if (!allowed) return;
      const objects = useStore.getState().objects;
      e.preventDefault();
      if (e.shiftKey) {
        const back = previousInChain(objects, id);
        if (back) document.dispatchEvent(new CustomEvent('requestSelectNode', { detail: { id: back } }));
        return;
      }
      quickCreate(id, flowSide(objects, id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eligible, id]);

  React.useEffect(() => {
    if (!near) setHover(null);
  }, [near]);
  React.useEffect(() => () => claimCursor('quick-create', null), []);

  if (!box || !id || gesture) return <Group ref={group} name={EXPORT_CHROME} />;

  const offset = OFFSET_SCREEN / zoom;
  const r = RADIUS_SCREEN / zoom;
  const arm = 3.5 / zoom;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const spot: Record<QuickSide, { x: number; y: number }> = {
    right: { x: box.maxX + offset, y: cy },
    left: { x: box.minX - offset, y: cy },
    bottom: { x: cx, y: box.maxY + offset },
    top: { x: cx, y: box.minY - offset },
  };
  const preview = hover ? quickCreateTarget(id, hover) : null;
  const plate = ThemeService.getCanvasPlateFill();

  return (
    <Group ref={group} name={EXPORT_CHROME}>
      {preview && (
        <Group listening={false}>
          <Line
            points={[spot[hover!].x, spot[hover!].y, preview.x + preview.width / 2, preview.y + preview.height / 2]}
            stroke={CHROME}
            strokeWidth={1.25 / zoom}
            dash={[4 / zoom, 4 / zoom]}
            opacity={0.7}
          />
          <Rect
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            cornerRadius={4 / zoom}
            stroke={CHROME}
            strokeWidth={1.25 / zoom}
            dash={[5 / zoom, 4 / zoom]}
            fill="rgba(59, 130, 246, 0.06)"
          />
        </Group>
      )}
      {near &&
        QUICK_SIDES.map((side) => {
          const p = spot[side];
          const on = hover === side;
          return (
            <Group
              key={side}
              x={p.x}
              y={p.y}
              onMouseEnter={() => {
                setHover(side);
                claimCursor('quick-create', 'pointer');
              }}
              onMouseLeave={() => {
                setHover((h) => (h === side ? null : h));
                claimCursor('quick-create', null);
              }}
              onMouseDown={(e) => {
                e.cancelBubble = true;
              }}
              onClick={(e) => {
                e.cancelBubble = true;
                setHover(null);
                claimCursor('quick-create', null);
                quickCreate(id, side);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                quickCreate(id, side);
              }}
            >
              {/* A generous invisible target around the small mark. */}
              <Circle radius={r * 1.8} fill="transparent" />
              <Circle
                radius={on ? r * 1.15 : r}
                fill={on ? CHROME : plate}
                stroke={CHROME}
                strokeWidth={1.25 / zoom}
                shadowColor="rgba(15, 23, 42, 0.18)"
                shadowBlur={4 / zoom}
                shadowOffsetY={1 / zoom}
                shadowEnabled={!on}
              />
              <Line points={[-arm, 0, arm, 0]} stroke={on ? '#FFFFFF' : CHROME} strokeWidth={1.5 / zoom} lineCap="round" listening={false} />
              <Line points={[0, -arm, 0, arm]} stroke={on ? '#FFFFFF' : CHROME} strokeWidth={1.5 / zoom} lineCap="round" listening={false} />
            </Group>
          );
        })}
    </Group>
  );
};
