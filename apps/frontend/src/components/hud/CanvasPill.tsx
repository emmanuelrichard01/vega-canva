import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import type { HudTone } from '../../engine/ui/hud';
import { HUD_PILL, hudColors, hudPillWidth } from '../../engine/ui/hudPill';

interface Props {
  /** Board position of the pill's top-left corner. */
  x: number;
  y: number;
  text: string;
  tone: HudTone;
  /** Camera zoom: the pill is drawn at a constant screen size. */
  zoom: number;
  /** Increased contrast: a surface ring separates the pill from busy content. */
  haloColor?: string;
}

/**
 * The HUD pill, drawn by Konva, for labels attached to canvas-drawn lines.
 *
 * Same metrics and tokens as the DOM pill in `hud.css`. Held at screen size by
 * scaling a group by 1/zoom, so the text is laid out at its real size and
 * stays crisp instead of being drawn at 11/zoom and scaled back up.
 */
export const CanvasPill: React.FC<Props> = ({ x, y, text, tone, zoom, haloColor }) => {
  const c = hudColors();
  const width = hudPillWidth(text);
  const s = 1 / (zoom || 1);
  return (
    <Group x={x} y={y} scaleX={s} scaleY={s} listening={false}>
      <Rect
        width={width}
        height={HUD_PILL.height}
        cornerRadius={HUD_PILL.radius}
        fill={tone === 'measure' ? c.measure : c.object}
        stroke={haloColor}
        strokeWidth={haloColor ? 1.5 : 0}
        strokeEnabled={Boolean(haloColor)}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Text
        width={width}
        height={HUD_PILL.height}
        align="center"
        verticalAlign="middle"
        text={text}
        fontSize={HUD_PILL.fontSize}
        fontStyle={HUD_PILL.fontStyle}
        fontFamily={HUD_PILL.fontFamily}
        fill={c.ink}
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  );
};

/** The pill's size in screen pixels, for callers that place it. */
export function canvasPillSize(text: string): { width: number; height: number } {
  return { width: hudPillWidth(text), height: HUD_PILL.height };
}
