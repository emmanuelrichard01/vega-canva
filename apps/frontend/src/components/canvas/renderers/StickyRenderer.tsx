import React, { useSyncExternalStore } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { StickyNode, StickyTheme } from '../../../engine/model/schema';
import { initialsFor } from '../../../engine/presence/collaborators';
import { STICKY_LINE_HEIGHT } from '../../../engine/model/stickyText';
import { stickyFit, stickyFontEpoch, STICKY_FONT_FAMILY, STICKY_FONT_WEIGHT } from './stickyFit';

interface Props {
  node: StickyNode;
  /**
   * No `isSelected`. The note used to draw its own selection state — a 3px
   * indigo stroke plus a 20px indigo glow — while `ObjectRenderer` draws a
   * hairline outset ring for *every* object type. Two selection languages on
   * one canvas, and the sticky's was the loud one.
   */
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  showText: boolean;
  /** Whose reactions are highlighted, and who a chip click reacts as. */
  myAuthorId: string;
  onToggleReaction?: (emoji: string) => void;
}

/**
 * The note palette.
 *
 * Rebuilt from fully saturated highlighter colours (`#FDE047`, `#6EE7B7`) to a
 * paper-weight set. Three reasons, in order of how much they show:
 *
 * 1. **A wall of saturated notes is exhausting to read.** The colour should
 *    label the note, not compete with what is written on it — and at
 *    brainstorm density the old palette turned the board into a highlighter
 *    tray. Softer paper lets the *ink* carry the content.
 * 2. **Each ink is a deep version of its own hue**, not a generic dark gray.
 *    A note then reads as one material rather than as text sitting on a
 *    coloured rectangle, and every pair clears WCAG AA comfortably.
 * 3. **`edge` is a hairline in a darker tint of the paper.** Without it a pale
 *    note on a pale board has no boundary at all — the old palette got away
 *    with this only because it was loud enough to define its own edge.
 */
export const THEMES: Record<StickyTheme, { bg: string; text: string; edge: string; shadow: string }> = {
  yellow: { bg: '#FFE9A8', text: '#6B4E05', edge: '#F0D179', shadow: 'rgba(0,0,0,0.18)' },
  mint: { bg: '#BCEBD7', text: '#0F5540', edge: '#93D8BB', shadow: 'rgba(0,0,0,0.18)' },
  sky: { bg: '#C3E1FA', text: '#0C4C74', edge: '#98C9EC', shadow: 'rgba(0,0,0,0.18)' },
  pink: { bg: '#FBD2E1', text: '#7C2749', edge: '#F0B1C9', shadow: 'rgba(0,0,0,0.18)' },
  lavender: { bg: '#DDD5F8', text: '#412E7C', edge: '#C5B8EE', shadow: 'rgba(0,0,0,0.18)' },
  peach: { bg: '#FDDBBF', text: '#7C3E15', edge: '#F5C098', shadow: 'rgba(0,0,0,0.18)' },
  white: { bg: '#FFFFFF', text: '#1F2937', edge: '#E4E6EA', shadow: 'rgba(0,0,0,0.16)' },
  dark: { bg: '#2B303B', text: '#E9ECF3', edge: '#3E4553', shadow: 'rgba(0,0,0,0.34)' },
};

export const STICKY_PADDING = 18;
/** Softened a little from 12: a note is paper, not a chip of chrome. */
export const STICKY_RADIUS = 14;

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

/**
 * Snap an arbitrary colour to the nearest sticky theme.
 *
 * Sticky backgrounds are a closed set of presets, but the colour picker offers
 * a free hex field. Requiring an exact match meant any colour that was not one
 * of the eight presets entered verbatim silently fell back to yellow.
 */
export function nearestTheme(hex: string): StickyTheme {
  const target = hexToRgb(hex);
  let best: StickyTheme = 'yellow';
  let bestDist = Infinity;
  (Object.keys(THEMES) as StickyTheme[]).forEach((name) => {
    const c = hexToRgb(THEMES[name].bg);
    const dist = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  });
  return best;
}

/**
 * Sticky note.
 *
 * x/y/rotation/scale are deliberately NOT applied here — the owning object
 * group already positions this subtree. Re-applying them compounded
 * additively, so a sticky at world x=640 drew at x≈1280, and increasingly
 * wrongly the further it sat from the origin.
 */
export const StickyRenderer: React.FC<Props> = React.memo(({ node, showText, myAuthorId, onToggleReaction }) => {
  const theme = THEMES[node.theme] ?? THEMES.yellow;

  // Room for the author badge and any reaction chips along the bottom, so
  // long text stops above them instead of running underneath.
  const hasFooter = Object.keys(node.reactions).length > 0;
  const textWidth = node.width - STICKY_PADDING * 2;
  // Tags occupy a strip along the top, so the text has to give up that room —
  // otherwise long text slides underneath them.
  const headerRoom = node.tags.length > 0 ? 16 : 0;
  const textHeight = node.height - STICKY_PADDING * 2 - (hasFooter ? 26 : 18) - headerRoom;

  // Subscribing re-renders this note once the webfont lands, so it re-measures
  // — sizes fitted against the fallback cursive on the first paint are simply
  // wrong. See `stickyFontEpoch`.
  useSyncExternalStore(stickyFontEpoch.subscribe, stickyFontEpoch.get, stickyFontEpoch.get);
  const fit = stickyFit(node.text, textWidth, textHeight);

  // `initialsFor`, so a sticky's badge matches the avatar row, the presence
  // markers and the comment rows. This took the first two *letters* — "Da" for
  // Dana Ito, where everything else in the app says "DI".
  const initials = initialsFor(node.author.name);
  const reactions = Object.entries(node.reactions);

  return (
    <Group>
      {/* The note.

          The elevation used to be a 25px blur of the note's *own colour* at
          80% opacity, offset 10px — a coloured glow rather than a shadow, which
          is what made a board of these look like a 2010 desktop widget. A
          card sitting on a surface casts a small, tight, neutral shadow; this
          is that. The white 15% wash that used to sit over the whole note is
          gone too: it desaturated every theme toward pastel and was the reason
          the eight colours read as four. */}
      <Rect
        width={node.width}
        height={node.height}
        fill={theme.bg}
        cornerRadius={STICKY_RADIUS}
        // A hairline in a darker tint of the paper, so a pale note still has a
        // boundary on a pale board. Scaled by zoom so it stays one pixel.
        stroke={theme.edge}
        strokeWidth={1}
        strokeScaleEnabled={false}
        shadowColor="#0B1020"
        shadowBlur={14}
        shadowOpacity={0.18}
        shadowOffsetY={5}
      />

      {showText && (
        <Text
          // A single canonical `text` field. This used to read a top-level
          // `text` set once at creation while the editor committed to
          // `content.text`, so a sticky rendered blank the instant it was
          // edited even though the typed text had been saved correctly.
          text={node.text}
          x={STICKY_PADDING}
          y={STICKY_PADDING + headerRoom}
          width={textWidth}
          height={textHeight}
          fill={theme.text}
          // Fitted, not stored. See `engine/model/stickyText.ts`: a fixed size
          // clipped anything past the bottom edge and lost it in silence.
          fontSize={fit.fontSize}
          fontFamily={STICKY_FONT_FAMILY}
          // Semibold, not bold. At the sizes short notes reach, bold is a
          // shout; 600 keeps the weight without the note yelling.
          fontStyle={STICKY_FONT_WEIGHT}
          lineHeight={STICKY_LINE_HEIGHT}
          // Centred both ways, which is what makes a short note look composed
          // rather than stranded in the top-left of a big square. Matched
          // exactly by the editor overlay.
          align="center"
          verticalAlign="middle"
          wrap="word"
          listening={false}
        />
      )}

      {/* Tags, along the top edge.
          At most two are drawn: a note is a thought, and a row of six labels
          across the top of it buries the thought. The rest are counted, and
          the full set lives in the Properties panel. */}
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

      {/* A note too full to fit even at the smallest size says so, rather than
          quietly hiding the end of the sentence. */}
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

      {/* Author.
          A 24px disc in the author's colour was the loudest thing on a note
          whose whole job is to show the words. It is a small dot and the
          initials in the note's own ink now — present when you look for it,
          silent when you are reading. */}
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
        // A drawn pin, not the 📌 emoji. Emoji render in the OS's own font, so
        // this was a different picture on every platform and the only glyph in
        // the app that ignored the icon set entirely.
        <Group x={node.width - 26} y={14} listening={false} rotation={38}>
          <Line points={[0, 0, 0, 11]} stroke={theme.text} strokeWidth={2} lineCap="round" opacity={0.75} />
          <Circle radius={4.5} fill={theme.text} opacity={0.75} />
        </Group>
      )}

      {reactions.length > 0 && (
        // Clear of the author line — dot plus two initials — which runs to
        // about x=48. Anything tighter and the first chip clips the name.
        <Group x={60} y={node.height - 26}>
          {reactions.map(([emoji, ids], i) => {
            const mine = ids.includes(myAuthorId);
            const width = ids.length > 1 ? 40 : 28;
            const offset = reactions
              .slice(0, i)
              .reduce((sum, [, prev]) => sum + (prev.length > 1 ? 40 : 28) + 4, 0);
            return (
              <Group
                key={emoji}
                x={offset}
                // Interactive: the chips were `listening={false}`, so the one
                // place a reaction is actually visible was the one place you
                // could not use it. Clicking a chip toggles your own.
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
                  // Yours is filled in the note's ink; everyone else's is the
                  // paper with a hairline. Same two-tone language as the
                  // note itself rather than a white pill borrowed from nowhere.
                  fill={mine ? theme.text : theme.bg}
                  stroke={mine ? theme.text : theme.edge}
                  strokeWidth={1}
                />
                <Text
                  text={ids.length > 1 ? `${emoji} ${ids.length}` : emoji}
                  width={width}
                  y={5}
                  align="center"
                  fontSize={11}
                  fontFamily="Inter"
                  fill={mine ? theme.bg : '#1F2937'}
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
