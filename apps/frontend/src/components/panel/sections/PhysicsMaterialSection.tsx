import React from 'react';
import { Atom, Info } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { MATERIALS, MATERIAL_IDS, resolveMaterial, type MaterialId } from '../../../utils/behaviorSystem';
import type { AnyNode } from '../../../engine/model/schema';

const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);
const isPhysicalType = (type: string) => !NON_PHYSICAL_TYPES.has(type);

interface PhysicsMaterialSectionProps {
  nodes: AnyNode[];
  node: AnyNode;
  set: (updates: Partial<AnyNode>) => void;
}

export const PhysicsMaterialSection: React.FC<PhysicsMaterialSectionProps> = ({
  nodes,
  node,
  set,
}) => {
  if (!nodes.every((n) => isPhysicalType(n.type))) return null;

  return (
    <Accordion title="Physics" icon={<Atom size={13} />} defaultOpen={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <label
          htmlFor="material-select"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}
        >
          Material
        </label>
        <select
          id="material-select"
          value={resolveMaterial(node).id}
          onChange={(e) => set({ material: e.target.value as MaterialId })}
          style={{
            width: '100%',
            background: 'var(--surface-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-divider)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 8px',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          {MATERIAL_IDS.map((id) => (
            <option key={id} value={id}>{MATERIALS[id].label}</option>
          ))}
        </select>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
          {resolveMaterial(node).hint}
        </p>
      </div>
    </Accordion>
  );
};

interface MetadataSectionProps {
  node: AnyNode;
  isMulti: boolean;
  createdByLabel: string;
  updatedByLabel: string;
}

export const MetadataSection: React.FC<MetadataSectionProps> = ({
  node,
  isMulti,
  createdByLabel,
  updatedByLabel,
}) => {
  if (isMulti) return null;

  return (
    <Accordion title="Metadata" icon={<Info size={13} />} defaultOpen={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <Row label="ID">
          <span style={{ fontFamily: 'monospace', background: 'var(--surface-hover)', padding: '2px 4px', borderRadius: '4px' }}>{node.id.slice(0, 8)}</span>
        </Row>
        <Row label="Created"><span>{new Date(node.createdAt).toLocaleString()}</span></Row>
        <Row label="Updated"><span>{new Date(node.updatedAt).toLocaleString()}</span></Row>
        <Row label="Author"><span>{createdByLabel}</span></Row>
        {node.updatedBy && (
          <Row label="Edited by"><span>{updatedByLabel}</span></Row>
        )}
        {node.parentId && (
          <Row label="Group">
            <span style={{ fontFamily: 'monospace', background: 'var(--surface-hover)', padding: '2px 4px', borderRadius: '4px' }}>{node.parentId.slice(0, 8)}</span>
          </Row>
        )}
      </div>
    </Accordion>
  );
};
