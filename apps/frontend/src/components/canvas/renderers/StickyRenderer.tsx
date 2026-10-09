import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Circle, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type { StickyNode } from '../../../engine/model/schema';
import { initialsFor } from '../../../engine/presence/collaborators';
import { fontEpoch } from '../../../engine/text/fontEpoch';
import { formatVoterSummary } from '../../../engine/model/voters';
import { faceStops, flapStops, paperOf, paperShadows, STICKY_PADDING, STICKY_RADIUS, type Stops } from '../../../engine/model/stickyThemes';
import { flapPath, flapPlacement, foldedPaperPath, foldSize, FOLD_LIFT_SCALE } from '../../../engine/model/stickyFold';
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
import { useTextAsBlocks } from '../../../engine/render/lod';
import { paperGrain } from './paperGrain';

interface Props {
  node: StickyNode;
  showText: boolean;
  myAuthorId: string;
  onToggleReaction?: (emoji: string) => void;
  onTogglePin?: () => void;
}


/**
 * How much of the paper is worth drawing, by how large the note is on screen.
 *
 * - **0**, under `SHADOW_MIN_PX` across: the paper and its fold, no shadows.
 *   A board of hundreds of notes seen from far out pays for no blur it cannot show.
 * - **1**: the shadows, the fold's included.
 * - **2**, from `GRAIN_MIN_PX`: the grain as well, which is invisible below that.
 */
const SHADOW_MIN_PX = 36;
const GRAIN_MIN_PX = 110;

/** Konva's flat colour-stop list, from the shared `[offset, colour]` pairs. */
const konvaStops = (stops: Stops): Array<number | string> => stops.flatMap(([at, colour]) => [at, colour]);

const SMILE_PLUS =
  'M22 11v1a10 10 0 1 1-9-10M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6';
const CHECK_MARK = 'M5 12.5l4.2 4.2L19 7';

const subscribeCamera = (fn: () => void) => engineEvents.on('CameraChanged', fn);

/** The detail level for a note whose short side is `worldSize`, re-rendering only when it changes. */
function usePaperDetail(worldSize: number): 0 | 1 | 2 {
  const read = useCallback(() => {
    const px = worldSize * cameraSystem.zoom;
    return px >= GRAIN_MIN_PX ? 2 : px >= SHADOW_MIN_PX ? 1 : 0;
  }, [worldSize]);
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
 * when the note is large on screen, the bottom-right corner turned over
 * (`stickyFold`: the sheet is cut along the crease and the corner lies on it),
 * and a two-layer shadow — contact and ambient — that comes off the board under
 * the pointer while the corner peels up a little further. The writing is laid
 * out by `stickyRichLayout` — balanced lines, bold and italic, links,
 * checklists — and the paper's ink is checked against the paper in both themes.
 */
export const StickyRenderer: React.FC<Props> = React.memo(({ node, showText, myAuthorId, onToggleReaction, onTogglePin }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const [trayHover, setTrayHover] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isNoteHovered, setIsNoteHovered] = useState(false);
  const [isPinHovered, setIsPinHovered] = useState(false);
  /** Carries the ambient shadow, under the sheet. */
  const casterRef = useRef<Konva.Path>(null);
  /** The sheet itself, carrying the contact shadow. */
  const paperRef = useRef<Konva.Path>(null);
  /** The folded corner's frame, scaled to lift it. */
  const flapFrameRef = useRef<Konva.Group>(null);
  const flapRef = useRef<Konva.Path>(null);
  const { canEdit, canComment } = useRoomPermissions();

  const dark = useChromeDark();
  const paper = paperOf(node.theme, dark);
  const sketchLevel = useSketchLevel(node.appearance);
  const detail = usePaperDetail(Math.min(node.width, node.height));
  const showGrain = detail === 2;
  const showShadows = detail >= 1;
  // A translucent note would show the caster through the sheet, so it keeps
  // one shadow (the ambient, on the sheet) instead of two.
  const layered = (node.opacity ?? 1) >= 1;
  const showAuthor = node.showAuthor !== false;
  const showStamps = node.showStamps !== false;

  const fold = foldSize(node.width, node.height);
  const place = flapPlacement(node.width, node.height, fold);
  const sheetPath = useMemo(() => foldedPaperPath(node.width, node.height, STICKY_RADIUS, fold), [node.width, node.height, fold]);
  const flapData = useMemo(() => flapPath(place.half), [place.half]);
  const rest = paperShadows(dark, false, fold);
  const sheetShadow = layered ? rest.contact : rest.ambient;

  // The paper cut by hand, from the same builder the exporter uses (`roughStickyPaper`).
  const sketchSeed = node.appearance?.sketchSeed;
  const sketchPaper = useMemo(
    () => (sketchLevel ? roughStickyPaper({ id: node.id, width: node.width, height: node.height, appearance: { sketchSeed } }, sketchLevel) : null),
    [node.id, node.width, node.height, sketchLevel, sketchSeed]
  );
  /** The sheet's region: hand-cut in sketch mode, crisp otherwise. Either way the corner is cut. */
  const sheetOutline = sketchPaper?.silhouette ?? sheetPath;
  const faceStopList = useMemo(() => konvaStops(faceStops(paper)), [paper]);
  const flapStopList = useMemo(() => konvaStops(flapStops(paper)), [paper]);

  /**
   * The lift, under the pointer: the contact shadow softens, the ambient one
   * widens and falls further, and the corner peels up off the sheet.
   *
   * The resting values are the props, so React never re-applies them while the
   * note is lifted; the tween owns the attributes between the two states.
   */
  useEffect(() => {
    const s = paperShadows(dark, isNoteHovered, fold);
    const sheet = layered ? s.contact : s.ambient;
    const targets: Array<[Konva.Node | null, Konva.NodeConfig]> = [
      [casterRef.current, { shadowOffsetY: s.ambient.offsetY, shadowBlur: s.ambient.blur, shadowOpacity: s.ambient.opacity }],
      [paperRef.current, { shadowOffsetY: sheet.offsetY, shadowBlur: sheet.blur, shadowOpacity: sheet.opacity }],
      [flapFrameRef.current, { scaleY: isNoteHovered ? FOLD_LIFT_SCALE : 1 }],
      [flapRef.current, { shadowOffsetX: s.flap.offsetX, shadowOffsetY: s.flap.offsetY, shadowBlur: s.flap.blur, shadowOpacity: s.flap.opacity }],
    ];
    const live = targets.filter((t): t is [Konva.Node, Konva.NodeConfig] => t[0] !== null);
    if (live.length === 0) return;
    if (prefersReducedMotion()) {
      for (const [shape, attrs] of live) shape.setAttrs(attrs);
      live[0][0].getLayer()?.batchDraw();
      return;
    }
    const tweens = live.map(
      ([shape, attrs]) => new Konva.Tween({ node: shape, duration: isNoteHovered ? 0.2 : 0.16, easing: Konva.Easings.EaseOut, ...attrs })
    );
    for (const t of tweens) t.play();
    return () => {
      for (const t of tweens) t.destroy();
    };
  }, [isNoteHovered, dark, fold, layered, showShadows, sketchPaper]);

  const box = textBox(node.width, node.height, STICKY_PADDING, node.tags.length > 0);
  useSyncExternalStore(fontEpoch.subscribe, fontEpoch.get, fontEpoch.get);
  const writing = stickyText(node.text, box, {
    fixedSize: node.textSizing === 'fixed' ? node.fontSize : undefined,
    checklist: node.checklist,
  });
  const { layout, fontSize } = writing;
  // Too small on screen to read (lite budget only): each line is a block of ink.
  const blocks = useTextAsBlocks(fontSize);
  const textTop = box.y + (writing.overflows ? 0 : Math.max(0, (box.height - layout.height) / 2));

  const initials = initialsFor(node.author.name);
  const dateLabel = node.showDate && DATE_FORMAT && node.createdAt ? DATE_FORMAT.format(node.createdAt) : '';
  const authorChipWidth = showAuthor ? authorWidth(initials) + (dateLabel ? metaWidth(`· ${dateLabel}`) + 4 : 0) : 0;
  // Only keys that are a stamp are drawn: a stored key is any string a client wrote.
  const reactions = showStamps
    ? Object.entries(node.reactions).filter(([key, ids]) => ids.length > 0 && (key === STAMP_PLUS_ONE || isEmojiLike(key)))
    : [];

  // Chips start after the author's chip and stop short of the add button,
  // which itself stops short of the folded corner.
  const startX = STICKY_PADDING + authorChipWidth;
  const availWidth = Math.max(0, node.width - startX - Math.max(10, fold + 6) - 24);
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
      {/* The ambient shadow, cast by a copy of the sheet's outline under it. */}
      {showShadows && layered && (
        <Path
          ref={casterRef}
          data={sheetOutline}
          fill={paper.bg}
          shadowColor="black"
          shadowOffsetY={rest.ambient.offsetY}
          shadowBlur={rest.ambient.blur}
          shadowOpacity={rest.ambient.opacity}
          shadowForStrokeEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {/* The sheet, carrying the contact shadow. */}
      <Path
        ref={paperRef}
        data={sheetOutline}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: node.height }}
        fillLinearGradientColorStops={faceStopList}
        shadowEnabled={showShadows}
        shadowColor="black"
        shadowOffsetY={sheetShadow.offsetY}
        shadowBlur={sheetShadow.blur}
        shadowOpacity={sheetShadow.opacity}
        shadowForStrokeEnabled={false}
      />
      {grainFill && <Path data={sheetOutline} fillPatternImage={grainFill} opacity={dark ? 0.5 : 0.7} listening={false} perfectDrawEnabled={false} />}
      {sketchPaper ? (
        // No fill: the outline is open, overshooting strokes, and Konva reads
        // `fill="none"` as no colour at all and fills the slivers between them black.
        <Path data={sketchPaper.outline} stroke={paper.edge} strokeWidth={sketchPaper.edgeWidth} lineCap="round" lineJoin="round" listening={false} />
      ) : (
        // A hairline on screen at any zoom, as the selection ring is; scaled with
        // the board it reads as a printed border once the note is large.
        <Path data={sheetPath} stroke={paper.edge} strokeWidth={1} strokeScaleEnabled={false} listening={false} perfectDrawEnabled={false} />
      )}

      {/* The turned corner, in its own frame (see `stickyFold`): lying on the sheet, lifting with it. */}
      {fold > 0 && (
        <Group ref={flapFrameRef} x={place.x} y={place.y} rotation={place.rotation} listening={false}>
          {sketchPaper ? (
            // The hand-cut flap is drawn in the note's space, so it is mapped
            // back into the frame: the frame's inverse, then the frame.
            <Group rotation={-place.rotation} offsetX={place.x} offsetY={place.y}>
              <Path
                ref={flapRef}
                data={sketchPaper.flap.silhouette}
                fill={paper.back}
                shadowEnabled={showShadows}
                shadowColor="black"
                shadowOffsetX={rest.flap.offsetX}
                shadowOffsetY={rest.flap.offsetY}
                shadowBlur={rest.flap.blur}
                shadowOpacity={rest.flap.opacity}
                shadowForStrokeEnabled={false}
              />
              <Path data={sketchPaper.flap.outline} stroke={paper.edge} strokeWidth={sketchPaper.edgeWidth} lineCap="round" lineJoin="round" />
            </Group>
          ) : (
            <Path
              ref={flapRef}
              data={flapData}
              fillLinearGradientStartPoint={{ x: 0, y: 0 }}
              fillLinearGradientEndPoint={{ x: 0, y: place.half }}
              fillLinearGradientColorStops={flapStopList}
              stroke={paper.edge}
              strokeWidth={0.75}
              strokeScaleEnabled={false}
              lineJoin="round"
              shadowEnabled={showShadows}
              shadowColor="black"
              shadowOffsetX={rest.flap.offsetX}
              shadowOffsetY={rest.flap.offsetY}
              shadowBlur={rest.flap.blur}
              shadowOpacity={rest.flap.opacity}
              shadowForStrokeEnabled={false}
            />
          )}
        </Group>
      )}

      {showText && blocks && (
        <Group listening={false}>
          {layout.lines.map((line, li) =>
            line.width > 0 ? (
              <Rect
                key={li}
                x={box.x + line.x}
                y={textTop + line.y + fontSize * ((STICKY_LINE_HEIGHT - 0.6) / 2)}
                width={Math.min(line.width, box.width)}
                height={fontSize * 0.6}
                cornerRadius={fontSize * 0.15}
                fill={paper.ink}
                opacity={0.35}
                perfectDrawEnabled={false}
              />
            ) : null
          )}
        </Group>
      )}

      {showText && !blocks && (
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
