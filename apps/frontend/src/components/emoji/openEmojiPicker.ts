export interface OpenEmojiPickerDetail {
  /** Viewport rectangle to hang the picker from. */
  rect: { left: number; top: number; width: number; height: number };
  onPick: (native: string) => void;
  onRemove?: () => void;
  removeLabel?: string;
  current?: string;
  label?: string;
}

export const OPEN_EMOJI_PICKER = 'vega:open-emoji-picker';

/**
 * Open the picker against a point on screen.
 *
 * For callers drawn on the canvas, which have no DOM element to anchor to: a
 * sticky's stamp tray, a frame's icon. `CanvasEmojiPickerHost` is mounted once
 * with the canvas overlays and answers this.
 */
export function openEmojiPicker(detail: OpenEmojiPickerDetail): void {
  window.dispatchEvent(new CustomEvent<OpenEmojiPickerDetail>(OPEN_EMOJI_PICKER, { detail }));
}
