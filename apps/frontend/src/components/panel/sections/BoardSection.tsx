import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useStore } from '../../../hooks/useStore';
import { setBoardMetadata } from '../../../engine/document';
import { isCssColor } from '../../../engine/text/cssColor';
import { canEditObjects } from '../../../engine/model/permissions';
import { BOARD_BACKGROUND_KEY, useBoardBackground } from '../../canvas/boardBackground';
import { ColorChip, Note, Row, Section, SegmentedControl } from '../grammar';
import { CleanLookGlyph, SketchLevelIcon } from '../sketchIcons';
import { SKETCH_LEVELS } from '../../../engine/model/rough';
import { setBoardSketch, useBoardSketch } from '../../../engine/model/roughBoard';
import { SKETCH_LEVEL_LABELS, SKETCH_LOOK_LABELS } from '../../../engine/model/shadingLabels';
import type { SketchLevel } from '../../../engine/model/schema';
import { colorUses, textStyles, type ColorUse, type TextStyleUse } from '../selectionColors';
import { shortFont } from '../panelHelpers';
import type { AnyNode } from '../../../engine/model/schema';

const select = (ids: string[]) =>
  window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids } }));

/** The theme's own canvas colours, shown when the board has no background of its own. */
const THEME_CANVAS = { light: '#F9FAFB', dark: '#09090B' };

type Idle = (cb: () => void) => () => void;
const whenIdle: Idle = (cb) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const id = window.requestIdleCallback(cb, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const t = setTimeout(cb, 120);
  return () => clearTimeout(t);
};

/**
 * The board's colours and text styles, recomputed when the browser is idle
 * and at most a few times a second, so a busy board does not rescan on every
 * keystroke while this section is open.
 */
function useBoardSummary(): { colours: ColorUse[]; styles: TextStyleUse[]; count: number } {
  const version = useStore((s) => s.version);
  const [summary, setSummary] = useState(() => {
    const nodes = Object.values(useStore.getState().objects) as AnyNode[];
    return { colours: colorUses(nodes, 16), styles: textStyles(nodes, 8), count: nodes.length };
  });
  useEffect(() => {
    let cancelIdle: (() => void) | null = null;
    const timer = setTimeout(() => {
      cancelIdle = whenIdle(() => {
        const nodes = Object.values(useStore.getState().objects) as AnyNode[];
        setSummary({ colours: colorUses(nodes, 16), styles: textStyles(nodes, 8), count: nodes.length });
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      cancelIdle?.();
    };
  }, [version]);
  return summary;
}

/**
 * The board, when nothing is selected.
 *
 * The background is a property of the board, shared by everyone in it.
 * Every other row selects: a colour selects everything painted with it, a
 * text style every block set in it.
 */
export const BoardSection: React.FC = () => {
  const { colours, styles, count } = useBoardSummary();
  const background = useBoardBackground();
  const boardSketch = useBoardSketch();
  const dark = useStore((s) => s.darkTheme);
  const canEdit = canEditObjects();
  const themeCanvas = dark ? THEME_CANVAS.dark : THEME_CANVAS.light;

  const writeBackground = (colour: string | null) => {
    if (colour !== null && !isCssColor(colour)) return;
    setBoardMetadata(BOARD_BACKGROUND_KEY, colour ?? '');
  };

  return (
    <>
      <Section id="board-background" title="Background" subject="board">
        <Row label="Colour" hint="The board's own colour, seen by everyone in it. Reset follows the light or dark theme.">
          <ColorChip
            label="Board background"
            value={background ?? themeCanvas}
            allowNone={false}
            onChange={(c) => canEdit && writeBackground(c)}
          />
          {background && canEdit && (
            <button
              type="button"
              className="pg-icon-btn"
              aria-label="Reset the background to the theme"
              data-tooltip="Reset to the theme"
              onClick={() => writeBackground(null)}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          )}
        </Row>
      </Section>

      <Section id="board-sketch" title="Sketch" subject="board">
        <Row label="Look" hint="How hand-drawn the board is. Objects follow it unless they are set apart.">
          <SegmentedControl
            ariaLabel="Board sketch"
            fill
            value={boardSketch ?? 'clean'}
            disabledReason={canEdit ? undefined : 'Only editors can change the board'}
            onChange={(v) => canEdit && setBoardSketch(v === 'clean' ? null : (v as SketchLevel))}
            segments={[
              { value: 'clean', label: SKETCH_LOOK_LABELS.clean, icon: <CleanLookGlyph /> },
              ...SKETCH_LEVELS.map((id) => ({
                value: id,
                label: SKETCH_LEVEL_LABELS[id],
                icon: <SketchLevelIcon level={id} />,
              })),
            ]}
          />
        </Row>
      </Section>

      {count === 0 ? (
        <Section id="board" title="Board" subject="board">
          <Note>An empty board. Pick a tool from the dock to start.</Note>
        </Section>
      ) : (
        <Section id="board-colours" title="Colours on this board" meta={colours.length || undefined} subject="board">
          {colours.length === 0 ? (
            <Note>Nothing on the board is painted yet.</Note>
          ) : (
            <div className="board-swatches" role="list">
              {colours.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  role="listitem"
                  className="board-swatch"
                  style={{ '--swatch': c.color } as React.CSSProperties}
                  aria-label={`${c.color}, on ${c.ids.length} object${c.ids.length === 1 ? '' : 's'}. Select them`}
                  data-tooltip={`${c.color} · ${c.ids.length} object${c.ids.length === 1 ? '' : 's'}`}
                  onClick={() => select(c.ids)}
                />
              ))}
            </div>
          )}
        </Section>
      )}
      {styles.length > 0 && (
        <Section id="board-type" title="Text styles on this board" meta={styles.length} subject="board">
          <ul className="board-styles">
            {styles.map((s) => (
              <li key={`${s.family}-${s.size}-${s.weight}`}>
                <button
                  type="button"
                  className="board-style"
                  aria-label={`${shortFont(s.family)}, ${s.size} pixels, weight ${s.weight}, on ${s.count} block${s.count === 1 ? '' : 's'}. Select them`}
                  onClick={() => select(s.ids)}
                >
                  <span className="board-style__name">{shortFont(s.family)}</span>
                  <span className="board-style__spec">
                    {s.size} · {s.weight}
                  </span>
                  <span className="board-style__count">{s.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
};
