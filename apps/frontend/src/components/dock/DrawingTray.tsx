import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { drawSettings, HIGHLIGHT_SWATCHES, INK_SWATCHES } from '../../engine/tools/drawSettings';
import type { Brush } from '../../engine/tools/brushes';
import { shortcutFor } from '../../engine/tools/shortcuts';
import type { PencilNib } from '../../engine/model/rough';
import { THEMES } from '../../engine/model/stickyThemes';
import { useStore } from '../../hooks/useStore';
import { EraserTray } from '../tools/draw/EraserTray';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { SketchLevelIcon } from '../panel/sketchIcons';
import { TOOL_ART, type TrayToolArt } from './art/ToolArt';
import {
  EraserGlyph,
  HighlighterGlyph,
  MarkerGlyph,
  PencilGlyph,
  SettingsGlyph,
  StickyGlyph,
  VectorPenGlyph,
} from './glyphs';
import { FLYOUT_WIDTHS, trayLayout, trayVars } from './flyoutScale';
import { FLYOUT_EDGE, useFreeStrip } from '../workspace/boardLayout';
import { TRAY_GLYPH_QUERY, useMediaQuery, useThemeInk } from './useDockEnv';
import './dock.css';

/**
 * The drawing tray: the Draw seat's tools as physical objects, an ink well,
 * and the options for the tool in hand.
 *
 * It rises above the dock while the Draw seat is armed or its menu is open,
 * and nowhere else; every other surface keeps the crisp glyphs. The tools sit
 * partly sunk behind the tray's front lip. Hovering one raises it 4px and the
 * armed one stands 8px proud, on a critically damped spring that settles
 * without rebounding. Under reduced motion both are a 1px nudge with no
 * animation, and a mark on the lip carries the armed state on its own.
 *
 * Below 900px wide the art gives way to glyphs; under increased contrast the
 * art goes flat with solid edges (see `art/toolArt.css`).
 *
 * ## One width, whatever is in hand
 *
 * The tray is two rows inside a fixed width from the flyout scale (see
 * `trayLayout`): the rack and the ink well on top, which never change, and
 * below them a row of fixed height holding the options for the tool in hand.
 * Switching tools cross-fades that row and moves no edge.
 *
 * - a brush, or nothing armed yet: its size, shape snapping, and the brush's
 *   settings;
 * - the eraser: its size and its mode;
 * - the vector pen: its stroke weight.
 *
 * The well shows the inks of the brush the seat picks up. Choosing one while
 * the eraser or the vector pen is in hand picks that brush back up with it.
 */

type RackId = TrayToolArt;

interface RackTool {
  id: RackId;
  label: string;
  /** The tool it arms. */
  toolId: string;
  /** For the three freehand brushes, which brush. */
  brush?: Brush;
  description: string;
}

const RACK: readonly RackTool[] = [
  { id: 'pen', label: 'Pen', toolId: 'pen', brush: 'pen', description: 'Pressure-sensitive ink that tapers where you lift' },
  { id: 'marker', label: 'Marker', toolId: 'pen', brush: 'marker', description: 'An even felt-tip line' },
  { id: 'highlighter', label: 'Highlighter', toolId: 'pen', brush: 'highlighter', description: 'A wide translucent band that keeps text readable' },
  { id: 'eraser', label: 'Eraser', toolId: 'eraser', description: '[ and ] resize it. Hold Alt to lasso' },
  { id: 'vector', label: 'Vector pen', toolId: 'bezier-pen', description: 'Anchor points and curves' },
  { id: 'sticky', label: 'Sticky note', toolId: 'sticky', description: 'Click to arm, or pull one off the pad' },
];

/** The glyphs the rack falls back to below 900px. */
function rackGlyph(id: RackId, ink: string, highlight: string): React.ReactNode {
  switch (id) {
    case 'pen': return <PencilGlyph tip={ink} />;
    case 'marker': return <MarkerGlyph tip={ink} />;
    case 'highlighter': return <HighlighterGlyph tip={highlight} />;
    case 'eraser': return <EraserGlyph />;
    case 'vector': return <VectorPenGlyph />;
    case 'sticky': return <StickyGlyph />;
  }
}

/** A width, as the dot it draws. A small set, because a tray is for the next stroke, not for measuring. */
const WidthDots: React.FC<{
  label: string;
  values: readonly number[];
  /** Drawn diameters for the values, in px. */
  dots: readonly number[];
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}> = ({ label, values, dots, value, onChange, unit = 'px' }) => {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const at = Math.max(0, values.indexOf(value));
    const next = values[(at + (e.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length];
    onChange(next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[values.indexOf(next)]?.focus();
  };
  return (
    <div className="dock-widths" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {values.map((v, i) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${label} ${v} ${unit}`}
            data-tooltip={`${label} ${v}`}
            tabIndex={on || (!values.includes(value) && i === 0) ? 0 : -1}
            className="dock-widths__btn"
            onClick={() => onChange(v)}
          >
            <span className="dock-widths__dot" style={{ width: dots[i], height: dots[i] }} />
          </button>
        );
      })}
    </div>
  );
};

/**
 * The ink well: the theme's ink and five colours for the pen and marker, or
 * five light hues for the highlighter. A row of fixed width whose swatches
 * spread to its edges, so either set sits on the same two lines.
 */
const InkWell: React.FC<{
  brush: Brush;
  ink: string;
  themeInk: string;
  highlight: string;
  onPick: (patch: { ink?: string | null; highlight?: string }) => void;
}> = ({ brush, ink, themeInk, highlight, onPick }) => {
  const highlighting = brush === 'highlighter';
  const swatches = highlighting ? HIGHLIGHT_SWATCHES : [{ color: themeInk, name: 'Ink' }, ...INK_SWATCHES];
  const current = (highlighting ? highlight : ink).toLowerCase();
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  const anyChosen = swatches.some((s) => s.color.toLowerCase() === current);
  return (
    <div
      className="dock-ink"
      role="radiogroup"
      aria-label={highlighting ? 'Highlighter colour' : 'Ink colour'}
      onKeyDown={onKey}
    >
      {swatches.map((s, i) => {
        const selected = s.color.toLowerCase() === current;
        return (
          <button
            key={s.name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={s.name}
            data-tooltip={s.name}
            tabIndex={selected || (!anyChosen && i === 0) ? 0 : -1}
            className="dock-ink__swatch"
            onClick={() =>
              onPick(highlighting ? { highlight: s.color } : { ink: s.color === themeInk ? null : s.color })
            }
          >
            <span className="dock-ink__chip" style={{ background: s.color }} />
          </button>
        );
      })}
    </div>
  );
};

/** What the options row is showing. */
type OptionsMode = 'brush' | 'eraser' | 'vector';

export interface DrawingTrayProps {
  activeToolId: string;
  /** Arm a tool, as the dock does. */
  onArm: (toolId: string) => void;
  /** A press on the sticky pad, which can pull a note off it. */
  onStickyPointerDown?: (e: React.PointerEvent) => void;
  /** Whether the click that ended a pull should be ignored. */
  stickyCarryEnded?: () => boolean;
}

export const DrawingTray: React.FC<DrawingTrayProps> = ({ activeToolId, onArm, onStickyPointerDown, stickyCarryEnded }) => {
  const themeInk = useThemeInk();
  // Glyphs on a narrow window, and also where open columns leave the art tray
  // (lg + the flyout edge either side) no room: it would run under a panel.
  const free = useFreeStrip();
  const glyphs = useMediaQuery(TRAY_GLYPH_QUERY) || free < FLYOUT_WIDTHS.lg + 2 * FLYOUT_EDGE;
  const layout = trayLayout(glyphs ? 'glyph' : 'art');
  const settings = useSyncExternalStore(drawSettings.subscribe, drawSettings.get, drawSettings.get);
  const stickyTheme = useStore((s) => s.stickyTheme);
  const penSize = useStore((s) => s.penSize);
  const setPenSize = useStore((s) => s.setPenSize);
  const eraserSize = useStore((s) => s.eraserSize);
  const setEraserSize = useStore((s) => s.setEraserSize);
  const penStrokeWidth = useStore((s) => s.penStrokeWidth);
  const setPenStrokeWidth = useStore((s) => s.setPenStrokeWidth);
  const pencilNib = useStore((s) => s.pencilNib);
  const setPencilNib = useStore((s) => s.setPencilNib);
  const penSmoothing = useStore((s) => s.penSmoothing);
  const setPenSmoothing = useStore((s) => s.setPenSmoothing);
  const penKeepSelected = useStore((s) => s.penKeepSelected);
  const setPenKeepSelected = useStore((s) => s.setPenKeepSelected);

  const ink = settings.ink ?? themeInk;
  const note = THEMES[stickyTheme]?.bg ?? THEMES.yellow.bg;

  const armedId: RackId | null =
    activeToolId === 'pen' ? (settings.brush as RackId)
    : activeToolId === 'eraser' ? 'eraser'
    : activeToolId === 'bezier-pen' ? 'vector'
    : null;
  const mode: OptionsMode = armedId === 'eraser' ? 'eraser' : armedId === 'vector' ? 'vector' : 'brush';

  const arm = (tool: RackTool) => {
    if (tool.id === 'sticky' && stickyCarryEnded?.()) return;
    if (tool.brush) drawSettings.set({ brush: tool.brush });
    onArm(tool.toolId);
  };

  /** An ink is a request for the brush that draws it. */
  const pickInk = (patch: { ink?: string | null; highlight?: string }) => {
    drawSettings.set(patch);
    if (activeToolId !== 'pen') onArm('pen');
  };

  // Left and Right walk the rack, the way they walk the dock.
  const onRackKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.dock-tray__tool'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : (at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  /* -------------------------------------------------- the brush's settings */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (settingsRef.current?.contains(t) || settingsBtnRef.current?.contains(t)) return;
      setSettingsOpen(false);
    };
    // Captured, so Escape closes this panel before the dock closes the tray.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setSettingsOpen(false);
      settingsBtnRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [settingsOpen]);
  useEffect(() => {
    if (mode !== 'brush') setSettingsOpen(false);
  }, [mode]);

  const highlighting = settings.brush === 'highlighter';
  let options: React.ReactNode;
  if (mode === 'eraser') {
    options = (
      <>
        <WidthDots label="Eraser size" values={[10, 20, 40, 80]} dots={[4, 7, 10, 14]} value={eraserSize} onChange={setEraserSize} />
        <span className="dock-rule" aria-hidden="true" />
        <EraserTray />
      </>
    );
  } else if (mode === 'vector') {
    options = (
      <>
        <WidthDots label="Weight" values={[1, 2, 4, 8]} dots={[2, 4, 6, 9]} value={penStrokeWidth} onChange={setPenStrokeWidth} />
        <span className="dock-rule" aria-hidden="true" />
        <span className="dock-tray__hint">Click for corners, drag for curves</span>
      </>
    );
  } else {
    options = (
      <>
        <WidthDots label="Size" values={[2, 6, 12, 24]} dots={[3, 5, 8, 12]} value={penSize} onChange={setPenSize} />
        <span className="dock-rule" aria-hidden="true" />
        <Switch
          checked={settings.recognizeShapes && !highlighting}
          onChange={(checked) => drawSettings.set({ recognizeShapes: checked })}
          label="Snap to shapes"
          disabled={highlighting}
          tooltip={
            highlighting
              ? 'The highlighter always draws freehand'
              : 'Hold still at the end of a stroke to turn it into a clean line, arrow, circle or box'
          }
        />
        <button
          ref={settingsBtnRef}
          type="button"
          className="btn-icon dock-tray__settings-btn"
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
          aria-label="Brush settings"
          data-tooltip="Brush settings"
          data-tooltip-desc="Exact size, nib, smoothing"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <SettingsGlyph size={18} />
        </button>
      </>
    );
  }

  return (
    <div
      className="dock-tray__inner"
      data-mode={glyphs ? 'glyph' : 'art'}
      data-size={layout.size}
      style={{ ...trayVars(layout), '--ink': ink, '--hl': settings.highlight, '--note': note } as React.CSSProperties}
    >
      <div className="dock-tray__top">
        <div className="dock-tray__rack" role="radiogroup" aria-label="Drawing tool" onKeyDown={onRackKey}>
          {RACK.map((tool, i) => {
            const armed = armedId === tool.id;
            // `N` arms the pen tool with the brush held last, so its keycap sits
            // on that brush; the others carry their own key.
            const key = tool.brush ? (tool.brush === settings.brush ? shortcutFor('pen') : undefined) : shortcutFor(tool.toolId);
            const Art = TOOL_ART[tool.id];
            const focusable = armedId ? armed : i === 0;
            return (
              <button
                key={tool.id}
                type="button"
                role="radio"
                aria-checked={armed}
                aria-label={`${tool.label}. ${tool.description}`}
                data-tooltip={key ? `${tool.label} (${key})` : tool.label}
                data-tooltip-desc={tool.description}
                data-tool={tool.id}
                tabIndex={focusable ? 0 : -1}
                className={glyphs ? `btn-icon dock-tray__tool${armed ? ' active' : ''}` : 'dock-tray__tool'}
                onClick={() => arm(tool)}
                onPointerDown={tool.id === 'sticky' ? onStickyPointerDown : undefined}
              >
                {glyphs ? rackGlyph(tool.id, ink, settings.highlight) : <Art />}
              </button>
            );
          })}
          {!glyphs && <span className="dock-tray__lip" aria-hidden="true" />}
        </div>
        <span className="dock-rule dock-tray__rule" aria-hidden="true" />
        <div className="dock-tray__well">
          <InkWell
            brush={settings.brush}
            ink={ink}
            themeInk={themeInk}
            highlight={settings.highlight}
            onPick={pickInk}
          />
        </div>
      </div>

      {/* Fixed height; the options for each tool cross-fade in place. */}
      <div className="dock-tray__options" role="group" aria-label={mode === 'eraser' ? 'Eraser size and mode' : mode === 'vector' ? 'Vector pen weight' : 'Brush size and snapping'}>
        <AnimatePresence initial={false}>
          <motion.div
            key={mode}
            className="dock-tray__options-set"
            data-set={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            {options}
          </motion.div>
        </AnimatePresence>
      </div>

      {settingsOpen && (
        <div ref={settingsRef} className="panel-surface dock-tray__settings" role="dialog" aria-label="Brush settings" data-tooltip-surface="">
          <Slider label="Size" value={penSize} min={1} max={60} unit="px" onChange={setPenSize} />
          <div className="dock-tray__settings-row">
            <span className="dock-tray__settings-label">Nib</span>
            <SegmentedControl
              ariaLabel="Pencil nib"
              value={pencilNib}
              onChange={(v) => setPencilNib(v as PencilNib)}
              segments={[
                { value: 'smooth', hint: 'Smooth: one continuous, tapered line', icon: <SketchLevelIcon level="off" /> },
                { value: 'light', hint: 'Drawn: gone over once, by hand', icon: <SketchLevelIcon level="light" /> },
                { value: 'medium', hint: 'Sketched: gone over twice', icon: <SketchLevelIcon level="medium" /> },
                { value: 'heavy', hint: 'Scribbled: twice, and past every turn', icon: <SketchLevelIcon level="heavy" /> },
              ]}
            />
          </div>
          <Slider
            label="Smoothing"
            value={penSmoothing}
            min={0}
            max={100}
            ticks={[40, 72]}
            onChange={setPenSmoothing}
            hint="How much of your hand's movement the line ignores. Low follows every wobble; high draws through it."
          />
          <Switch
            checked={penKeepSelected}
            onChange={setPenKeepSelected}
            label="Keep the last stroke selected"
            block
          />
        </div>
      )}
    </div>
  );
};
