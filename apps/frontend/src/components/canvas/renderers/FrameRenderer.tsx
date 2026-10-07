import React, { useState } from 'react';
import type Konva from 'konva';
import { Group, Path, Rect, Text } from 'react-konva';
import { EXPORT_CHROME } from '../../../engine/export/chrome';
import { safeAreaBox } from '../../../engine/model/frames';
import { axisBands } from '../../../engine/model/layoutGuide';
import type { FrameNode } from '../../../engine/model/schema';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import { useFillProps } from './useFillProps';
import { chromeToken, useChromeDark } from '../../../engine/interaction/chromeHalo';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { requestFrameIcon, requestFrameRename } from '../FrameNameEditor';
import { KonvaEmoji } from '../../emoji/KonvaEmoji';

interface Props {
  node: FrameNode;
  /** Whether the frame is in the selection; its name then takes the ink. */
  selected?: boolean;
}

/** On-screen sizes of the header, held constant at every zoom as Figma holds its frame names. */
const NAME_PX = 12;
const DESC_PX = 11;
const ICON_PX = 14;
const GAP_PX = 6;

const SMILE_PLUS = 'M22 11v1a10 10 0 1 1-9-10M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6';

let measureCtx: CanvasRenderingContext2D | null = null;
/** Width of `text` in Inter at `px`, as Konva will draw it. */
function textWidth(text: string, px: number, weight: string): number {
  measureCtx ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!measureCtx) return text.length * px * 0.55;
  measureCtx.font = `${weight} normal ${px}px Inter, -apple-system, sans-serif`;
  return measureCtx.measureText(text).width;
}

/**
 * A frame: its background, its header, and its guides.
 *
 * The header is chrome above the frame — an emoji, the name, and an optional
 * line saying what the frame is for — drawn at a constant size on screen and
 * never exported. It behaves like Figma's frame label: pressing it selects
 * and drags the frame, double-clicking renames, hovering it outlines the
 * frame so you can see what you are about to grab, and a selected frame's
 * name takes the ink. Pressing the emoji (or the faint add-icon mark beside a
 * name without one) opens the emoji picker.
 */
export const FrameRenderer: React.FC<Props> = React.memo(({ node, selected = false }) => {
  const stageScale = useCameraZoom();
  // Konva cannot resolve `var()`, so tokens are read to literals at draw time.
  const dark = useChromeDark();
  const { canEdit } = useRoomPermissions();
  const [headerHover, setHeaderHover] = useState(false);
  const [iconHover, setIconHover] = useState(false);
  const hasFill = node.appearance?.fill === undefined || node.appearance.fill.length > 0;
  const fill = useFillProps(node.appearance, { x: 0, y: 0, width: node.width, height: node.height }, hasFill ? '#FFFFFF' : 'transparent');

  // The frame's own box, origin-anchored, so `safeAreaBox` hands back the
  // guide in local coordinates and the clamping has one implementation.
  const safe = safeAreaBox({ x: 0, y: 0, width: node.width, height: node.height, safeArea: node.safeArea });
  const columns = axisBands(node.width, node.layoutGuide?.columns);
  const rows = axisBands(node.height, node.layoutGuide?.rows);

  const isDiagramFrame = Boolean((node as unknown as Record<string, unknown>).diagramId);
  const strokeConfig = node.appearance?.stroke;

  const header = (() => {
    if (isDiagramFrame) return null;
    const zoom = Math.max(0.01, stageScale);
    // Below a frame narrow enough that the name would be a few letters, the header steps aside.
    if (node.width * zoom < 48) return null;
    const u = 1 / zoom;
    const name = node.title || 'Frame';
    const hasIcon = Boolean(node.icon);
    const desc = node.description;
    const iconW = hasIcon ? (ICON_PX + GAP_PX) * u : 0;
    const nameW = Math.min(node.width - iconW, textWidth(name, NAME_PX, selected ? '600' : '500') * u);
    const rowH = 18 * u;
    const descH = desc ? 16 * u : 0;
    const top = -(rowH + descH + 6 * u);
    const showAdd = !hasIcon && canEdit && headerHover && iconW + nameW + (ICON_PX + GAP_PX) * u < node.width;

    const nameInk = selected || headerHover ? chromeToken('--text-primary', dark ? '#FAFAFA' : '#111827') : chromeToken('--text-tertiary', dark ? '#A1A1AA' : '#6B7280');
    const quietInk = chromeToken('--text-tertiary', dark ? '#A1A1AA' : '#6B7280');

    const openIcon = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!canEdit) return;
      e.cancelBubble = true;
      const stage = e.target.getStage();
      const r = e.target.getClientRect();
      const box = stage?.container().getBoundingClientRect();
      requestFrameIcon(node.id, box ? { left: box.left + r.x, top: box.top + r.y, width: r.width, height: r.height } : undefined);
    };

    return (
      <Group
        name={EXPORT_CHROME}
        y={top}
        onMouseEnter={() => setHeaderHover(true)}
        onMouseLeave={() => {
          setHeaderHover(false);
          setIconHover(false);
        }}
        onDblClick={(e) => {
          e.cancelBubble = true;
          requestFrameRename(node.id);
        }}
        onDblTap={(e) => {
          e.cancelBubble = true;
          requestFrameRename(node.id);
        }}
      >
        {/* The press target: the whole header row, so the gap between emoji and name is not a hole. */}
        <Rect width={Math.min(node.width, iconW + nameW + (showAdd ? (ICON_PX + GAP_PX) * u : 0) + 4 * u)} height={rowH + descH} fill="transparent" />
        {hasIcon && (
          <Group
            y={(rowH - ICON_PX * u) / 2}
            onMouseEnter={() => setIconHover(true)}
            onMouseLeave={() => setIconHover(false)}
            onClick={openIcon}
            onTap={openIcon}
          >
            {iconHover && canEdit && (
              <Rect x={-2 * u} y={-2 * u} width={(ICON_PX + 4) * u} height={(ICON_PX + 4) * u} cornerRadius={4 * u} fill={chromeToken('--surface-hover', dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')} />
            )}
            <KonvaEmoji native={node.icon!} size={ICON_PX * u} />
          </Group>
        )}
        <Text
          text={name}
          x={iconW}
          y={0}
          height={rowH}
          width={Math.max(1, node.width - iconW)}
          verticalAlign="middle"
          ellipsis
          wrap="none"
          fontSize={NAME_PX * u}
          fontStyle={selected ? '600' : '500'}
          fill={nameInk}
          fontFamily="Inter, -apple-system, sans-serif"
          perfectDrawEnabled={false}
        />
        {showAdd && (
          <Group x={iconW + nameW + GAP_PX * u} y={(rowH - ICON_PX * u) / 2} onClick={openIcon} onTap={openIcon}>
            <Rect width={ICON_PX * u} height={ICON_PX * u} fill="transparent" />
            <Path
              data={SMILE_PLUS}
              x={1 * u}
              y={1 * u}
              scaleX={(12 * u) / 24}
              scaleY={(12 * u) / 24}
              stroke={quietInk}
              strokeWidth={2}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          </Group>
        )}
        {desc && (
          <Text
            text={desc}
            y={rowH}
            height={descH}
            width={node.width}
            verticalAlign="top"
            ellipsis
            wrap="none"
            fontSize={DESC_PX * u}
            fontStyle="400"
            fill={quietInk}
            fontFamily="Inter, -apple-system, sans-serif"
            perfectDrawEnabled={false}
            listening={false}
          />
        )}
      </Group>
    );
  })();

  return (
    <Group>
      {/*
        The page. A hairline and no shadow, as Figma draws a frame: a white
        page on a near-white board is separated by its edge, and a shadow under
        every frame on a board of forty turns the canvas into a stack of cards.
        The hairline is a neutral at low alpha because it sits on the frame's
        own fill, which may be anything, and is one screen pixel at every zoom.
        A frame with no background keeps only the edge.
      */}
      <Rect
        width={node.width}
        height={node.height}
        {...fill}
        cornerRadius={node.appearance?.cornerRadius ?? (isDiagramFrame ? 8 : 0)}
        stroke={strokeConfig?.color ?? (hasFill ? 'rgba(115,115,115,0.22)' : 'rgba(115,115,115,0.45)')}
        strokeWidth={strokeConfig?.width ?? 1}
        dash={strokeConfig?.dash}
        strokeScaleEnabled={!strokeConfig?.color}
      />

      {/* Hovering the name outlines the frame it will grab. */}
      {headerHover && !selected && (
        <Rect
          name={EXPORT_CHROME}
          width={node.width}
          height={node.height}
          cornerRadius={node.appearance?.cornerRadius ?? 0}
          stroke={chromeToken('--text-secondary', dark ? '#D4D4D8' : '#4B5563')}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {isDiagramFrame ? (
        <Text
          text={node.title ?? ''}
          x={12}
          y={12}
          width={Math.max(40, node.width - 24)}
          ellipsis={true}
          wrap="none"
          fontSize={11}
          fontStyle="600"
          fill={strokeConfig?.color ?? '#374151'}
          fontFamily="Inter, -apple-system, sans-serif"
          perfectDrawEnabled={false}
          listening={false}
        />
      ) : (
        header
      )}

      {/*
        The measure: bands rather than lines, because a tinted band *is* the
        column and a block spanning three of them visibly spans three. Chrome:
        never exported, never selectable, and things snap to it. Rows sit at a
        lower alpha than columns so the crossings do not read as a third mark.
      */}
      {columns.map((band, i) => (
        <Rect key={`c${i}`} name={EXPORT_CHROME} x={band.start} y={0} width={band.size} height={node.height} fill="#F43F5E" opacity={0.08} listening={false} perfectDrawEnabled={false} />
      ))}
      {rows.map((band, i) => (
        <Rect key={`r${i}`} name={EXPORT_CHROME} x={0} y={band.start} width={node.width} height={band.size} fill="#F43F5E" opacity={0.05} listening={false} perfectDrawEnabled={false} />
      ))}

      {/* The safe area: a guide only. Nothing clips or snaps to it, and it never exports. */}
      {safe && (
        <Rect
          name={EXPORT_CHROME}
          x={safe.x}
          y={safe.y}
          width={safe.width}
          height={safe.height}
          stroke="#38BDF8"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[6, 5]}
          opacity={0.55}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
});

FrameRenderer.displayName = 'FrameRenderer';
