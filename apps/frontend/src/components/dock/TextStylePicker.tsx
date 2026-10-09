import React, { useEffect } from 'react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { ensureFontLoaded } from '../../engine/text/measure';
import {
  TEXT_FACES,
  TEXT_STYLES,
  TEXT_STYLE_IDS,
  type TextFace,
  type TextStyleId,
} from '../../engine/tools/TextToolStyles';
import './textStyles.css';

/**
 * Text styles, shown as themselves.
 *
 * Three surfaces choose a style: the Text seat's menu (the whole list, each
 * name set in its own size and weight), the shelf while the tool is in hand
 * (a row of "Aa" specimens, the Figma text-style swatch) and the text rail.
 * All three draw from here, so a style looks the same wherever it is picked.
 *
 * A specimen is not the style at full size: a 64px title in a 240px menu is a
 * banner. Each step keeps its *rank* instead, a fixed preview size per style,
 * with the real weight, tracking scaled to the preview, and the face.
 */

/** Preview sizes in the list, largest first, in the order of `TEXT_STYLE_IDS`. */
const LIST_PX: Record<TextStyleId, number> = { title: 24, heading: 19, subheading: 16, body: 14, caption: 12 };
/** And on the shelf's specimens. */
const CHIP_PX: Record<TextStyleId, number> = { title: 19, heading: 16, subheading: 14, body: 12.5, caption: 11 };

/** The face's specimen styling: family, weight, and tracking scaled from the style to the preview. */
function specimen(id: TextStyleId, face: TextFace, px: number): React.CSSProperties {
  const style = TEXT_STYLES[id];
  return {
    fontFamily: canvasFontFamily(TEXT_FACES[face].family),
    fontWeight: style.fontWeight,
    letterSpacing: `${(style.letterSpacing / style.fontSize) * px}px`,
    // The hand face runs small for its size; a step up keeps the ranks level.
    fontSize: `${face === 'hand' ? px * 1.18 : px}px`,
  };
}

/** Load the hand face before its specimens are drawn, so they do not flash in the fallback. */
function useFace(face: TextFace) {
  useEffect(() => {
    if (face !== 'hand') return;
    for (const w of [400, 600, 700]) ensureFontLoaded(TEXT_FACES.hand.family, w, false);
  }, [face]);
}

/** Left and Right (and Up and Down) walk a radio group, Home and End go to its ends. */
function onRadioKey(e: React.KeyboardEvent<HTMLElement>, vertical: boolean) {
  const back = vertical ? 'ArrowUp' : 'ArrowLeft';
  const fwd = vertical ? 'ArrowDown' : 'ArrowRight';
  if (![back, fwd, 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"], [role="menuitemradio"]'));
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === fwd ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/**
 * The full list: each style's name set in that style.
 *
 * Rows are `menuitemradio` inside a menu and `radio` elsewhere. `rowClassName`
 * lets the dock give them its own row class, which its menus walk with the
 * arrows.
 */
export const TextStyleList: React.FC<{
  value: TextStyleId | null;
  face: TextFace;
  onPick: (id: TextStyleId) => void;
  /** Rows inside a dock menu, which owns the arrow keys. */
  inMenu?: boolean;
  rowClassName?: string;
}> = ({ value, face, onPick, inMenu = false, rowClassName = '' }) => {
  useFace(face);
  return (
    <div
      className="text-styles"
      role={inMenu ? 'group' : 'radiogroup'}
      aria-label="Text style"
      onKeyDown={inMenu ? undefined : (e) => onRadioKey(e, true)}
    >
      {TEXT_STYLE_IDS.map((id) => {
        const style = TEXT_STYLES[id];
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role={inMenu ? 'menuitemradio' : 'radio'}
            aria-checked={on}
            aria-label={`${style.label}, ${style.fontSize}`}
            tabIndex={inMenu ? undefined : on || (value === null && id === 'body') ? 0 : -1}
            className={`text-style ${rowClassName}${on ? ' active' : ''}`}
            data-on={on || undefined}
            onClick={() => onPick(id)}
          >
            <span className="text-style__name" style={specimen(id, face, LIST_PX[id])}>
              {style.label}
            </span>
            <span className="text-style__size" aria-hidden="true">{style.fontSize}</span>
          </button>
        );
      })}
    </div>
  );
};

/** The shelf's row: an "Aa" per style, largest first. */
export const TextStyleChips: React.FC<{
  value: TextStyleId | null;
  face: TextFace;
  onPick: (id: TextStyleId) => void;
}> = ({ value, face, onPick }) => {
  useFace(face);
  return (
    <div className="text-chips" role="radiogroup" aria-label="Style of the next text" onKeyDown={(e) => onRadioKey(e, false)}>
      {TEXT_STYLE_IDS.map((id) => {
        const style = TEXT_STYLES[id];
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={style.label}
            data-tooltip={`${style.label} (${style.fontSize})`}
            data-tooltip-desc={style.hint}
            tabIndex={on ? 0 : -1}
            className="text-chip"
            onClick={() => onPick(id)}
          >
            <span style={specimen(id, face, CHIP_PX[id])} aria-hidden="true">Aa</span>
          </button>
        );
      })}
    </div>
  );
};

/** Typed or handwritten: the two faces, each shown in itself. */
export const TextFaceToggle: React.FC<{
  value: TextFace | null;
  onPick: (face: TextFace) => void;
  /** Wider, labelled segments: in a menu or a popover, where there is room for the words. */
  labelled?: boolean;
}> = ({ value, onPick, labelled = false }) => {
  useFace('hand');
  return (
    <div
      className={`text-faces${labelled ? ' text-faces--labelled' : ''}`}
      role="radiogroup"
      aria-label="Face"
      onKeyDown={(e) => onRadioKey(e, false)}
    >
      {(Object.keys(TEXT_FACES) as TextFace[]).map((face) => {
        const on = value === face;
        return (
          <button
            key={face}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={TEXT_FACES[face].label}
            data-tooltip={labelled ? undefined : TEXT_FACES[face].label}
            tabIndex={on || (value === null && face === 'sans') ? 0 : -1}
            className="text-face"
            onClick={() => onPick(face)}
          >
            <span
              aria-hidden="true"
              style={{ fontFamily: canvasFontFamily(TEXT_FACES[face].family), fontSize: face === 'hand' ? '17px' : '14px' }}
            >
              {labelled ? TEXT_FACES[face].label : 'Aa'}
            </span>
          </button>
        );
      })}
    </div>
  );
};
