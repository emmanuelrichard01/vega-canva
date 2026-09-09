import React from 'react';
import {
  Square, Type, ImageIcon, StickyNote, Mic, MessageSquare, PenLine, Layers, BarChart2,
  SquaresUnite, SquaresSubtract, SquaresIntersect, SquaresExclude,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
} from 'lucide-react';
import { ShapeIcon } from '../workspace/shapeIcons';
import { ALL_SHAPE_PRESETS, SHAPE_BY_PRESET, type ShapePreset } from '../workspace/shapeCatalog';
import type { ShapeKind } from '../../engine/model/schema';
import type { RailSide } from '../../engine/interaction/railPlacement';
import type { BooleanOp } from '../../engine/model/pathBoolean';
import type { AlignEdge } from '../../engine/model/align';

/**
 * The shapes a selected object can be turned into.
 *
 * Derived from the catalogue rather than listed, which is the whole point: it
 * *was* listed, and so were the dock's shapes and the context menu's, and the
 * three lists had drifted into three different sets with three different
 * memberships and, in two cases, two different names for the same shape. See
 * `shapePicker.tsx`.
 *
 * The open runs are kept separate because the swapper offers them separately:
 * turning a rectangle into a line throws away everything a rectangle is, so it
 * sits behind its own disclosure rather than in the same grid.
 */
export const SHAPE_CHOICES: Array<{
  preset: ShapePreset;
  kind: ShapeKind;
  points?: number;
  label: string;
  icon: React.ReactNode;
}> = ALL_SHAPE_PRESETS.map((preset) => {
  const entry = SHAPE_BY_PRESET[preset];
  return {
    preset,
    kind: entry.geometry.kind,
    points: entry.geometry.points,
    label: entry.label,
    icon: <ShapeIcon kind={preset} size={16} />,
  };
});

export const TYPE_LABEL: Record<string, { icon: React.ReactNode; name: string }> = {
  shape: { icon: <Square size={15} />, name: 'Shape' },
  text: { icon: <Type size={15} />, name: 'Text' },
  image: { icon: <ImageIcon size={15} />, name: 'Image' },
  sticky: { icon: <StickyNote size={15} />, name: 'Note' },
  audio: { icon: <Mic size={15} />, name: 'Voice' },
  comment: { icon: <MessageSquare size={15} />, name: 'Comment' },
  path: { icon: <PenLine size={15} />, name: 'Path' },
  frame: { icon: <Layers size={15} />, name: 'Frame' },
  chart: { icon: <BarChart2 size={15} />, name: 'Chart' },
};

export const BOOLEAN_BUTTONS: Record<BooleanOp, { icon: React.ReactNode; label: string }> = {
  union: { icon: <SquaresUnite size={16} />, label: 'Union' },
  subtract: { icon: <SquaresSubtract size={16} />, label: 'Subtract front from back' },
  intersect: { icon: <SquaresIntersect size={16} />, label: 'Intersect' },
  exclude: { icon: <SquaresExclude size={16} />, label: 'Exclude overlap' },
};

export const ALIGN_BUTTONS: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: 'left', label: 'Align left', icon: <AlignHorizontalJustifyStart size={16} /> },
  { edge: 'centerX', label: 'Align horizontal centres', icon: <AlignHorizontalJustifyCenter size={16} /> },
  { edge: 'right', label: 'Align right', icon: <AlignHorizontalJustifyEnd size={16} /> },
  { edge: 'top', label: 'Align top', icon: <AlignVerticalJustifyStart size={16} /> },
  { edge: 'middleY', label: 'Align vertical centres', icon: <AlignVerticalJustifyCenter size={16} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignVerticalJustifyEnd size={16} /> },
];

export const HANG: Record<RailSide, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0%)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0%, -50%)',
};

export const ENTRY: Record<RailSide, { x: number; y: number }> = {
  top: { x: 0, y: 6 },
  bottom: { x: 0, y: -6 },
  left: { x: 6, y: 0 },
  right: { x: -6, y: 0 },
};
