import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Circle, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type { StickyNode } from '../../../engine/model/schema';
import { initialsFor } from '../../../engine/presence/collaborators';
import { STICKY_LINE_HEIGHT } from '../../../engine/model/stickyText';
import { stickyFit, stickyFontEpoch, STICKY_FONT_FAMILY, STICKY_FONT_WEIGHT } from './stickyFit';
import { formatVoterSummary } from '../../../engine/model/voters';
import { THEMES, STICKY_PADDING, STICKY_RADIUS } from '../../../engine/model/stickyThemes';
import { rectRing, roughPolyline, roughSilhouette, seedFrom } from '../../../engine/model/rough';

interface Props {
  node: StickyNode;
  showText: boolean;
  myAuthorId: string;
  onToggleReaction?: (emoji: string) => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '🔥', '🚀', '👀', '💡', '💯'];

export const StickyRenderer: React.FC<Props> = React.memo(({ node, showText, myAuthorId, onToggleReaction }) => {
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const [hoveredPickerEmoji, setHoveredPickerEmoji] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isNoteHovered, setIsNoteHovered] = useState(false);

  const theme = THEMES[node.theme] ?? THEMES.yellow;
  const sketchLevel = node.appearance?.sketch;

  const sketchPaper = useMemo(() => {
    if (!sketchLevel) return null;
    const ring = rectRing(node.width, node.height);
    const seed = seedFrom(node.id);
    return {
      silhouette: roughSilhouette(ring, { seed, level: sketchLevel }),
      outline: roughPolyline(ring, { seed, level: sketchLevel }),
    };
  }, [node.id, node.width, node.height, sketchLevel]);

  // Room for footer badges and tags
  const hasFooter = Object.keys(node.reactions).length > 0;
  const textWidth = node.width - STICKY_PADDING * 2;
  const headerRoom = node.tags.length > 0 ? 16 : 0;
  const textHeight = node.height - STICKY_PADDING * 2 - (hasFooter ? 26 : 18) - headerRoom;

  useSyncExternalStore(stickyFontEpoch.subscribe, stickyFontEpoch.get, stickyFontEpoch.get);
  const fit = stickyFit(node.text, textWidth, textHeight);

  const initials = initialsFor(node.author.name);
  const reactions = Object.entries(node.reactions).filter(([, ids]) => ids.length > 0);

  // Bounded footer layout: compute visible vs overflow reactions to guarantee
  // that chips never spill outside the sticky note boundary.
  const startX = 52;
  const rightMargin = 10;
  const addBtnWidth = 24;
  const availWidth = Math.max(36, node.width - startX - rightMargin - addBtnWidth);

  let usedWidth = 0;
  const visibleReactions: Array<{ emoji: string; ids: string[]; width: number; offset: number }> = [];
  const overflowReactions: Array<[string, string[]]> = [];

  for (let i = 0; i < reactions.length; i++) {
    const [emoji, ids] = reactions[i];
    const width = ids.length > 1 ? 40 : 28;
    const itemFullWidth = width + 4;
    const isLast = i === reactions.length - 1;
    const needed = isLast ? itemFullWidth : itemFullWidth + 28;

    if (usedWidth + (isLast ? itemFullWidth : needed) <= availWidth) {
      visibleReactions.push({ emoji, ids, width, offset: usedWidth });
      usedWidth += itemFullWidth;
    } else {
      overflowReactions.push(...reactions.slice(i));
      break;
    }
  }

  const overflowOffset = usedWidth;
  const overflowWidth = overflowReactions.length > 0 ? 24 : 0;
  const addBtnOffset = usedWidth + (overflowReactions.length > 0 ? overflowWidth + 4 : 0);

  // Quick reaction picker geometry (clamped within sticky bounds)
  const pickerWidth = Math.min(node.width - 16, QUICK_EMOJIS.length * 25 + 10);
  const pickerX = Math.max(8, Math.min(node.width - pickerWidth - 8, startX));
  const emojiSlotWidth = (pickerWidth - 10) / QUICK_EMOJIS.length;

  return (
    <Group
      onMouseEnter={() => setIsNoteHovered(true)}
      onMouseLeave={() => {
        setIsNoteHovered(false);
        setHoveredEmoji(null);
      }}
    >
      {sketchPaper ? (
        <Group>
          <Path
            data={sketchPaper.silhouette}
            fill={theme.bg}
            shadowColor="rgba(0, 0, 0, 0.08)"
            shadowBlur={8}
            shadowOffsetY={3}
            shadowOpacity={0.7}
          />
          <Path
            data={sketchPaper.outline}
            fill="none"
            stroke={theme.edge}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
          />
        </Group>
      ) : (
        <Rect
          width={node.width}
          height={node.height}
          fill={theme.bg}
          stroke={theme.edge}
          strokeWidth={1}
          cornerRadius={STICKY_RADIUS}
          shadowColor="rgba(0, 0, 0, 0.08)"
          shadowBlur={8}
          shadowOffsetY={3}
          shadowOpacity={0.7}
        />
      )}

      {showText && (
        <Text
          text={node.text}
          x={STICKY_PADDING}
          y={STICKY_PADDING + headerRoom}
          width={textWidth}
          height={textHeight}
          fontSize={fit.fontSize}
          fontFamily={STICKY_FONT_FAMILY}
          fontStyle={STICKY_FONT_WEIGHT}
          lineHeight={STICKY_LINE_HEIGHT}
          fill={theme.text}
          align="center"
          verticalAlign="middle"
          wrap="word"
          listening={false}
        />
      )}

      {node.tags.length > 0 && (
        <Group x={STICKY_PADDING} y={10} listening={false}>
          {node.tags.slice(0, 2).map((tag, i) => {
            const width = Math.min(74, 12 + tag.length * 5.4);
            const offset = node.tags
              .slice(0, i)
              .reduce((sum, prev) => sum + Math.min(74, 12 + prev.length * 5.4) + 4, 0);
            return (
              <Group key={tag} x={offset}>
                <Rect width={width} height={15} cornerRadius={7.5} stroke={theme.text} strokeWidth={1} opacity={0.34} />
                <Text
                  text={tag}
                  width={width}
                  y={3.5}
                  align="center"
                  fontSize={9}
                  fontFamily="Inter"
                  fontStyle="600"
                  fill={theme.text}
                  opacity={0.72}
                  ellipsis
                  wrap="none"
                />
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
              fill={theme.text}
              opacity={0.55}
            />
          )}
        </Group>
      )}

      {fit.overflows && showText && (
        <Text
          text="…"
          x={STICKY_PADDING}
          y={node.height - STICKY_PADDING - 14}
          width={textWidth}
          align="right"
          fontSize={18}
          fontFamily="Inter"
          fontStyle="bold"
          fill={theme.text}
          opacity={0.55}
          listening={false}
        />
      )}

      {/* Author initials */}
      <Group x={STICKY_PADDING} y={node.height - 26} listening={false}>
        <Circle x={3} y={5} radius={3} fill={node.author.color} />
        <Text
          text={initials}
          x={12}
          y={0}
          fill={theme.text}
          opacity={0.62}
          fontSize={10}
          fontFamily="Inter"
          fontStyle="600"
          letterSpacing={0.3}
        />
      </Group>

      {node.pinned && (
        <Group x={node.width - 24} y={16} listening={false} rotation={32}>
          <Circle x={2} y={3} radius={5} fill="rgba(0,0,0,0.18)" opacity={0.6} />
          <Line points={[0, 2, 0, 13]} stroke="#94A3B8" strokeWidth={1.8} lineCap="round" />
          <Circle radius={5.2} fill={theme.text} opacity={0.92} />
          <Circle x={-1.6} y={-1.6} radius={1.8} fill="#FFFFFF" opacity={0.45} />
        </Group>
      )}

      {/* Reactions container (bounded to avoid any spill-out) */}
      {(reactions.length > 0 || isNoteHovered || isPickerOpen) && (
        <Group x={startX} y={node.height - 26}>
          {visibleReactions.map(({ emoji, ids, width, offset }) => {
            const mine = ids.includes(myAuthorId);
            return (
              <Group
                key={emoji}
                x={offset}
                onMouseEnter={() => setHoveredEmoji(emoji)}
                onMouseLeave={() => setHoveredEmoji((prev) => (prev === emoji ? null : prev))}
                onClick={(e) => {
                  e.cancelBubble = true;
                  onToggleReaction?.(emoji);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  onToggleReaction?.(emoji);
                }}
              >
                <Rect
                  width={width}
                  height={20}
                  cornerRadius={10}
                  fill={mine ? theme.text : theme.bg}
                  stroke={mine ? theme.text : theme.edge}
                  strokeWidth={1}
                  shadowColor="rgba(0,0,0,0.06)"
                  shadowBlur={mine ? 3 : 1}
                  shadowOffsetY={1}
                />
                <Text
                  text={ids.length > 1 ? `${emoji} ${ids.length}` : emoji}
                  width={width}
                  y={4.5}
                  align="center"
                  fontSize={11}
                  fontFamily="Inter"
                  fontStyle={mine ? '600' : 'normal'}
                  fill={mine ? theme.bg : theme.text}
                  listening={false}
                />
                {hoveredEmoji === emoji && (
                  <Label y={-24} x={width / 2} listening={false}>
                    <Tag
                      fill="rgba(15, 23, 42, 0.94)"
                      cornerRadius={5}
                      pointerDirection="down"
                      pointerWidth={6}
                      pointerHeight={4}
                      lineJoin="round"
                      shadowColor="rgba(0, 0, 0, 0.28)"
                      shadowBlur={4}
                      shadowOffsetY={2}
                    />
                    <Text
                      text={`${formatVoterSummary(ids, myAuthorId)} reacted`}
                      fontSize={10}
                      fontFamily="Inter"
                      fontStyle="500"
                      padding={4}
                      fill="#F8FAFC"
                    />
                  </Label>
                )}
              </Group>
            );
          })}

          {/* Compact overflow badge when reactions exceed available width */}
          {overflowReactions.length > 0 && (
            <Group
              x={overflowOffset}
              onMouseEnter={() => setHoveredEmoji('__overflow__')}
              onMouseLeave={() => setHoveredEmoji((prev) => (prev === '__overflow__' ? null : prev))}
              onClick={(e) => {
                e.cancelBubble = true;
                setIsPickerOpen(!isPickerOpen);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                setIsPickerOpen(!isPickerOpen);
              }}
            >
              <Rect
                width={24}
                height={20}
                cornerRadius={10}
                fill={theme.bg}
                stroke={theme.edge}
                strokeWidth={1}
              />
              <Text
                text={`+${overflowReactions.length}`}
                width={24}
                y={4.5}
                align="center"
                fontSize={10}
                fontFamily="Inter"
                fontStyle="600"
                fill={theme.text}
                listening={false}
              />
              {hoveredEmoji === '__overflow__' && (
                <Label y={-24} x={12} listening={false}>
                  <Tag
                    fill="rgba(15, 23, 42, 0.94)"
                    cornerRadius={5}
                    pointerDirection="down"
                    pointerWidth={6}
                    pointerHeight={4}
                    lineJoin="round"
                    shadowColor="rgba(0, 0, 0, 0.28)"
                    shadowBlur={4}
                    shadowOffsetY={2}
                  />
                  <Text
                    text={overflowReactions.map(([e, ids]) => `${e} ${ids.length}`).join('  ')}
                    fontSize={11}
                    fontFamily="Inter"
                    padding={4}
                    fill="#F8FAFC"
                  />
                </Label>
              )}
            </Group>
          )}

          {/* '+' Button: Toggles the in-place quick reaction picker tray */}
          <Group
            x={addBtnOffset}
            onClick={(e) => {
              e.cancelBubble = true;
              setIsPickerOpen(!isPickerOpen);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              setIsPickerOpen(!isPickerOpen);
            }}
          >
            <Rect
              width={20}
              height={20}
              cornerRadius={10}
              fill={isPickerOpen ? theme.text : 'transparent'}
              stroke={isPickerOpen ? theme.text : theme.edge}
              strokeWidth={1}
              dash={isPickerOpen ? undefined : [2, 2]}
              opacity={isPickerOpen ? 0.9 : 0.7}
            />
            <Text
              text={isPickerOpen ? '×' : '+'}
              width={20}
              y={isPickerOpen ? 2.5 : 3.5}
              align="center"
              fontSize={isPickerOpen ? 14 : 12}
              fontFamily="Inter"
              fontStyle="600"
              fill={isPickerOpen ? theme.bg : theme.text}
              opacity={0.85}
              listening={false}
            />
          </Group>
        </Group>
      )}

      {/* Floating In-Place Quick Reaction Palette */}
      {isPickerOpen && (
        <Group x={pickerX} y={node.height - 62}>
          <Rect
            width={pickerWidth}
            height={32}
            cornerRadius={16}
            fill="rgba(15, 23, 42, 0.96)"
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth={1}
            shadowColor="rgba(0, 0, 0, 0.35)"
            shadowBlur={12}
            shadowOffsetY={4}
          />
          {QUICK_EMOJIS.map((emoji, index) => {
            const isHovered = hoveredPickerEmoji === emoji;
            const isMine = (node.reactions[emoji] ?? []).includes(myAuthorId);
            const slotX = 5 + index * emojiSlotWidth;

            return (
              <Group
                key={emoji}
                x={slotX}
                y={4}
                onMouseEnter={() => setHoveredPickerEmoji(emoji)}
                onMouseLeave={() => setHoveredPickerEmoji((prev) => (prev === emoji ? null : prev))}
                onClick={(e) => {
                  e.cancelBubble = true;
                  onToggleReaction?.(emoji);
                  setIsPickerOpen(false);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  onToggleReaction?.(emoji);
                  setIsPickerOpen(false);
                }}
              >
                <Rect
                  width={emojiSlotWidth - 2}
                  height={24}
                  cornerRadius={12}
                  fill={isMine ? 'rgba(59, 130, 246, 0.45)' : isHovered ? 'rgba(255, 255, 255, 0.18)' : 'transparent'}
                />
                <Text
                  text={emoji}
                  width={emojiSlotWidth - 2}
                  y={4}
                  align="center"
                  fontSize={13}
                  listening={false}
                />
              </Group>
            );
          })}
        </Group>
      )}
    </Group>
  );
});

StickyRenderer.displayName = 'StickyRenderer';
