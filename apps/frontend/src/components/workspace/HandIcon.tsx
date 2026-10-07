import React from 'react';
import { HandGlyph } from '../dock/glyphs';

/**
 * The Hand tool's glyph, wherever it appears outside the dock (the command
 * palette's tool rows).
 *
 * It is the dock's own `HandGlyph`: the pointer's open hand, on the dock set's
 * 24-unit grid at its 1.75 stroke, centred and fitted to the live area. One
 * drawing, so the hand in a list and the hand on the seat are the same mark.
 */
export const HandIcon: React.FC<{ size?: number }> = ({ size = 18 }) => <HandGlyph size={size} />;
