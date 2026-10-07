import React from 'react';
import { Feather, FileText, Circle, TreePine, Mountain, Pin, MoreHorizontal } from 'lucide-react';
import { Note, Section } from '../grammar';
import { MATERIALS, MATERIAL_IDS, resolveMaterial, type MaterialId } from '../../../utils/behaviorSystem';
import { isPhysicalType } from '../../../engine/physics/simulation';
import type { AnyNode } from '../../../engine/model/schema';
import '../../physics/physics.css';

interface PhysicsMaterialSectionProps {
  nodes: AnyNode[];
  node: AnyNode;
  set: (updates: Partial<AnyNode>) => void;
}

const GLYPHS: Record<MaterialId, React.ReactNode> = {
  feather: <Feather size={18} strokeWidth={1.6} />,
  paper: <FileText size={18} strokeWidth={1.6} />,
  rubber: <Circle size={18} strokeWidth={1.6} />,
  wood: <TreePine size={18} strokeWidth={1.6} />,
  stone: <Mountain size={18} strokeWidth={1.6} />,
};

/** Only a sticky can be pinned; see `isPinned` in the schema. */
const canPin = (n: AnyNode) => n.type === 'sticky';
const pinnedOf = (n: AnyNode) => canPin(n) && (n as { pinned?: boolean }).pinned === true;

/**
 * Physics: what the object is made of when it is thrown or pushed.
 *
 * Five materials as pictures with names, plus Pinned, which holds a note in
 * place while everything else moves around it. The numbers behind a material
 * (drag, bounce, density) sit behind the ellipsis for anyone who wants them.
 */
export const PhysicsMaterialSection: React.FC<PhysicsMaterialSectionProps> = ({ nodes, node, set }) => {
  const [numbers, setNumbers] = React.useState(false);
  if (!nodes.every((n) => isPhysicalType(n.type))) return null;

  const ids = new Set(nodes.map((n) => resolveMaterial(n).id));
  const material = resolveMaterial(node);
  const pinnable = nodes.every(canPin);
  const allPinned = pinnable && nodes.every(pinnedOf);

  return (
    <Section id="physics" title="Physics" collapsible defaultOpen={false}>
      <div className="physmat" role="radiogroup" aria-label="Material">
        {MATERIAL_IDS.map((id) => {
          const active = ids.size === 1 && material.id === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`physmat__chip ${active ? 'is-active' : ''}`}
              onClick={() => set({ material: id })}
              data-tooltip={MATERIALS[id].hint}
            >
              <span className="physmat__glyph" aria-hidden="true">{GLYPHS[id]}</span>
              {MATERIALS[id].label}
            </button>
          );
        })}
        <button
          type="button"
          role="switch"
          aria-checked={allPinned}
          className={`physmat__chip ${allPinned ? 'is-active' : ''}`}
          disabled={!pinnable}
          onClick={() => set({ pinned: !allPinned } as Partial<AnyNode>)}
          data-tooltip={
            pinnable
              ? 'Holds this note in place. Other objects still bounce off it'
              : 'Only notes can be pinned. Lock the object to hold it in place instead'
          }
        >
          <span className="physmat__glyph" aria-hidden="true"><Pin size={18} strokeWidth={1.6} /></span>
          Pinned
        </button>
      </div>

      {ids.size === 1 ? <Note>{material.hint}</Note> : <Note>Mixed materials. Choose one to set them all.</Note>}

      <button
        type="button"
        className="forces__more"
        aria-expanded={numbers}
        onClick={() => setNumbers((v) => !v)}
        data-tooltip="The numbers behind this material"
        aria-label="Material details"
      >
        <MoreHorizontal size={14} aria-hidden="true" /> Details
      </button>
      {numbers && ids.size === 1 && (
        <dl className="physmat__more">
          <dt>Air drag</dt>
          <dd>{material.frictionAir}</dd>
          <dt>Bounce</dt>
          <dd>{material.restitution}</dd>
          <dt>Density</dt>
          <dd>{material.density}</dd>
        </dl>
      )}
    </Section>
  );
};

interface MetadataSectionProps {
  node: AnyNode;
  isMulti: boolean;
  createdByLabel: string;
  updatedByLabel: string;
}

function when(timestamp: number | undefined): string {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Info: who made this and when. Folded away by default at the foot of the panel. */
export const MetadataSection: React.FC<MetadataSectionProps> = ({ node, isMulti, createdByLabel, updatedByLabel }) => {
  if (isMulti) return null;
  return (
    <Section id="info" title="Info" collapsible defaultOpen={false}>
      <dl className="pg-info">
        <dt>Created</dt>
        <dd>
          {createdByLabel}, {when(node.createdAt)}
        </dd>
        {node.updatedBy && (
          <>
            <dt>Edited</dt>
            <dd>
              {updatedByLabel}, {when(node.updatedAt)}
            </dd>
          </>
        )}
      </dl>
    </Section>
  );
};
