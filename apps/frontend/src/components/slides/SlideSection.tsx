import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LayoutGrid, Play, Timer } from 'lucide-react';
import { NumberField, Row, Section, SegmentedControl, Select, Switch } from '../panel/grammar';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import type { Shared } from '../../engine/model/selection';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import {
  DEFAULT_TRANSITION_MS,
  MAX_NOTES,
  MAX_SECTION,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  slideFields,
  TRANSITION_DIRECTIONS,
  TRANSITION_EASES,
  TRANSITIONS,
  transitionSpecOf,
  type SlideTransition,
  type TransitionDirection,
  type TransitionEase,
  type TransitionKind,
} from '../../engine/slides/slideMeta';
import { setSlideNotes, setSlideSection, setSlidesHidden, setSlideTransition, tuneSlideTransition } from '../../engine/slides/deckEdits';
import { openSlideView, startPresenting, useDeck } from './useSlides';
import { TransitionGlyph } from './TransitionGlyph';
import { TransitionPreview } from './TransitionPreview';
import './slides.css';

/**
 * A frame, as a slide: its place in the deck, how the show arrives at it,
 * whether it is skipped, the section it starts, and the speaker notes.
 *
 * Shown for top-level frames only; a frame inside another is part of that
 * slide. Transition and skip apply to every selected slide; section and notes
 * belong to one slide and appear when one is selected.
 */
export const SlideSection: React.FC<{
  node: FrameNode;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
}> = ({ node, shared }) => {
  const { canEdit } = useRoomPermissions();
  const { deck } = useDeck();
  const frames: string[] = [];
  shared((n) => {
    if (n.type === 'frame' && !n.frameId) frames.push(n.id);
    return 0;
  });
  const slide = deck.find((s) => s.frame.id === node.id);
  if (!slide || frames.length === 0) return null;

  const transition = shared((n) => (n.type === 'frame' ? slideFields(n).transition ?? 'glide' : 'glide'));
  const hidden = shared((n) => (n.type === 'frame' ? slideFields(n).slideHidden === true : false));
  const single = frames.length === 1;
  const meta = slideFields(node);
  const played = deck.filter((s) => !s.hidden).length;

  return (
    <Section
      id="slide"
      title="Slide"
      meta={single ? (slide.number ? `${slide.number} of ${played}` : 'Skipped') : `${frames.length} slides`}
    >
      <Row label="Transition" hint="How the presentation arrives at this slide.">
        <Select
          label="Transition into the slide"
          value={transition.mixed ? 'mixed' : transition.value}
          disabledReason={canEdit ? undefined : 'Only editors can change slides.'}
          options={TRANSITIONS.map((t) => ({ value: t.id, label: t.label, detail: t.hint, icon: <TransitionGlyph kind={t.id} /> }))}
          onChange={(v) => setSlideTransition(frames, v as SlideTransition | 'glide')}
        />
      </Row>
      {!transition.mixed && transition.value !== 'none' && (
        <TransitionTuning frames={frames} node={node} shared={shared} kind={transition.value} canEdit={canEdit} />
      )}
      <Row label="Skip" hint="Leave the slide out of the presentation and the PDF. It stays on the board and in the deck.">
        <Switch
          ariaLabel="Skip this slide when presenting"
          checked={hidden.mixed ? 'mixed' : hidden.value}
          disabled={!canEdit}
          onChange={(on) => setSlidesHidden(frames, on)}
        />
      </Row>
      {single && (
        <TextRow
          label="Section"
          hint="Start a named section at this slide. The slide view and the presenter view show it."
          value={meta.slideSection ?? ''}
          placeholder="No section"
          max={MAX_SECTION}
          editable={canEdit}
          onCommit={(v) => setSlideSection(node.id, v)}
        />
      )}
      {single && <NotesRow id={node.id} value={meta.notes ?? ''} editable={canEdit} />}
      <div className="slide-section-actions">
        <button type="button" className="sketch-redraw" onClick={() => openSlideView(node.id)}>
          <LayoutGrid size={13} aria-hidden="true" />
          Slide view
        </button>
        <button
          type="button"
          className="sketch-redraw"
          onClick={() => startPresenting({ startId: node.id })}
          disabled={slide.hidden}
          data-tooltip={slide.hidden ? 'This slide is skipped. Show it to present from it.' : 'Present from this slide'}
        >
          <Play size={13} aria-hidden="true" />
          Present
        </button>
      </div>
    </Section>
  );
};

/** One line, committed on Enter or on leaving it. */
const TextRow: React.FC<{
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  max: number;
  editable: boolean;
  onCommit: (v: string) => void;
}> = ({ label, hint, value, placeholder, max, editable, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Row stack label={label} hint={hint}>
      <input
        className="frame-desc-input"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        maxLength={max}
        readOnly={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
    </Row>
  );
};

/** Speaker notes: a draft while typing, written when the writer pauses or leaves. */
const NotesRow: React.FC<{ id: string; value: string; editable: boolean }> = ({ id, value, editable }) => {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef(0);
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    setSlideNotes(id, text);
  };
  return (
    <Row stack label="Speaker notes" hint="What to say on this slide. Shown in the presenter view, never to the audience.">
      <textarea
        className="slide-notes-input"
        aria-label="Speaker notes"
        placeholder={editable ? 'What to say on this slide' : 'No notes'}
        value={draft}
        maxLength={MAX_NOTES}
        readOnly={!editable}
        rows={4}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          dirty.current = true;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(text), 700);
        }}
        onBlur={() => dirty.current && commit(draft)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span className="slide-notes-count" aria-hidden="true">
        {draft.length > MAX_NOTES * 0.8 ? `${draft.length} / ${MAX_NOTES}` : ''}
      </span>
    </Row>
  );
};

const DIRECTION_GLYPHS: Record<TransitionDirection, React.ReactNode> = {
  left: <ArrowLeft size={14} />,
  right: <ArrowRight size={14} />,
  up: <ArrowUp size={14} />,
  down: <ArrowDown size={14} />,
};

/**
 * How the transition plays: which way a push or slide travels, how long it
 * takes and its curve, with a preview that plays it from the previous slide.
 */
const TransitionTuning: React.FC<{
  frames: string[];
  node: FrameNode;
  shared: <T>(read: (n: AnyNode) => T) => Shared<T>;
  kind: TransitionKind;
  canEdit: boolean;
}> = ({ frames, node, shared, kind, canEdit }) => {
  const { deck, objects } = useDeck();
  const dir = shared((n) => (n.type === 'frame' ? transitionSpecOf(n).direction : 'left'));
  const ms = shared((n) => (n.type === 'frame' ? transitionSpecOf(n).ms : DEFAULT_TRANSITION_MS[kind]));
  const ease = shared((n) => (n.type === 'frame' ? transitionSpecOf(n).ease : 'standard'));
  const at = deck.findIndex((s) => s.frame.id === node.id);
  const previous = at > 0 ? deck.slice(0, at).reverse().find((s) => !s.hidden)?.frame ?? null : null;
  const reason = canEdit ? undefined : 'Only editors can change slides.';
  return (
    <>
      {(kind === 'push' || kind === 'slide') && (
        <Row label="Direction" hint="Which way the new slide travels.">
          <SegmentedControl
            ariaLabel="Transition direction"
            fill
            mixed={dir.mixed}
            disabledReason={reason}
            value={dir.mixed ? '' : dir.value}
            onChange={(v) => tuneSlideTransition(frames, { transitionDir: v as TransitionDirection })}
            segments={TRANSITION_DIRECTIONS.map((d) => ({ value: d, icon: DIRECTION_GLYPHS[d], hint: `Towards the ${d}` }))}
          />
        </Row>
      )}
      <Row label="Duration" hint="How long the transition takes.">
        <NumberField
          label="Transition duration"
          glyph={<Timer size={13} />}
          unit="ms"
          min={MIN_TRANSITION_MS}
          max={MAX_TRANSITION_MS}
          step={20}
          coarseStep={100}
          value={ms.mixed ? 'mixed' : ms.value}
          disabledReason={reason}
          onChange={(v) => tuneSlideTransition(frames, { transitionMs: Math.round(Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, v))) })}
        />
      </Row>
      <Row stack label="Easing" hint="Gentle swells evenly, Standard eases in and out, Snappy leaves at once and settles.">
        <SegmentedControl
          ariaLabel="Transition easing"
          fill
          mixed={ease.mixed}
          disabledReason={reason}
          value={ease.mixed ? '' : ease.value}
          onChange={(v) => tuneSlideTransition(frames, { transitionEase: v as TransitionEase })}
          segments={TRANSITION_EASES.map((e) => ({ value: e.id, label: e.label }))}
        />
      </Row>
      {frames.length === 1 && (
        <Row stack label="Preview" hint="Plays the transition from the previous slide.">
          <TransitionPreview from={previous} to={node} objects={objects} spec={transitionSpecOf(node)} />
        </Row>
      )}
    </>
  );
};
