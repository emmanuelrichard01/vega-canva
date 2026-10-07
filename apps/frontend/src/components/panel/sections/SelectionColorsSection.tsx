import React, { useEffect, useRef, useState } from 'react';
import { ColorChip, Section, writePatches } from '../grammar';
import { colorUses, recolorPatches, type ColorUse } from '../selectionColors';
import type { AnyNode } from '../../../engine/model/schema';

const ROLE_NAMES = { fill: 'fill', stroke: 'stroke', text: 'text' } as const;

/**
 * One colour in the selection.
 *
 * The colour being replaced is held in a ref for the whole interaction:
 * dragging through the picker rewrites "the colour this row started as",
 * then "the colour the last step produced", and so on, so each step moves
 * exactly the objects the row stood for, even after it has merged with
 * another colour in the selection.
 */
const ColorUseRow: React.FC<{
  use: ColorUse;
  nodes: AnyNode[];
  onOpenChange: (open: boolean) => void;
  onRecolored: (to: string) => void;
}> = ({ use, nodes, onOpenChange, onRecolored }) => {
  const source = useRef(use.color);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) source.current = use.color;
  }, [use.color]);

  return (
    <div className="pg-list-item">
      <ColorChip
        label={`Colour used as ${use.roles.map((r) => ROLE_NAMES[r]).join(' and ')} on ${use.ids.length} object${use.ids.length === 1 ? '' : 's'}`}
        value={use.color}
        allowNone={false}
        onOpenChange={(open) => {
          editing.current = open;
          if (!open) source.current = use.color;
          onOpenChange(open);
        }}
        onChange={(to) => {
          const patches = recolorPatches(nodes, source.current, to);
          if (patches.length > 0) writePatches(patches);
          source.current = to;
          onRecolored(to);
        }}
      />
      <span className="pg-use-count" aria-hidden="true">{use.ids.length}</span>
    </div>
  );
};

/**
 * Every colour in a multi-selection, most used first. Changing one repaints
 * every use of it across the selection.
 *
 * While a picker is open the list is held still, so the row being edited
 * keeps its place and its picker even as counts change and colours merge.
 */
export const SelectionColorsSection: React.FC<{ nodes: AnyNode[] }> = ({ nodes }) => {
  const live = colorUses(nodes, 12);
  const [frozen, setFrozen] = useState<ColorUse[] | null>(null);
  const shown = frozen ?? live;
  if (nodes.length < 2 || shown.length === 0) return null;

  return (
    <Section id="selection-colours" title="Selection colours" meta={shown.length} collapsible>
      <div className="pg-list">
        {shown.map((use, i) => (
          <ColorUseRow
            // Position, not colour: the colour changes while it is edited.
            key={i}
            use={use}
            nodes={nodes}
            onOpenChange={(open) => setFrozen(open ? shown : null)}
            onRecolored={(to) =>
              setFrozen((list) => (list ? list.map((u, j) => (j === i ? { ...u, color: to.toUpperCase() } : u)) : list))
            }
          />
        ))}
      </div>
    </Section>
  );
};
