import * as React from 'react';
import { Group, Rect } from 'react-konva';
import { gridDefaults } from '../grid/gridDefaults';
import { layoutGrid } from '../grid/gridLayout';
import { styleCells } from '../grid/gridStyle';

/**
 * The preview: the cells themselves, at a whisper, with its dashed bounds. The size readout is the board's HUD, driven by `GridTool`.
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
    </Group>
  );
};
