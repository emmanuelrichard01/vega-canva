import React, { useEffect } from 'react';
import { hintShortcut } from '../menu/shortcuts';
import { suppressTooltips } from '../../engine/ui/tooltipManager';

/**
 * Names a control through the app's one tooltip layer.
 *
 * `TooltipLayer` reads `data-tooltip` (and `-pos`, `-desc`) from whatever the
 * pointer or keyboard focus is on, so a tooltip is attributes, not a surface
 * per caller. When to show one is the manager's call (`engine/ui/tooltipManager`):
 * one at a time, 400ms from cold, instant within 300ms of the last, immediate on
 * keyboard focus, Escape dismisses, long-press on touch.
 *
 * A control that opens a surface keeps its own tip quiet with
 * `useSuppressTooltips(open, id)`; a surface that covers the board silences all
 * tips with `useSuppressTooltips(open)`. Menus and popovers do it themselves.
 *
 * This wrapper is those attributes with a type, for code that would
 * rather pass props than remember the spelling.
 */
export interface TooltipProps {
  label: string;
  /** A written shortcut such as `Mod+Shift+E`; shown as keycaps after the label. */
  shortcut?: string;
  /** A second line, for what the label cannot carry. */
  description?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactElement;
}

export const tooltipProps = ({ label, shortcut, description, side }: Omit<TooltipProps, 'children'>) => ({
  'data-tooltip': shortcut ? `${label} (${hintShortcut(shortcut)})` : label,
  ...(side ? { 'data-tooltip-pos': side } : {}),
  ...(description ? { 'data-tooltip-desc': description } : {}),
});

export const Tooltip: React.FC<TooltipProps> = ({ children, ...spec }) =>
  React.cloneElement(children as React.ReactElement<Record<string, unknown>>, tooltipProps(spec));

/**
 * Hold tooltips back while `active`: for one anchor id, or all of them when no id is given.
 * The anchor id is the element's `id`, which `TooltipLayer` also uses as its key.
 */
export function useSuppressTooltips(active: boolean, anchorId?: string): void {
  useEffect(() => {
    if (!active) return;
    return suppressTooltips(anchorId ?? true);
  }, [active, anchorId]);
}
