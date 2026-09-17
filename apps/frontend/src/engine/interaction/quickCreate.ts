import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { ThemeService } from '../ThemeService';
import { DEFAULT_TYPOGRAPHY } from '../model/schema';
import { placeSticky } from '../tools/StickyTool';
import { requestEditOnMount } from './pendingEdit';
import {
  placedSize,
  presetGeometry,
  shapeEntry,
  type ShapePreset,
} from '../../components/workspace/shapeCatalog';

/**
 * Putting something on the board where the pointer already is.
 *
 * FigJam and Miro both answer a right-click on empty board with a way to *add*
 * there, because that is the moment the place has been chosen and the tool has
 * not: the pointer is on the spot, and the dock is a trip to the bottom of the
 * screen and back. Each of these places exactly what its tool would place with
 * a click on the same spot — the same size, the same paint, the caret already
 * open where there is text to type — because two ways to make a note must not
 * make two different notes.
 */

export function addStickyAt(at: { x: number; y: number }): string {
  const id = placeSticky(editor, at.x, at.y);
  editor.select(id);
  return id;
}

/** The seed box the Text tool uses for a click: narrow, and grown by typing. */
const TEXT_SEED = { width: 150, height: 40 };

export function addTextAt(at: { x: number; y: number }): string {
  const id = nanoid();
  requestEditOnMount(id);
  editor.createNode({
    id,
    type: 'text',
    x: at.x,
    y: at.y - TEXT_SEED.height / 2,
    width: TEXT_SEED.width,
    height: TEXT_SEED.height,
    text: '',
    resize: 'width',
    typography: { ...DEFAULT_TYPOGRAPHY, color: ThemeService.getDefaultTextColor() },
  });
  editor.select(id);
  return id;
}

export function addShapeAt(preset: ShapePreset, at: { x: number; y: number }): string {
  const { width, height } = placedSize(preset);
  const ratio = shapeEntry(preset).cornerRadiusRatio;
  const id = nanoid();
  editor.createNode({
    id,
    type: 'shape',
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
    geometry: presetGeometry(preset),
    appearance: {
      fill: [{ type: 'solid', color: ThemeService.getDefaultShapeFill(), opacity: 1 }],
      stroke: { color: ThemeService.getDefaultStrokeColor(), width: 2 },
      cornerRadius: ratio ? Math.round(Math.min(width, height) * ratio) : 0,
    },
  });
  editor.select(id);
  return id;
}
