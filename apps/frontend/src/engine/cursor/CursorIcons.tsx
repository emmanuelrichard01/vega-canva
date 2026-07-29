import React from 'react';
import type { CursorStateId } from './CursorTypes';
import { CursorTheme, getTheme } from './CursorTheme';

interface IconProps {
  fill?: string;
  stroke?: string;
  state?: CursorStateId;
}

export const DefaultPointer = ({ fill, stroke }: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>
    {/* A modern geometric pointer, slightly leaned forward with precise corners */}
    <path d="M5.65376 21.2183L2.36881 2.50576C2.17937 1.42629 3.32766 0.584311 4.30138 1.08742L21.2335 9.83549C22.2599 10.366 22.1802 11.8315 21.1011 12.2612L13.8821 15.1363C13.5604 15.2644 13.3082 15.5146 13.1782 15.8361L10.2828 23.0132C9.84996 24.0864 8.38466 24.1565 7.86311 23.1239L5.65376 21.2183Z" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

export const CursorIcon = ({ state, fill: overrideFill }: IconProps) => {
  const themeMode = getTheme();
  const defaultFill = CursorTheme[themeMode].fill;
  const defaultStroke = CursorTheme[themeMode].stroke;

  const fill = overrideFill || defaultFill;
  const stroke = overrideFill ? '#FFFFFF' : defaultStroke;

  switch (state) {
    case 'idle':
    case 'hover':
    case 'select':
      return <DefaultPointer fill={fill} stroke={stroke} />;
    
    // Add custom cursor SVGs here. Fallback to default pointer.
    case 'move':
    case 'drag':
    case 'draw':
    case 'typing':
    case 'comment':
    case 'audio':
    case 'laser':
    default:
      return <DefaultPointer fill={fill} stroke={stroke} />;
  }
};
