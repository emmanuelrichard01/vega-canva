import React from 'react';
import { ColorChip, Note, Row, Section } from '../panel/grammar';
import { MAX_ICON_LABEL } from '../../engine/icons/iconSpec';
import './iconSection.css';
import type { IconNode } from '../../engine/model/schema';

/**
 * The properties panel's section for an icon: its recolour and its caption.
 *
 * `onChange` takes a partial node, written through the panel's usual patch
 * path. Clearing the colour (`transparent` in the chip) puts the vendor's
 * colours back, so recolouring is always undoable by hand.
 */
export const IconSection: React.FC<{ node: IconNode; onChange: (patch: Partial<IconNode>) => void }> = ({ node, onChange }) => (
  <Section id="icon" title="Icon">
    <Row label="Colour" hint="Repaints everything except white. None keeps the vendor colours.">
      <ColorChip
        label="Icon colour"
        value={node.colour ?? 'transparent'}
        allowNone
        onChange={(c) => onChange({ colour: c === 'transparent' ? undefined : c })}
      />
    </Row>
    <Row label="Caption" htmlFor={`icon-caption-${node.id}`}>
      <input
        id={`icon-caption-${node.id}`}
        className="icon-caption"
        type="text"
        value={node.label ?? ''}
        maxLength={MAX_ICON_LABEL}
        placeholder="None"
        onChange={(e) => onChange({ label: e.target.value || undefined })}
      />
    </Row>
    <Note>The caption sits below the icon, outside its frame.</Note>
  </Section>
);
