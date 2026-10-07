import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Circle, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type { StickyNode } from '../../../engine/model/schema';
import { initialsFor } from '../../../engine/presence/collaborators';
import { fontEpoch } from '../../../engine/text/fontEpoch';
import { formatVoterSummary } from '../../../engine/model/voters';
import { paperOf, STICKY_PADDING, STICKY_RADIUS } from '../../../engine/model/stickyThemes';
import { authorWidth, FOOTER_BAND, FOOTER_ROW, layoutFooter, PIN_INSET, textBox } from '../../../engine/model/stickyFooter';
import { CHECK_BOX, CHECK_GAP, toggleCheck } from '../../../engine/model/stickyRich';
import { STICKY_LINE_HEIGHT } from '../../../engine/model/stickyText';
import { STAMP_PLUS_ONE, QUICK_STAMPS, stampLabel } from '../../../engine/model/stickyStamps';
import { roughStickyPaper } from '../../../engine/model/roughNodes';
import { useSketchLevel } from '../../../engine/model/roughBoard';
import { chromeToken, useChromeDark } from '../../../engine/interaction/chromeHalo';
import { engineEvents } from '../../../engine/EventBus';
import { cameraSystem } from '../../../engine/CameraSystem';
import { updateNode } from '../../../engine/document';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { KonvaEmoji } from '../../emoji/KonvaEmoji';
import { isEmojiLike } from '../../../engine/emoji/emojiText';
import { openEmojiPicker } from '../../emoji/openEmojiPicker';
import { STICKY_FONT_FAMILY } from './stickyFit';
import { stickyFontStyle, stickyText } from './stickyRichLayout';
import { paperGrain } from './paperGrain';

interface Props {
  node: StickyNode;
  showText: boolean;
  myAuthorId: string;
  onToggleReaction?: (emoji: string) => void;
  onTogglePin?: () => void;
}


/** Below this many screen pixels across, the grain is invisible and is not drawn. */
const GRAIN_MIN_PX = 110;

const SMILE_PLUS =
  'M22 11v1a10 10 0 1 1-9-10M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6';
const CHECK_MARK = 'M5 12.5l4.2 4.2L19 7';

const subscribeCamera = (fn: () => void) => engineEvents.on('CameraChanged', fn);

/** Whether `worldSize` covers at least `px` screen pixels, re-rendering only when that flips. */
function useCoversPx(worldSize: number, px: number): boolean {
  const read = useCallback(() => worldSize * cameraSystem.zoom >= px, [worldSize, px]);
  return useSyncExternalStore(subscribeCamera, read, read);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

let metaCtx: CanvasRenderingContext2D | null = null;
/** Width of footer text, Inter 600 at 10px, measured the way Konva will draw it. */
function metaWidth(text: string): number {
  metaCtx ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!metaCtx) return text.length * 6;
  metaCtx.font = '600 normal 10px Inter';
  return metaCtx.measureText(text).width;
}

const DATE_FORMAT = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }) : null;

/** A tooltip on the canvas, in the app's inverse tooltip colours. */
const Tip: React.FC<{ x: number; y: number; text: string; dark: boolean; rotation?: number }> = ({ x, y, text, dark, rotation }) => (
  <Label x={x} y={y} rotation={rotation} listening={false}>
    <Tag
      fill={chromeToken('--surface-inverse', dark ? 'rgba(244,244,245,0.96)' : 'rgba(20,23,30,0.94)')}
      cornerRadius={5}
      pointerDirection="down"
      pointerWidth={6}
      pointerHeight={4}
      lineJoin="round"
      shadowColor="rgba(0,0,0,0.24)"
      shadowBlur={6}
      shadowOffsetY={2}
    />
    <Text
      text={text}
      fontSize={10}
      fontFamily="Inter"
      fontStyle="500"
      padding={5}
      fill={chromeToken('--text-inverse', dark ? '#18181B' : '#FFFFFF')}
    />
  </Label>
);

/** One stamp's face: the artwork, or the "+1" mark that has none. */
const StampFace: React.FC<{ stamp: string; x: number; y: number; size: number; ink: string }> = ({ stamp, x, y, size, ink }) =>
  stamp === STAMP_PLUS_ONE ? (
    <Text
      text="+1"
      x={x - 2}
      y={y}
      width={size + 4}
      height={size}
      align="center"
      verticalAlign="middle"
      fontFamily="Inter"
      fontStyle="700"
      fontSize={size * 0.72}
      fill={ink}
      listening={false}
    />
  ) : (
    <KonvaEmoji native={stamp} x={x} y={y} size={size} />
  );

/** Where a Konva node sits in the viewport, for hanging DOM off it. */
function clientRectOf(node: Konva.Node): { left: number; top: number; width: number; height: number } | null {
  const stage = node.getStage();
  if (!stage) return null;
  const r = node.getClientRect();
  const box = stage.container().getBoundingClientRect();
  return { left: box.left + r.x, top: box.top + r.y, width: r.width, height: r.height };
}

/**
 * A sticky note: paper, writing, who wrote it, and the stamps on it.
 *
 * Paper is drawn as paper: a faint top-to-bottom sheen, a grain you can see
 * when the note is large on screen, and one soft directional shadow that
 * deepens a little under the pointer, as a sheet would lift. The writing is
 * laid out by `stickyRichLayout` — balanced lines, bold and italic, links,
 * checklists — and the paper's ink is checked against the paper in both themes.
 */
export const StickyRenderer: React.FC<Props> = React.memo(({ node, showText, myAuthorId, onToggleReaction, onTogglePin }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const [trayHover, setTrayHover] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isNoteHovered, setIsNoteHovered] = useState(false);
  const [isPinHovered, setIsPinHovered] = useState(false);
  const paperRef = useRef<Konva.Shape>(null);
  const { canEdit, canComment } = useRoomPermissions();

  const dark = useChromeDark();
  const paper = paperOf(node.theme, dark);
  const sketchLevel = useSketchLevel(node.appearance);
  const showGrain = useCoversPx(Math.min(node.width, node.height), GRAIN_MIN_PX);
  const showAuthor = node.showAuthor !== false;
  const showStamps = node.showStamps !== false;

  // The paper cut by hand, from the same builder the exporter uses (`roughStickyPaper`).
  const sketchSeed = node.appearance?.sketchSeed;
  const sketchPaper = useMemo(
    () => (sketchLevel ? roughStickyPaper({ id: node.id, width: node.width, height: node.height, appearance: { sketchSeed } }, sketchLevel) : null),
    [node.id, node.width, node.height, sketchLevel, sketchSeed]
  );

  // The lift: the shadow deepens and falls further while the note is pointed at.
  useEffect(() => {
    const shape = paperRef.current;
    if (!shape) return;
    const target = isNoteHovered
      ? { shadowOffsetY: 7, shadowBlur: 18, shadowOpacity: 0.2 }
      : { shadowOffsetY: 3, shadowBlur: 10, shadowOpacity: 0.14 };
    if (prefersReducedMotion()) {
      shape.setAttrs(target);
      shape.getLayer()?.batchDraw();
      return;
    }
    const tween = new Konva.Tween({ node: shape, duration: 0.16, easing: Konva.Easings.EaseOut, ...target });
    tween.play();
    return () => tween.destroy();
  }, [isNoteHovered]);

  const box = textBox(node.width, node.height, STICKY_PADDING, node.tags.length > 0);
  useSyncExternalStore(fontEpoch.subscribe, fontEpoch.get, fontEpoch.get);
  const writing = stickyText(node.text, box, {
    fixedSize: node.textSizing === 'fixed' ? node.fontSize : undefined,
    checklist: node.checklist,
  });
  const { layout, fontSize } = writing;
  const textTop = box.y + (writing.overflows ? 0 : Math.max(0, (box.height - layout.height) / 2));

  const initials = initialsFor(node.author.name);
  const dateLabel = node.showDate && DATE_FORMAT && node.createdAt ? DATE_FORMAT.format(node.createdAt) : '';
  const authorChipWidth = showAuthor ? authorWidth(initials) + (dateLabel ? metaWidth(`· ${dateLabel}`) + 4 : 0) : 0;
  // Only keys that are a stamp are drawn: a stored key is any string a client wrote.
  const reactions = showStamps
    ? Object.entries(node.reactions).filter(([key, ids]) => ids.length > 0 && (key === STAMP_PLUS_ONE || isEmojiLike(key)))
    : [];

  // Chips start after the author's chip and stop short of the add button.
  const startX = STICKY_PADDING + authorChipWidth;
  const availWidth = Math.max(0, node.width - startX - 10 - 24);
  const footer = layoutFooter(reactions, availWidth);

  const quick = QUICK_STAMPS;
  const traySlots = quick.length + 1;
  const trayWidth = Math.min(node.width - 12, traySlots * 28 + 8);
  const trayX = Math.max(6, Math.min(node.width - trayWidth - 6, startX - 4));
  const slot = (trayWidth - 8) / traySlots;
  const trayY = Math.max(STICKY_PADDING, node.height - FOOTER_BAND - 40);
  const traySurface = chromeToken('--surface-elevated', dark ? '#27272A' : '#FFFFFF');
  const trayInk = chromeToken('--text-secondary', dark ? '#D4D4D8' : '#4B5563');
  const trayActive = chromeToken('--surface-active', dark ? 'rgba(255,255,255,0.11)' : 'rgba(0,0,0,0.08)');

  const mineFill = paper.edge;
  const stamp = (emoji: string) => {
    if (!canComment) return;
    onToggleReaction?.(emoji);
  };

  const openPicker = (target: Konva.Node) => {
    const rect = clientRectOf(target);
    setIsPickerOpen(false);
    if (!rect) return;
    openEmojiPicker({ rect, label: 'Stamp with an emoji', onPick: (native) => stamp(native) });
  };

  const toggleItem = (source: number) => {
    if (!canEdit) return;
    updateNode(node.id, { text: toggleCheck(node.text, source) });
  };

  const setCursor = (e: Konva.KonvaEventObject<MouseEvent>, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };

  // Konva types the pattern as an image; a canvas is drawn the same way.
  const grainFill = showGrain ? (paperGrain() as unknown as HTMLImageElement | null) : null;

  return (
    <Group
      onMouseEnter={() => setIsNoteHovered(true)}
      onMouseLeave={() => {
        setIsNoteHovered(false);
        setHovered(null);
        // Both trays are hover affordances; one left open over a note nobody
        // is pointing at would cover its writing.
        setIsOverflowOpen(false);
        setIsPickerOpen(false);
      }}
    >
      {/* A soft contact shadow under the bottom edge, so the sheet reads as resting on the board. */}
      <Rect
        x={node.width * 0.08}
        y={node.height - 10}
        width={node.width * 0.84}
        height={8}
        fill="black"
        opacity={dark ? 0.32 : 0.1}
        cornerRadius={4}
        shadowColor="black"
        shadowBlur={10}
        shadowOffsetY={4}
        shadowOpacity={1}
        listening={false}
        perfectDrawEnabled={false}
      />
      {sketchPaper ? (
        <>
          <Path
            ref={paperRef as React.Ref<Konva.Path>}
            data={sketchPaper.silhouette}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: node.height }}
            fillLinearGradientColorStops={[0, paper.sheen, 0.35, paper.bg, 1, paper.bg]}
            shadowColor="black"
            shadowBlur={10}
            shadowOffsetY={3}
            shadowOpacity={0.14}
          />
          {grainFill && (
            <Path data={sketchPaper.silhouette} fillPatternImage={grainFill} opacity={dark ? 0.5 : 0.7} listening={false} perfectDrawEnabled={false} />
          )}
          <Path data={sketchPaper.outline} fill="none" stroke={paper.edge} strokeWidth={sketchPaper.edgeWidth} lineCap="round" lineJoin="round" listening={false} />
        </>
      ) : (
        <>
          <Rect
            ref={paperRef as React.Ref<Konva.Rect>}
            width={node.width}
            height={node.height}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: node.height }}
            fillLinearGradientColorStops={[0, paper.sheen, 0.35, paper.bg, 1, paper.bg]}
            cornerRadius={STICKY_RADIUS}
            shadowColor="black"
            shadowBlur={10}
            shadowOffsetY={3}
            shadowOpacity={0.14}
          />
          {grainFill && (
            <Rect
              width={node.width}
              height={node.height}
              cornerRadius={STICKY_RADIUS}
              fillPatternImage={grainFill}
              opacity={dark ? 0.5 : 0.7}
              listening={false}
              perfectDrawEnabled={false}
            />
          )}
          <Rect
            width={node.width}
            height={node.height}
            cornerRadius={STICKY_RADIUS}
            stroke={paper.edge}
            strokeWidth={1}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      )}

      {showText && (
        <Group clipX={box.x - 4} clipY={box.y} clipWidth={box.width + 8} clipHeight={box.height}>
          {layout.lines.map((line, li) => (
            <React.Fragment key={li}>
              {line.check && (
                <Group
                  x={box.x + line.x - fontSize * (CHECK_BOX + CHECK_GAP)}
                  y={textTop + line.y + (fontSize * STICKY_LINE_HEIGHT - fontSize * CHECK_BOX) / 2}
                  listening={canEdit}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    toggleItem(line.source);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    toggleItem(line.source);
                  }}
                  onMouseEnter={(e) => setCursor(e, 'pointer')}
                  onMouseLeave={(e) => setCursor(e, '')}
                >
                  <Rect
                    width={fontSize * CHECK_BOX}
                    height={fontSize * CHECK_BOX}
                    cornerRadius={fontSize * 0.14}
                    stroke={paper.ink}
                    strokeWidth={Math.max(1.2, fontSize * 0.06)}
                    fill={line.check === 'done' ? paper.ink : 'transparent'}
                    hitStrokeWidth={8}
                  />
                  {line.check === 'done' && (
                    <Path
                      data={CHECK_MARK}
                      scaleX={(fontSize * CHECK_BOX) / 24}
                      scaleY={(fontSize * CHECK_BOX) / 24}
                      stroke={paper.bg}
                      strokeWidth={3}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />
                  )}
                </Group>
              )}
              {line.runs.map((run, ri) => (
                <Text
                  key={ri}
                  text={run.text}
                  x={box.x + line.x + run.x}
                  y={textTop + line.y}
                  height={fontSize * STICKY_LINE_HEIGHT}
                  verticalAlign="middle"
                  fontSize={fontSize}
                  fontFamily={STICKY_FONT_FAMILY}
                  fontStyle={stickyFontStyle(Boolean(run.bold), Boolean(run.italic))}
                  fill={paper.ink}
                  // Caveat's body is already 600, so 700 alone barely reads as
                  // bold; a hairline of the same ink makes the step visible.
                  stroke={run.bold ? paper.ink : undefined}
                  strokeWidth={run.bold ? fontSize * 0.03 : 0}
                  fillAfterStrokeEnabled
                  opacity={line.done ? 0.55 : 1}
                  textDecoration={run.href ? 'underline' : line.done ? 'line-through' : ''}
                  wrap="none"
                  listening={Boolean(run.href)}
                  onMouseEnter={(e) => {
                    if (!run.href) return;
                    setCursor(e, 'pointer');
                    setHovered(`link:${li}:${ri}`);
                  }}
                  onMouseLeave={(e) => {
                    if (!run.href) return;
                    setCursor(e, '');
                    setHovered(null);
                  }}
                  onClick={(e) => {
                    // A plain click selects the note, as everywhere on the
                    // board; the modifier opens the link, as in an editor.
                    if (!run.href || !(e.evt.metaKey || e.evt.ctrlKey)) return;
                    e.cancelBubble = true;
                    window.open(run.href, '_blank', 'noopener,noreferrer');
                  }}
                />
              ))}
              {line.runs.map((run, ri) =>
                run.href && hovered === `link:${li}:${ri}` ? (
                  <Tip
                    key={`tip${ri}`}
                    x={box.x + line.x + run.x + run.width / 2}
                    y={textTop + line.y}
                    text={`${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl'}-click to open`}
                    dark={dark}
                  />
                ) : null
              )}
            </React.Fragment>
          ))}
        </Group>
      )}

      {node.tags.length > 0 && (
        /* Clipped to leave the pin's corner alone, pinned or not, so pinning does not shuffle the tags. */
        <Group
          x={STICKY_PADDING}
          y={10}
          listening={false}
          clipX={0}
          clipY={-4}
          clipWidth={Math.max(0, node.width - STICKY_PADDING - PIN_INSET)}
          clipHeight={24}
        >
          {node.tags.slice(0, 2).map((tag, i) => {
            const width = Math.min(74, 12 + tag.length * 5.4);
            const offset = node.tags.slice(0, i).reduce((sum, prev) => sum + Math.min(74, 12 + prev.length * 5.4) + 4, 0);
            return (
              <Group key={tag} x={offset}>
                <Rect width={width} height={15} cornerRadius={7.5} stroke={paper.secondaryInk} strokeWidth={1} opacity={0.5} />
                <Text text={tag} width={width} y={3.5} align="center" fontSize={9} fontFamily="Inter" fontStyle="600" fill={paper.secondaryInk} ellipsis wrap="none" />
              </Group>
            );
          })}
          {node.tags.length > 2 && (
            <Text
              text={`+${node.tags.length - 2}`}
              x={node.tags.slice(0, 2).reduce((s, t) => s + Math.min(74, 12 + t.length * 5.4) + 4, 0)}
              y={3.5}
              fontSize={9}
              fontFamily="Inter"
              fontStyle="600"
              fill={paper.secondaryInk}
            />
          )}
        </Group>
      )}

      {writing.overflows && showText && (
        <Text
          text="…"
          x={STICKY_PADDING}
          y={node.height - FOOTER_BAND - 18}
          width={box.width}
          align="right"
          fontSize={18}
          fontFamily="Inter"
          fontStyle="bold"
          fill={paper.secondaryInk}
          listening={false}
        />
      )}

      {/* Who wrote it, and when: a chip on the footer's one centreline. */}
      {showAuthor && (
        <Group
          x={STICKY_PADDING}
          y={node.height - FOOTER_BAND}
          onMouseEnter={() => setHovered('__author__')}
          onMouseLeave={() => setHovered((prev) => (prev === '__author__' ? null : prev))}
        >
          <Rect width={authorChipWidth - 6} height={FOOTER_ROW} fill="transparent" />
          <Circle x={3.5} y={FOOTER_ROW / 2} radius={3.5} fill={node.author.color} listening={false} />
          <Text
            text={dateLabel ? `${initials}  · ${dateLabel}` : initials}
            x={12}
            y={0}
            height={FOOTER_ROW}
            verticalAlign="middle"
            fill={paper.secondaryInk}
            fontSize={10}
            fontFamily="Inter"
            fontStyle="600"
            listening={false}
          />
          {hovered === '__author__' && (
            <Tip
              x={14}
              y={-4}
              text={node.createdAt && DATE_FORMAT ? `${node.author.name} · ${new Date(node.createdAt).toLocaleDateString()}` : node.author.name}
              dark={dark}
            />
          )}
        </Group>
      )}

      {/* The pin: pressing it unpins. A pinned note holds its place but stays editable. */}
      {node.pinned && (
        <Group
          x={node.width - PIN_INSET}
          y={16}
          rotation={32}
          onMouseEnter={() => setIsPinHovered(true)}
          onMouseLeave={() => setIsPinHovered(false)}
          onClick={(e) => {
            e.cancelBubble = true;
            if (canEdit) onTogglePin?.();
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            if (canEdit) onTogglePin?.();
          }}
        >
          <Circle radius={13} fill="transparent" />
          <Circle x={2} y={3} radius={5} fill="rgba(0,0,0,0.18)" opacity={0.6} />
          <Line points={[0, 2, 0, 13]} stroke="#94A3B8" strokeWidth={1.8} lineCap="round" />
          <Circle radius={isPinHovered ? 6.4 : 5.2} fill={paper.ink} opacity={isPinHovered ? 1 : 0.92} />
          <Circle x={-1.6} y={-1.6} radius={1.8} fill="#FFFFFF" opacity={0.45} />
          {isPinHovered && canEdit && <Tip x={0} y={-22} rotation={-32} text="Unpin" dark={dark} />}
        </Group>
      )}

      {/* Stamps: who agreed, loved, or +1'd it. */}
      {showStamps && (reactions.length > 0 || ((isNoteHovered || isPickerOpen) && canComment)) && (
        <Group x={startX} y={node.height - FOOTER_BAND}>
          {footer.visible.map(({ emoji, ids, width, offset }) => {
            const mine = ids.includes(myAuthorId);
            return (
              <Group
                key={emoji}
                x={offset}
                onMouseEnter={() => setHovered(emoji)}
                onMouseLeave={() => setHovered((prev) => (prev === emoji ? null : prev))}
                onClick={(e) => {
                  e.cancelBubble = true;
                  stamp(emoji);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  stamp(emoji);
                }}
              >
                <Rect
                  width={width}
                  height={FOOTER_ROW}
                  cornerRadius={FOOTER_ROW / 2}
                  fill={mine ? mineFill : paper.sheen}
                  stroke={mine ? paper.ink : paper.edge}
                  strokeWidth={mine ? 1.2 : 1}
                />
                <StampFace stamp={emoji} x={ids.length > 1 ? 6 : (width - 14) / 2} y={3} size={14} ink={paper.ink} />
                {ids.length > 1 && (
                  <Text
                    text={String(ids.length)}
                    x={22}
                    width={width - 26}
                    height={FOOTER_ROW}
                    verticalAlign="middle"
                    fontSize={10}
                    fontFamily="Inter"
                    fontStyle="600"
                    fill={paper.ink}
                    listening={false}
                  />
                )}
                {hovered === emoji && (
                  <Tip x={width / 2} y={-4} text={`${formatVoterSummary(ids, myAuthorId)} · ${stampLabel(emoji)}`} dark={dark} />
                )}
              </Group>
            );
          })}

          {footer.overflow.length > 0 && (
            <Group
              x={footer.overflowOffset}
              onMouseEnter={() => setHovered('__overflow__')}
              onMouseLeave={() => setHovered((prev) => (prev === '__overflow__' ? null : prev))}
              onClick={(e) => {
                e.cancelBubble = true;
                setIsOverflowOpen((open) => !open);
                setIsPickerOpen(false);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                setIsOverflowOpen((open) => !open);
                setIsPickerOpen(false);
              }}
            >
              <Rect
                width={24}
                height={FOOTER_ROW}
                cornerRadius={FOOTER_ROW / 2}
                fill={isOverflowOpen ? mineFill : paper.sheen}
                stroke={isOverflowOpen ? paper.ink : paper.edge}
                strokeWidth={1}
              />
              <Text
                text={`+${footer.overflow.length}`}
                width={24}
                height={FOOTER_ROW}
                verticalAlign="middle"
                align="center"
                fontSize={10}
                fontFamily="Inter"
                fontStyle="600"
                fill={paper.ink}
                listening={false}
              />
              {hovered === '__overflow__' && !isOverflowOpen && <Tip x={12} y={-4} text={`${footer.overflow.length} more`} dark={dark} />}
            </Group>
          )}

          {canComment && (isNoteHovered || isPickerOpen) && (
            <Group
              x={footer.addOffset}
              onMouseEnter={() => setHovered('__add__')}
              onMouseLeave={() => setHovered((prev) => (prev === '__add__' ? null : prev))}
              onClick={(e) => {
                e.cancelBubble = true;
                setIsPickerOpen((o) => !o);
                setIsOverflowOpen(false);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                setIsPickerOpen((o) => !o);
                setIsOverflowOpen(false);
              }}
            >
              <Rect width={22} height={FOOTER_ROW} cornerRadius={FOOTER_ROW / 2} fill={isPickerOpen ? mineFill : 'transparent'} stroke={paper.edge} strokeWidth={1} />
              <Path data={SMILE_PLUS} x={5} y={4} scaleX={12 / 24} scaleY={12 / 24} stroke={paper.secondaryInk} strokeWidth={2.2} lineCap="round" lineJoin="round" listening={false} />
              {hovered === '__add__' && !isPickerOpen && <Tip x={11} y={-4} text="Stamp" dark={dark} />}
            </Group>
          )}
        </Group>
      )}

      {/* The stamps the footer had no room for, as themselves. */}
      {isOverflowOpen && footer.overflow.length > 0 && (
        <Group x={trayX} y={trayY}>
          <Rect width={trayWidth} height={36} cornerRadius={10} fill={traySurface} shadowColor="black" shadowBlur={16} shadowOffsetY={6} shadowOpacity={0.16} />
          {footer.overflow.slice(0, quick.length + 1).map(([emoji, ids], i) => {
            const mine = ids.includes(myAuthorId);
            return (
              <Group
                key={emoji}
                x={4 + i * slot}
                y={4}
                onClick={(e) => {
                  e.cancelBubble = true;
                  stamp(emoji);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  stamp(emoji);
                }}
              >
                <Rect width={slot - 2} height={28} cornerRadius={7} fill={mine ? trayActive : 'transparent'} />
                <StampFace stamp={emoji} x={(slot - 2) / 2 - 8} y={2} size={16} ink={trayInk} />
                <Text text={String(ids.length)} y={19} width={slot - 2} align="center" fontSize={8} fontFamily="Inter" fontStyle="600" fill={trayInk} listening={false} />
              </Group>
            );
          })}
        </Group>
      )}

      {/* The quick stamps, and the full picker after them. */}
      {isPickerOpen && canComment && (
        <Group x={trayX} y={trayY}>
          <Rect width={trayWidth} height={36} cornerRadius={10} fill={traySurface} shadowColor="black" shadowBlur={16} shadowOffsetY={6} shadowOpacity={0.16} />
          {quick.map((emoji, i) => {
            const mine = (node.reactions[emoji] ?? []).includes(myAuthorId);
            return (
              <Group
                key={emoji}
                x={4 + i * slot}
                y={4}
                onMouseEnter={() => setTrayHover(emoji)}
                onMouseLeave={() => setTrayHover((p) => (p === emoji ? null : p))}
                onClick={(e) => {
                  e.cancelBubble = true;
                  stamp(emoji);
                  setIsPickerOpen(false);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  stamp(emoji);
                  setIsPickerOpen(false);
                }}
              >
                <Rect width={slot - 2} height={28} cornerRadius={7} fill={mine || trayHover === emoji ? trayActive : 'transparent'} />
                <StampFace stamp={emoji} x={(slot - 2) / 2 - 9} y={5} size={18} ink={trayInk} />
                {trayHover === emoji && <Tip x={(slot - 2) / 2} y={-6} text={stampLabel(emoji)} dark={dark} />}
              </Group>
            );
          })}
          <Group
            x={4 + quick.length * slot}
            y={4}
            onMouseEnter={() => setTrayHover('__more__')}
            onMouseLeave={() => setTrayHover((p) => (p === '__more__' ? null : p))}
            onClick={(e) => {
              e.cancelBubble = true;
              openPicker(e.currentTarget);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              openPicker(e.currentTarget);
            }}
          >
            <Rect width={slot - 2} height={28} cornerRadius={7} fill={trayHover === '__more__' ? trayActive : 'transparent'} />
            <Path data={SMILE_PLUS} x={(slot - 2) / 2 - 8} y={6} scaleX={16 / 24} scaleY={16 / 24} stroke={trayInk} strokeWidth={2} lineCap="round" lineJoin="round" listening={false} />
            {trayHover === '__more__' && <Tip x={(slot - 2) / 2} y={-6} text="Any emoji" dark={dark} />}
          </Group>
        </Group>
      )}
    </Group>
  );
});

StickyRenderer.displayName = 'StickyRenderer';
