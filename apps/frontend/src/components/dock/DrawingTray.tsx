import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { drawSettings } from '../../engine/tools/drawSettings';
import type { Brush } from '../../engine/tools/brushes';
import { shortcutFor } from '../../engine/tools/shortcuts';
import type { PencilNib } from '../../engine/model/rough';
import { THEMES } from '../../engine/model/stickyThemes';
import { useStore } from '../../hooks/useStore';
import { DrawTray } from '../tools/draw/DrawTray';
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
import { TRAY_GLYPH_QUERY, useMediaQuery, useThemeInk } from './useDockEnv';
import './dock.css';

/**
 * The drawing tray: the Draw seat's tools as physical objects, and an ink well.
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
 * The ink well beside the rack belongs to the tool in hand:
 * - a brush, or nothing yet: `DrawTray`'s inks and shape snapping, the width,
 *   and the brush's settings;
 * - the eraser: `EraserTray`'s mode and the eraser's width;
 * - the vector pen: its stroke weight.
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
  const glyphs = useMediaQuery(TRAY_GLYPH_QUERY);
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

  const arm = (tool: RackTool) => {
    if (tool.id === 'sticky' && stickyCarryEnded?.()) return;
    if (tool.brush) drawSettings.set({ brush: tool.brush });
    onArm(tool.toolId);
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
    if (armedId === 'eraser' || armedId === 'vector') setSettingsOpen(false);
  }, [armedId]);

  let well: React.ReactNode;
  if (armedId === 'eraser') {
    well = (
      <>
        <EraserTray />
        <span className="dock-rule" aria-hidden="true" />
        <WidthDots label="Eraser size" values={[10, 20, 40, 80]} dots={[4, 7, 10, 14]} value={eraserSize} onChange={setEraserSize} />
      </>
    );
  } else if (armedId === 'vector') {
    well = (
      <WidthDots label="Weight" values={[1, 2, 4, 8]} dots={[2, 4, 6, 9]} value={penStrokeWidth} onChange={setPenStrokeWidth} />
    );
  } else {
    well = (
      <>
        <div className="dock-tray__ink">
          <DrawTray themeInk={themeInk} />
        </div>
        <span className="dock-rule" aria-hidden="true" />
        <WidthDots label="Size" values={[2, 6, 12, 24]} dots={[3, 5, 8, 12]} value={penSize} onChange={setPenSize} />
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
      style={{ '--ink': ink, '--hl': settings.highlight, '--note': note } as React.CSSProperties}
    >
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
      <div className="dock-tray__well">{well}</div>

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
