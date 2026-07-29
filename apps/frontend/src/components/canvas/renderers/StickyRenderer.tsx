import React from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { StickyNode, StickyTheme } from '../../../engine/model/schema';

interface Props {
  node: StickyNode;
  isSelected: boolean;
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  showText: boolean;
}

export const THEMES: Record<StickyTheme, { bg: string; text: string; shadow: string }> = {
  yellow: { bg: '#FDE047', text: '#854D0E', shadow: 'rgba(253, 224, 71, 0.5)' },
  mint: { bg: '#6EE7B7', text: '#064E3B', shadow: 'rgba(110, 231, 183, 0.5)' },
  sky: { bg: '#7DD3FC', text: '#0C4A6E', shadow: 'rgba(125, 211, 252, 0.5)' },
  pink: { bg: '#F9A8D4', text: '#831843', shadow: 'rgba(249, 168, 212, 0.5)' },
  lavender: { bg: '#D8B4FE', text: '#4C1D95', shadow: 'rgba(216, 180, 254, 0.5)' },
  peach: { bg: '#FDBA74', text: '#7C2D12', shadow: 'rgba(253, 186, 116, 0.5)' },
  white: { bg: '#FFFFFF', text: '#1F2937', shadow: 'rgba(0, 0, 0, 0.1)' },
  dark: { bg: '#1F2937', text: '#F9FAFB', shadow: 'rgba(0, 0, 0, 0.3)' },
};

export const STICKY_PADDING = 16;

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
export const StickyRenderer: React.FC<Props> = React.memo(({ node, isSelected, showText }) => {
  const theme = THEMES[node.theme] ?? THEMES.yellow;
  const initials = (node.author.name || 'U').substring(0, 2).toUpperCase();
  const reactions = Object.entries(node.reactions);

  return (
    <Group>
      <Rect
        width={node.width}
        height={node.height}
        fill={theme.bg}
        cornerRadius={12}
        shadowColor={isSelected ? '#4F46E5' : theme.shadow}
        shadowBlur={isSelected ? 20 : 25}
        shadowOpacity={isSelected ? 0.6 : 0.8}
        shadowOffsetY={10}
        stroke={isSelected ? '#4F46E5' : undefined}
        strokeWidth={isSelected ? 3 : 0}
      />
      {/* Paper highlight */}
      <Rect width={node.width} height={node.height} cornerRadius={12} fill="rgba(255, 255, 255, 0.15)" listening={false} />

      {showText && (
        <Text
          // A single canonical `text` field. This used to read a top-level
          // `text` set once at creation while the editor committed to
          // `content.text`, so a sticky rendered blank the instant it was
          // edited even though the typed text had been saved correctly.
          text={node.text}
          x={STICKY_PADDING}
          y={STICKY_PADDING}
          width={node.width - STICKY_PADDING * 2}
          height={node.height - STICKY_PADDING * 2}
          fill={theme.text}
          fontSize={node.fontSize}
          fontFamily="Caveat, cursive"
          fontStyle="bold"
          lineHeight={1.4}
          wrap="word"
          listening={false}
        />
      )}

      {/* Peeled corner */}
      <Group x={node.width - 24} y={node.height - 24} listening={false}>
        <Rect width={24} height={24} fill="transparent" shadowColor="black" shadowBlur={8} shadowOpacity={0.2} shadowOffsetX={-2} shadowOffsetY={-2} />
        <Line points={[0, 24, 24, 0, 0, 0]} fill="rgba(255, 255, 255, 0.4)" closed />
      </Group>

      {/* Author badge */}
      <Group x={12} y={node.height - 28} listening={false}>
        <Circle radius={12} fill={node.author.color} />
        <Text text={initials} x={-12} y={-6} width={24} align="center" fill="#FFFFFF" fontSize={10} fontFamily="Inter" fontStyle="bold" />
      </Group>

      {node.pinned && <Text text="📌" x={node.width - 28} y={8} fontSize={16} listening={false} />}

      {reactions.length > 0 && (
        <Group x={40} y={node.height - 24} listening={false}>
          {reactions.map(([emoji, count], i) => (
            <Group key={emoji} x={i * 32}>
              <Rect width={28} height={18} cornerRadius={9} fill="rgba(255,255,255,0.85)" />
              <Text text={`${emoji} ${count}`} x={4} y={4} fontSize={10} fontFamily="Inter" fill="#1F2937" />
            </Group>
          ))}
        </Group>
      )}
    </Group>
  );
});

StickyRenderer.displayName = 'StickyRenderer';
