import type React from 'react';
import { editor } from '../../../engine/api/EditorAPI';
import type { AnyNode, Appearance } from '../../../engine/model/schema';
import type { CanvasContextMenuActions } from '../../menu/canvasMenu';
import type { RailSubjectKind } from './subject';

/** What every single-object rail module is given. */
export interface SingleRailProps<N extends AnyNode = AnyNode> {
  node: N;
  subject: RailSubjectKind;
  menuActions: CanvasContextMenuActions;
  /** Paste style, when a copied style would land here; null otherwise. */
  conditional: React.ReactNode;
  /** Comment and `⋯`, built by the frame so every subject ends the same way. */
  tail: React.ReactNode;
  tailControls: number;
}

export type SingleRail<N extends AnyNode = AnyNode> = React.FC<SingleRailProps<N>>;

/** Writes through the editor API, which goes through the document's role gate. */
export const updateNode = (id: string, updates: Record<string, unknown>) => editor.updateNode(id, updates);

/** The node's appearance, and a setter that merges a patch into it. */
export function appearanceOf(node: AnyNode): {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
} {
  const appearance: Appearance = ('appearance' in node ? (node.appearance as Appearance | undefined) : undefined) ?? {};
  return {
    appearance,
    setAppearance: (patch) => updateNode(node.id, { appearance: { ...appearance, ...patch } }),
  };
}
