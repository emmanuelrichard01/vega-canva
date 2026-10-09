import { useStore } from './useStore';
import { groundOf, textInkOnSurface, wantsLightInk } from '../engine/model/surfaceInk';
import type { AnyNode } from '../engine/model/schema';

/** The fill of the frame this node sits on, or null for the bare board. Primitive, so it only re-renders on change. */
export function useGround(node: AnyNode): string | null {
  return useStore((s) => groundOf(node, s.objects));
}

/** Whether this node's surface wants light ink. */
export function useWantsLightInk(node: AnyNode): boolean {
  return useStore((s) => wantsLightInk(node, s.objects, s.darkTheme));
}

/** A text colour that follows the surface (default ink only). */
export function useSurfaceTextInk(node: AnyNode, color: string): string {
  return useStore((s) => textInkOnSurface(color, node, s.objects, s.darkTheme));
}
