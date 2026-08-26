import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Circle, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import type { StickyNode } from '../../../engine/model/schema';
import { initialsFor } from '../../../engine/presence/collaborators';
import { STICKY_LINE_HEIGHT } from '../../../engine/model/stickyText';
import { stickyFit, stickyFontEpoch, STICKY_FONT_FAMILY, STICKY_FONT_WEIGHT } from './stickyFit';
import { formatVoterSummary } from '../../../engine/model/voters';
import { THEMES, STICKY_PADDING, STICKY_RADIUS } from '../../../engine/model/stickyThemes';
import { FOOTER_BAND, layoutFooter, PIN_INSET, textBox } from '../../../engine/model/stickyFooter';
import { rectRing, roughPolyline, roughSilhouette, seedFrom } from '../../../engine/model/rough';

interface Props {
  node: StickyNode;
  showText: boolean;
  myAuthorId: string;
  onToggleReaction?: (emoji: string) => void;
  onTogglePin?: () => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '🔥', '🚀', '👀', '💡', '💯'];

export const StickyRenderer: React.FC<Props> = React.memo(({ node, showText, myAuthorId, onToggleReaction, onTogglePin }) => {
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const [hoveredPickerEmoji, setHoveredPickerEmoji] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  /** The overflowed reactions, shown as themselves rather than as a count. */
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isNoteHovered, setIsNoteHovered] = useState(false);
  const [isPinHovered, setIsPinHovered] = useState(false);

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

  /**
   * The text's box, reserved the same way whether or not anybody has reacted.
   *
   * `textBox` owns this now, and both the fitter and the `<Text>` below read it
   * -- they used to derive it separately from the same fields and ended up with
   * two different ideas of whether a footer existed, which is what made the
   * handwriting shrink the first time someone reacted to a note.
   */
  const box = textBox(node.width, node.height, STICKY_PADDING, node.tags.length > 0);

  useSyncExternalStore(stickyFontEpoch.subscribe, stickyFontEpoch.get, stickyFontEpoch.get);
  const fit = stickyFit(node.text, box.width, box.height);

  const initials = initialsFor(node.author.name);
  const reactions = Object.entries(node.reactions).filter(([, ids]) => ids.length > 0);

  // The run of chips starts after the author's own chip and stops short of the
  // add button. No floor: on a note too narrow for even one chip everything
  // belongs in the overflow badge, and forcing room for a chip that cannot fit
  // is what put them outside the paper.
  const startX = 52;
  const availWidth = Math.max(0, node.width - startX - 10 - 24);
  const footer = layoutFooter(reactions, availWidth);

  // The trays hang above the footer, and are kept inside the paper on a note
  // too short to hold them below the text.
  const pickerWidth = Math.min(node.width - 16, QUICK_EMOJIS.length * 25 + 10);
  const pickerX = Math.max(8, Math.min(node.width - pickerWidth - 8, startX));
  const emojiSlotWidth = (pickerWidth - 10) / QUICK_EMOJIS.length;
  const trayY = Math.max(STICKY_PADDING, node.height - 62);

  return (
    <Group
      onMouseEnter={() => setIsNoteHovered(true)}
      onMouseLeave={() => {
        setIsNoteHovered(false);
        setHoveredEmoji(null);
        // Both trays are hover affordances. Leaving one open over a note nobody
        // is pointing at covers the note's own text with a black bar.
        setIsOverflowOpen(false);
        setIsPickerOpen(false);
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
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
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
        /**
         * Clipped to leave the pin's corner alone.
         *
         * The pin sits at `width - PIN_INSET` and the tag row started at the
         * padding and ran as far as its chips wanted -- two long tags on a
         * narrow note reached straight under it. The room is reserved whether
         * or not the note is pinned, so pinning one does not shuffle its tags.
         */
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
          width={box.width}
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
      <Group x={STICKY_PADDING} y={node.height - FOOTER_BAND} listening={false}>
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

      {/*
        The pin: a control, and one that means something.

        It was drawn `listening={false}` -- a badge you could look at and not
        touch, so the only way to unpin a note was to find the button on the
        contextual rail or the properties panel. A pin drawn *on* the note is
        the obvious place to press to take it out, and it now is one.

        `pinned` also does something now. It was a field the renderer drew and
        nothing else honoured, while the properties panel's own hint promised a
        pinned note "stays put" -- so the promise was simply untrue. A pinned
        note is held where it is and cannot be dragged; everything else about it
        stays live, which is what separates it from `locked`.
      */}
      {node.pinned && (
        <Group
          x={node.width - PIN_INSET}
          y={16}
          rotation={32}
          onMouseEnter={() => setIsPinHovered(true)}
          onMouseLeave={() => setIsPinHovered(false)}
          onClick={(e) => { e.cancelBubble = true; onTogglePin?.(); }}
          onTap={(e) => { e.cancelBubble = true; onTogglePin?.(); }}
        >
          {/* The press target, larger than the drawing and invisible: a five
              pixel pinhead is not something anyone can hit. */}
          <Circle radius={13} fill="transparent" />
          <Circle x={2} y={3} radius={5} fill="rgba(0,0,0,0.18)" opacity={0.6} />
          <Line points={[0, 2, 0, 13]} stroke="#94A3B8" strokeWidth={1.8} lineCap="round" />
          <Circle radius={isPinHovered ? 6.4 : 5.2} fill={theme.text} opacity={isPinHovered ? 1 : 0.92} />
          <Circle x={-1.6} y={-1.6} radius={1.8} fill="#FFFFFF" opacity={0.45} />
          {isPinHovered && (
            // Counter-rotated, because the pin is drawn at 32° and a tooltip
            // that leaned with it would be the only tilted text on the canvas.
            <Label y={-22} x={0} rotation={-32} listening={false}>
              <Tag
                fill="rgba(15, 23, 42, 0.94)"
                cornerRadius={5}
                pointerDirection="down"
                pointerWidth={6}
                pointerHeight={4}
                lineJoin="round"
              />
              <Text text="Unpin" fontSize={10} fontFamily="Inter" fontStyle="500" padding={4} fill="#F8FAFC" />
            </Label>
          )}
        </Group>
      )}

      {/* Reactions container (bounded to avoid any spill-out) */}
      {(reactions.length > 0 || isNoteHovered || isPickerOpen) && (
        <Group x={startX} y={node.height - FOOTER_BAND}>
          {footer.visible.map(({ emoji, ids, width, offset }) => {
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
          {footer.overflow.length > 0 && (
            <Group
              x={footer.overflowOffset}
              onMouseEnter={() => setHoveredEmoji('__overflow__')}
              onMouseLeave={() => setHoveredEmoji((prev) => (prev === '__overflow__' ? null : prev))}
              /**
               * It shows what it counted.
               *
               * "+3" is a promise that there are three more of the thing beside
               * it. Clicking it opened the *emoji picker* -- a different tray,
               * offering a different action, on a control whose label said
               * "see the rest". Now it opens the rest, as real chips you can
               * click to add or remove your own reaction.
               */
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
                height={20}
                cornerRadius={10}
                fill={isOverflowOpen ? theme.text : theme.bg}
                stroke={isOverflowOpen ? theme.text : theme.edge}
                strokeWidth={1}
              />
              <Text
                text={`+${footer.overflow.length}`}
                width={24}
                y={4.5}
                align="center"
                fontSize={10}
                fontFamily="Inter"
                fontStyle="600"
                fill={isOverflowOpen ? theme.bg : theme.text}
                listening={false}
              />
              {hoveredEmoji === '__overflow__' && !isOverflowOpen && (
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
                    text={footer.overflow.map(([e, ids]) => `${e} ${ids.length}`).join('  ')}
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
            x={footer.addOffset}
            onClick={(e) => {
              e.cancelBubble = true;
              setIsPickerOpen(!isPickerOpen);
              setIsOverflowOpen(false);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              setIsPickerOpen(!isPickerOpen);
              setIsOverflowOpen(false);
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

      {/* The reactions the footer had no room for, as themselves. */}
      {isOverflowOpen && footer.overflow.length > 0 && (
        <Group x={pickerX} y={trayY}>
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
          {footer.overflow.slice(0, 6).map(([emoji, ids], index) => {
            const mine = ids.includes(myAuthorId);
            const slot = (pickerWidth - 10) / Math.min(6, footer.overflow.length);
            return (
              <Group
                key={emoji}
                x={5 + index * slot}
                y={4}
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
                  width={slot - 2}
                  height={24}
                  cornerRadius={12}
                  fill={mine ? 'rgba(59, 130, 246, 0.45)' : 'rgba(255, 255, 255, 0.10)'}
                />
                <Text
                  text={`${emoji} ${ids.length}`}
                  width={slot - 2}
                  y={5}
                  align="center"
                  fontSize={11}
                  fontFamily="Inter"
                  fill="#F8FAFC"
                  listening={false}
                />
              </Group>
            );
          })}
        </Group>
      )}

      {/* Floating In-Place Quick Reaction Palette */}
      {isPickerOpen && (
        <Group x={pickerX} y={trayY}>
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
