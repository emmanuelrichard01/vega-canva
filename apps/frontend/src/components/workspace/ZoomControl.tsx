import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { provider } from '../../engine/document';
import { Menu } from '../menu/Menu';
import { withShortcut } from '../menu/shortcuts';
import { parseZoomInput, zoomMenuEntries } from './zoomMenu';
import { boardInsets } from './boardLayout';
import { selectionBounds } from '../../engine/model/selection';
import type { FitBounds } from '../../engine/cameraFit';

/** One step of the − and + buttons, the same step the menu's rows take. */
const STEP = 1.25;
/** Breathing room around a fit, before the columns and the dock are added. */
const FIT_PADDING = 64;
/** The dock floats over the bottom of the board; a fit keeps work above it. */
const DOCK_CLEARANCE = 48;

/**
 * The zoom readout, which is also where zoom is set.
 *
 * Step out, the percentage, step in; `compact` leaves only the percentage,
 * for a header where the menu already holds the steps. The percentage is a
 * field — type `150`, `2x` or `1,5x` and press Enter or move away — and its
 * chevron opens the menu of fits and fixed stops. Escape puts the value back.
 */
export const ZoomControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [percent, setPercent] = useState(() => Math.round(cameraSystem.reportedZoom * 100));
  useEffect(() => {
    const sync = () =>
      setPercent((prev) => {
        const next = Math.round(cameraSystem.reportedZoom * 100);
        return next === prev ? prev : next;
      });
    sync();
    engineEvents.on('CameraChanged', sync);
    return () => engineEvents.off('CameraChanged', sync);
  }, []);

  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [menuRect, setMenuRect] = useState<{ rect: DOMRect; keyboard: boolean; selection: string[] } | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justClosed = useRef(0);

  /**
   * What is selected, read when the menu opens. The canvas owns selection and
   * publishes it with presence; the menu only needs it at the moment it shows.
   */
  const currentSelection = (): string[] => {
    const selection = provider.awareness?.getLocalState()?.selection;
    return Array.isArray(selection) ? selection.filter((id): id is string => typeof id === 'string') : [];
  };

  const zoomBy = (factor: number) => cameraSystem.zoomBy(factor, cameraSystem.width / 2, cameraSystem.height / 2);

  /** About the middle of what is on screen, so a stop never jumps somewhere else. */
  const setZoom = (factor: number) => cameraSystem.zoomToLevel(factor);

  /**
   * Fit a world box into the canvas that is showing: the open columns sit over
   * the board, so their width is added to the fit's padding on that side.
   */
  const fly = (bounds: FitBounds | null, maxZoom?: number) => {
    if (!bounds) return;
    const inset = boardInsets();
    cameraSystem.flyToBounds(bounds, {
      paddingLeft: FIT_PADDING + inset.left,
      paddingRight: FIT_PADDING + inset.right,
      paddingTop: FIT_PADDING,
      paddingBottom: FIT_PADDING + DOCK_CLEARANCE,
      ...(maxZoom !== undefined ? { maxZoom } : {}),
    });
  };

  const commit = () => {
    if (draft === null) return;
    const factor = parseZoomInput(draft, cameraSystem.zoomLimits);
    if (factor === null) {
      setInvalid(true);
      inputRef.current?.select();
      return;
    }
    setInvalid(false);
    setDraft(null);
    setZoom(factor);
    inputRef.current?.blur();
  };

  const openMenu = (keyboard: boolean) => {
    if (performance.now() - justClosed.current < 300) return;
    const rect = groupRef.current?.getBoundingClientRect();
    if (rect) setMenuRect({ rect, keyboard, selection: currentSelection() });
  };

  return (
    <div className={`zoom-ctl${compact ? ' zoom-ctl--compact' : ''}`} role="group" aria-label="Zoom" data-tour="zoom" ref={groupRef}>
      {!compact && (
        <button
          type="button"
          className="btn-icon zoom-ctl__step"
          onClick={() => zoomBy(1 / STEP)}
          aria-label="Zoom out"
          data-tooltip={withShortcut('Zoom out', 'Mod+-')}
        >
          <Minus size={14} />
        </button>
      )}
      <div className={`zoom-ctl__field${menuRect ? ' is-open' : ''}`} data-invalid={invalid || undefined}>
        <input
          ref={inputRef}
          className="zoom-ctl__input"
          type="text"
          inputMode="decimal"
          spellCheck={false}
          aria-label="Zoom level. Type a percentage and press Enter"
          aria-invalid={invalid || undefined}
          value={draft ?? `${percent}%`}
          // The live value shows until something is typed, so a wheel or pinch
          // zoom while the field has focus still reads true.
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setInvalid(false);
            setDraft(e.target.value);
          }}
          // Leaving the field applies what was typed, as Figma's does. Nonsense
          // is dropped rather than kept as an error nobody is looking at.
          onBlur={() => {
            if (draft !== null) {
              const factor = parseZoomInput(draft, cameraSystem.zoomLimits);
              if (factor !== null) setZoom(factor);
            }
            setDraft(null);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
              setInvalid(false);
              e.currentTarget.blur();
            } else if (e.key === 'ArrowDown' && e.altKey) {
              e.preventDefault();
              openMenu(true);
            }
          }}
        />
        <button
          type="button"
          className="zoom-ctl__menu"
          aria-label="Zoom options"
          aria-haspopup="menu"
          aria-expanded={Boolean(menuRect)}
          onClick={(e) => openMenu(e.detail === 0)}
        >
          <ChevronDown size={13} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      {!compact && (
        <button
          type="button"
          className="btn-icon zoom-ctl__step"
          onClick={() => zoomBy(STEP)}
          aria-label="Zoom in"
          data-tooltip={withShortcut('Zoom in', 'Mod+=')}
        >
          <Plus size={14} />
        </button>
      )}

      {menuRect && (
        <Menu
          label="Zoom"
          entries={zoomMenuEntries(
            { hasSelection: menuRect.selection.length > 0, percent },
            {
              zoomIn: () => zoomBy(STEP),
              zoomOut: () => zoomBy(1 / STEP),
              fitAll: () => fly(editor.contentBounds()),
              zoomToSelection: () => {
                const { objects } = useStore.getState();
                const nodes = menuRect.selection.map((id) => objects[id]).filter(Boolean);
                // A lone small object is not blown up past 200%.
                fly(selectionBounds(nodes), Math.min(2, cameraSystem.zoomLimits.maxZoom));
              },
              setZoom,
            }
          )}
          anchor={{ kind: 'rect', rect: menuRect.rect, prefer: compact ? 'below' : 'above', align: compact ? 'end' : 'start' }}
          focusFirst={menuRect.keyboard}
          onClose={() => {
            justClosed.current = performance.now();
            setMenuRect(null);
          }}
        />
      )}
    </div>
  );
};
