import * as React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { gridDefaults } from '../grid/gridDefaults';
import { layoutGrid } from '../grid/gridLayout';
import { styleCells } from '../grid/gridStyle';

/**
 * The preview: the cells themselves, at a whisper, with a crisp CAD HUD badge.
 */
export const GridPreview: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}> = ({ x, y, width, height, scale }) => {
  if (width < 4 || height < 4) return null;
  const recipe = gridDefaults.forBox({ x, y, width, height });
  const cells = styleCells(layoutGrid(recipe.spec), recipe.style);

  const kindLabel = recipe.spec.kind.toUpperCase();
  const hudText = `${kindLabel} · ${recipe.spec.columns}×${recipe.spec.rows} · ${Math.round(width)}×${Math.round(height)}px`;
  const pillW = Math.max(120 / scale, (hudText.length * 6.5 + 18) / scale);
  const pillH = 22 / scale;
  const pillY = y - 28 / scale;

  return (
    <Group listening={false}>
      {cells.map((cell, i) => (
        <Rect
          key={i}
          x={cell.x}
          y={cell.y}
          width={cell.width}
          height={cell.height}
          fill={cell.fill}
          opacity={0.45}
          cornerRadius={cell.radius}
          perfectDrawEnabled={false}
        />
      ))}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke="#F97316"
        strokeWidth={1.5 / scale}
        dash={[6 / scale, 4 / scale]}
        perfectDrawEnabled={false}
      />
      {/* High-end HUD Pill Badge */}
      <Rect
        x={x}
        y={pillY}
        width={pillW}
        height={pillH}
        fill="#0F172A"
        opacity={0.94}
        cornerRadius={5 / scale}
        stroke="#334155"
        strokeWidth={1 / scale}
        perfectDrawEnabled={false}
      />
      <Text
        x={x + 9 / scale}
        y={pillY + 5 / scale}
        text={hudText}
        fontSize={11 / scale}
        fontFamily="Inter, -apple-system, sans-serif"
        fontStyle="600"
        fill="#F8FAFC"
        perfectDrawEnabled={false}
      />
    </Group>
  );
};
