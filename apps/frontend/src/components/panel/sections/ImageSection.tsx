import React, { useEffect, useState } from 'react';
import { AlertTriangle, Contrast, Droplets, Palette, RotateCw, Sun } from 'lucide-react';
import { Note, NumberField, PairRow, Row, Section } from '../grammar';
import { retryUpload, canRetryUpload, useUploadState } from '../../../engine/media/upload';
import { uploadIdFromSrc } from '../../../utils/pendingMedia';
import { canEditObjects } from '../../../engine/model/permissions';
import { MAX_ALT_LENGTH } from '../../../engine/model/schema';
import {
  ADJUSTMENT_IDS,
  ADJUSTMENT_LABELS,
  ADJUSTMENT_MIN,
  ADJUSTMENT_UNITS,
  hasAdjustments,
  type AdjustmentId,
} from '../../../engine/model/imageAdjustments';
import type { AnyNode, ImageNode } from '../../../engine/model/schema';
import type { AffordanceId } from '../../../engine/selection/affordances';

interface ImageSectionProps {
  node: ImageNode;
  adjustments: Record<AdjustmentId, number>;
  affords: (id: AffordanceId) => boolean;
  setAdjustment: (id: AdjustmentId, value: number) => void;
  set: (updates: Partial<AnyNode>) => void;
  /** One image selected: alt text and upload state describe one picture. */
  single: boolean;
}

const GLYPHS: Record<string, React.ReactNode> = {
  brightness: <Sun size={12} />,
  contrast: <Contrast size={12} />,
  saturation: <Palette size={12} />,
  blur: <Droplets size={12} />,
};

/** Alt text, written when the field is left or Enter is pressed. */
const AltText: React.FC<{ value: string; onCommit: (alt: string | undefined) => void }> = ({ value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim().slice(0, MAX_ALT_LENGTH);
    if (next !== value) onCommit(next || undefined);
  };
  return (
    <textarea
      className="pg-textarea"
      aria-label="Alt text"
      placeholder="Describe what the picture shows"
      rows={2}
      maxLength={MAX_ALT_LENGTH}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
};

/** An upload that failed: why, and a Retry for editors while this device still has the bytes. */
const UploadProblem: React.FC<{ src: string }> = ({ src }) => {
  const state = useUploadState(src);
  if (!state || state.phase !== 'failed') return null;
  const id = uploadIdFromSrc(src);
  const retryable = Boolean(id && canRetryUpload(id)) && canEditObjects();
  return (
    <div className="pg-alert" role="alert">
      <AlertTriangle size={14} aria-hidden="true" className="pg-alert__icon" />
      <p className="pg-alert__text">Upload failed: {state.reason}</p>
      {retryable && id && (
        <button type="button" className="pg-alert__action" onClick={() => void retryUpload(id)}>
          <RotateCw size={12} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
};

/**
 * Image: its upload state and alt text, then Adjust (brightness, contrast,
 * saturation and blur, two to a row; zero is as shot). Each field scrubs,
 * previews live and is one undo step.
 */
export const ImageSection: React.FC<ImageSectionProps> = ({ node, adjustments, affords, setAdjustment, set, single }) => {
  if (node.type !== 'image') return null;
  const adjustable = affords('image-adjust');

  const fields = ADJUSTMENT_IDS.map((id) => (
    <NumberField
      key={id}
      label={ADJUSTMENT_LABELS[id]}
      glyph={GLYPHS[id] ?? ADJUSTMENT_LABELS[id].charAt(0)}
      unit={ADJUSTMENT_UNITS[id] || undefined}
      min={ADJUSTMENT_MIN[id]}
      max={100}
      value={adjustments[id]}
      onChange={(v) => setAdjustment(id, v)}
    />
  ));
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < fields.length; i += 2) rows.push(<PairRow key={i}>{fields.slice(i, i + 2)}</PairRow>);

  return (
    <>
      {single && (
        <Section id="image" title="Image">
          <UploadProblem src={node.src} />
          <Row stack label="Alt text" hint="Read aloud by screen readers, and used in exports.">
            <AltText value={node.alt ?? ''} onCommit={(alt) => set({ alt } as Partial<AnyNode>)} />
          </Row>
          {!node.alt && <Note>Without alt text, a screen reader announces only "image".</Note>}
        </Section>
      )}
      {adjustable && (
        <Section
          id="adjust"
          title="Adjust"
          menu={
            hasAdjustments(adjustments)
              ? [{ kind: 'item', id: 'reset', label: 'Reset adjustments', onSelect: () => set({ filters: undefined } as Partial<AnyNode>) }]
              : undefined
          }
        >
          {rows}
        </Section>
      )}
    </>
  );
};
