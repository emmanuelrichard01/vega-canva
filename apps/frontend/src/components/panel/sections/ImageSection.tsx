import React, { useEffect, useState } from 'react';
import { AlertTriangle, Contrast, Droplets, Palette, RotateCcw, RotateCw, Square, Sun } from 'lucide-react';
import { Note, NumberField, PairRow, Row, Section, SegmentedControl, Select } from '../grammar';
import { retryUpload, canRetryUpload, useUploadState } from '../../../engine/media/upload';
import { ASPECT_PRESETS, frameModeOf, matchingPreset } from '../../../engine/media/imageFrame';
import { setImageAspect, setImageFrame, turnImage } from '../../../engine/media/imageEdit';
import { uploadIdFromSrc } from '../../../utils/pendingMedia';
import { canEditObjects } from '../../../engine/model/permissions';
import { cornerRadiiOf, isUniform } from '../../../engine/model/cornerRadii';
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
import './imageSection.css';

interface ImageSectionProps {
  node: ImageNode;
  adjustments: Record<AdjustmentId, number>;
  affords: (id: AffordanceId) => boolean;
  setAdjustment: (id: AdjustmentId, value: number) => void;
  set: (updates: Partial<AnyNode>) => void;
  /** One image selected: framing, alt text and upload state describe one picture. */
  single: boolean;
}

const GLYPHS: Record<string, React.ReactNode> = {
  brightness: <Sun size={12} />,
  contrast: <Contrast size={12} />,
  saturation: <Palette size={12} />,
  blur: <Droplets size={12} />,
};

const CROP_OPTIONS = ASPECT_PRESETS.map((p) => ({ value: p.id, label: p.label }));

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
 * How the picture sits in its box: fit or fill, a crop ratio, quarter turns,
 * and the corners.
 *
 * A picture in a grid module is framed by the module, so these give way to the
 * toolbar's Reframe there rather than fighting the grid for the edges.
 */
const Framing: React.FC<{ node: ImageNode; set: (updates: Partial<AnyNode>) => void }> = ({ node, set }) => {
  const natural = { width: node.naturalWidth ?? 0, height: node.naturalHeight ?? 0 };
  const mode = frameModeOf(node, natural, node.crop);
  const waiting = mode === null ? 'Available once the picture has loaded' : undefined;
  const preset = matchingPreset(natural, node.crop);
  const radii = cornerRadiiOf(node.appearance?.cornerRadius);
  const radiusMax = Math.max(0, Math.floor(Math.min(node.width, node.height) / 2));

  if (node.gridSlot) {
    return <Note>This picture is framed by its grid module. Use Reframe on the toolbar to move it inside the module.</Note>;
  }

  return (
    <>
      <Row label="Frame" hint="Fit shows the whole picture. Fill covers the box and crops the edges.">
        <SegmentedControl
          ariaLabel="Frame"
          fill
          value={mode === 'stretched' ? '' : (mode ?? '')}
          mixed={mode === 'stretched'}
          disabledReason={waiting}
          onChange={(v) => setImageFrame(node, v as 'fit' | 'fill')}
          segments={[
            { value: 'fit', label: 'Fit', hint: 'Show the whole picture at its own proportions' },
            { value: 'fill', label: 'Fill', hint: 'Cover the box, cropping what overhangs' },
          ]}
        />
      </Row>
      {mode === 'stretched' && <Note>The picture is stretched out of proportion. Fit or Fill restores it.</Note>}
      <Row label="Crop" hint="Crop to a common ratio around the current centre. Original puts the whole picture back.">
        <Select
          label="Crop ratio"
          value={(preset ?? 'custom') as string}
          options={preset ? CROP_OPTIONS : [{ value: 'custom', label: 'Custom' }, ...CROP_OPTIONS]}
          disabledReason={waiting}
          onChange={(id) => {
            const p = ASPECT_PRESETS.find((x) => x.id === id);
            if (p) setImageAspect(node, p.ratio);
          }}
        />
      </Row>
      <Row label="Turn">
        <div className="pg-image-turn">
          <button type="button" className="pg-toggle" aria-label="Turn left 90°" data-tooltip="Turn left 90°" onClick={() => turnImage(node, -1)}>
            <RotateCcw size={14} aria-hidden />
          </button>
          <button type="button" className="pg-toggle" aria-label="Turn right 90°" data-tooltip="Turn right 90°" onClick={() => turnImage(node, 1)}>
            <RotateCw size={14} aria-hidden />
          </button>
        </div>
      </Row>
      <Row label="Corners">
        <NumberField
          label="Corner radius"
          glyph={<Square size={12} />}
          min={0}
          max={radiusMax}
          value={isUniform(node.appearance?.cornerRadius) ? radii[0] : 'mixed'}
          onChange={(v) => set({ appearance: { ...(node.appearance ?? {}), cornerRadius: Math.max(0, Math.min(radiusMax, v)) } } as Partial<AnyNode>)}
        />
      </Row>
    </>
  );
};

/**
 * Image: upload state, framing and alt text, then Adjust (brightness,
 * contrast, saturation and blur, two to a row; zero is as shot). Border and
 * shadow are the panel's own Stroke and Effects sections, which images share
 * with every paintable object. Each field scrubs, previews live and is one
 * undo step.
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
          <Framing node={node} set={set} />
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
