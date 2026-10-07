import React from 'react';
import { Note, Row, Section, Select } from '../grammar';
import { MATERIALS, MATERIAL_IDS, resolveMaterial, type MaterialId } from '../../../utils/behaviorSystem';
import type { AnyNode } from '../../../engine/model/schema';

/** Frames and comments are containers and annotations, not bodies. */
const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);
const isPhysicalType = (type: string) => !NON_PHYSICAL_TYPES.has(type);

interface PhysicsMaterialSectionProps {
  nodes: AnyNode[];
  node: AnyNode;
  set: (updates: Partial<AnyNode>) => void;
}

/** Physics: what the object is made of when it is thrown or dropped. */
export const PhysicsMaterialSection: React.FC<PhysicsMaterialSectionProps> = ({ nodes, node, set }) => {
  if (!nodes.every((n) => isPhysicalType(n.type))) return null;
  const ids = new Set(nodes.map((n) => resolveMaterial(n).id));
  const material = resolveMaterial(node);

  return (
    <Section id="physics" title="Physics" collapsible defaultOpen={false}>
      <Row label="Material">
        <Select<MaterialId>
          label="Material"
          value={ids.size > 1 ? 'mixed' : (material.id as MaterialId)}
          options={MATERIAL_IDS.map((id) => ({ value: id, label: MATERIALS[id].label }))}
          onChange={(id) => set({ material: id })}
        />
      </Row>
      {ids.size === 1 && <Note>{material.hint}</Note>}
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
