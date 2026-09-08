import React from 'react';
import {
  Square, Type, ImageIcon, StickyNote, Mic, MessageSquare, PenLine, Layers, BarChart2,
  SquaresUnite, SquaresSubtract, SquaresIntersect, SquaresExclude,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
} from 'lucide-react';
import { ShapeIcon } from '../workspace/shapeIcons';
import type { ShapeKind } from '../../engine/model/schema';
import type { RailSide } from '../../engine/interaction/railPlacement';
import type { BooleanOp } from '../../engine/model/pathBoolean';
import type { AlignEdge } from '../../engine/model/align';

export const SHAPE_CHOICES: Array<{ kind: ShapeKind; points?: number; label: string; icon: React.ReactNode }> = [
  { kind: 'rect', label: 'Rectangle', icon: <ShapeIcon kind="rect" size={16} /> },
  { kind: 'ellipse', label: 'Ellipse', icon: <ShapeIcon kind="ellipse" size={16} /> },
  { kind: 'squircle', label: 'Squircle', icon: <ShapeIcon kind="squircle" size={16} /> },
  { kind: 'capsule', label: 'Capsule (Pill)', icon: <ShapeIcon kind="capsule" size={16} /> },
  { kind: 'diamond', label: 'Diamond', icon: <ShapeIcon kind="diamond" size={16} /> },
  { kind: 'polygon', points: 3, label: 'Triangle', icon: <ShapeIcon kind="triangle" size={16} /> },
  { kind: 'cylinder', label: 'Cylinder', icon: <ShapeIcon kind="cylinder" size={16} /> },
  { kind: 'parallelogram', label: 'Parallelogram', icon: <ShapeIcon kind="parallelogram" size={16} /> },
  { kind: 'trapezoid', label: 'Trapezoid', icon: <ShapeIcon kind="trapezoid" size={16} /> },
  { kind: 'chevron', label: 'Chevron', icon: <ShapeIcon kind="chevron" size={16} /> },
  { kind: 'star', points: 5, label: 'Star', icon: <ShapeIcon kind="star" size={16} /> },
  { kind: 'heart', label: 'Heart', icon: <ShapeIcon kind="heart" size={16} /> },
  { kind: 'cloud', label: 'Cloud', icon: <ShapeIcon kind="cloud" size={16} /> },
  { kind: 'cross', label: 'Cross', icon: <ShapeIcon kind="cross" size={16} /> },
  { kind: 'donut', label: 'Donut', icon: <ShapeIcon kind="donut" size={16} /> },
  { kind: 'badge', points: 12, label: 'Badge', icon: <ShapeIcon kind="badge" size={16} /> },
  { kind: 'callout', label: 'Callout', icon: <ShapeIcon kind="callout" size={16} /> },
  { kind: 'banner', label: 'Banner', icon: <ShapeIcon kind="banner" size={16} /> },
  { kind: 'polygon', points: 5, label: 'Pentagon', icon: <ShapeIcon kind="pentagon" size={16} /> },
  { kind: 'polygon', points: 6, label: 'Hexagon', icon: <ShapeIcon kind="hexagon" size={16} /> },
  { kind: 'polygon', points: 8, label: 'Octagon', icon: <ShapeIcon kind="octagon" size={16} /> },
  { kind: 'line', label: 'Line', icon: <ShapeIcon kind="line" size={16} /> },
  { kind: 'arrow', label: 'Arrow', icon: <ShapeIcon kind="arrow" size={16} /> },
];

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
