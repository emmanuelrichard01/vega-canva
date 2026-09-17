import type { AnyNode, Appearance } from './schema';

/**
 * What a piece of text is actually read against.
 *
 * The colour picker can show a contrast ratio only if it knows the surface,
 * and for text that is not one thing: a label inside a filled shape sits on the
 * shape's own fill, while a free text box sits on the board. Picking dark blue
 * type is fine on the board and illegible on the navy box the label is in, so
 * a readout measured against the wrong one would be confidently wrong.
 *
 * A fill counts only when it is mostly opaque; a 20% wash is closer to the
 * board than to its own colour. A gradient is represented by its first stop,
 * which is where a left-to-right reader's eye starts.
 */
export function textSurface(node: AnyNode, board: string): string {
  const fill = (node as { appearance?: Appearance }).appearance?.fill?.[0];
  if (node.type !== 'shape' || !fill) return board;
  if (fill.type === 'solid') {
    if (fill.color === 'transparent' || (fill.opacity ?? 1) < 0.5) return board;
    return fill.color;
  }
  const first = [...fill.stops].sort((a, b) => a.offset - b.offset)[0];
  return first && (first.opacity ?? 1) >= 0.5 ? first.color : board;
}

/** The board's colour in the current theme, resolved from the stylesheet. */
export function boardSurface(): string {
  if (typeof document === 'undefined') return '#FAFAFA';
  const value = getComputedStyle(document.body).getPropertyValue('--surface-canvas').trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : document.body.classList.contains('dark-theme') ? '#09090B' : '#FAFAFA';
}
