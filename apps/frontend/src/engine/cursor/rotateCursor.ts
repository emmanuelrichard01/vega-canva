import { cursorCss } from './cursorCss';
import { rotateVisual } from './cursorVisual';
import { cursorTheme } from './cursorVisual';
import { quantiseAngle } from '../interaction/rotateHandle';

/** 360 / 5 variants per theme at most; each built once. */
const cache = new Map<string, string>();

const mq = (q: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;

/** Forced colours and coarse pointers cannot show or use a bespoke image cursor. */
export function rotateUsesKeyword(): boolean {
  return mq('(forced-colors: active)') || mq('(pointer: coarse)');
}

/** CSS cursor for a pointer at radial bearing `deg` about the selection centre. */
export function rotateCursorCss(deg: number): string {
  if (rotateUsesKeyword()) return 'grab';
  const q = quantiseAngle(deg, 5);
  const dark = cursorTheme.dark;
  const key = `${q}:${dark ? 'd' : 'l'}`;
  let css = cache.get(key);
  if (!css) {
    css = cursorCss(rotateVisual(q, dark), 'grab');
    cache.set(key, css);
  }
  return css;
}

export function rotateCursorCacheSize(): number {
  return cache.size;
}

export function resetRotateCursorCache(): void {
  cache.clear();
}
