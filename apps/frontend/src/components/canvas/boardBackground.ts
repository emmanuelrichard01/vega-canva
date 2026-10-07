import { useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { metadataMap } from '../../engine/document';
import { isCssColor } from '../../engine/text/cssColor';
import { luminance, normalizeHex } from '../../engine/model/color';

/** The metadata key the board's background colour is stored under. */
export const BOARD_BACKGROUND_KEY = 'background';

function subscribe(onChange: () => void): () => void {
  const handler = (event: Y.YMapEvent<string>) => {
    if (event.keysChanged.has(BOARD_BACKGROUND_KEY)) onChange();
  };
  metadataMap.observe(handler);
  return () => metadataMap.unobserve(handler);
}

/** The stored background, or null when it is unset or not a valid colour. */
export function readBoardBackground(): string | null {
  const value = metadataMap.get(BOARD_BACKGROUND_KEY);
  return isCssColor(value) ? value : null;
}

/**
 * The board's own background colour, shared by everyone in the room, or
 * null for the theme's canvas colour. Re-renders only when it changes.
 */
export function useBoardBackground(): string | null {
  return useSyncExternalStore(subscribe, readBoardBackground, readBoardBackground);
}

/**
 * The canvas's inline style for a board background: the colour, and a dot
 * grid that stays visible on it (dark dots on a light ground, light on dark).
 */
export function boardBackgroundStyle(background: string | null): Record<string, string> {
  if (!background) return {};
  const hex = normalizeHex(background);
  const dark = hex ? luminance(hex) < 0.18 : false;
  return {
    backgroundColor: background,
    '--canvas-dot': dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.1)',
  };
}
