import React, { useEffect } from 'react';
import { ChevronDown, Frame, Layers, MoveDiagonal2, SquareDashedMousePointer, StretchHorizontal, StretchVertical } from 'lucide-react';
import { RailPopover } from '../toolbar/RailPopover';
import { Row } from '../panel/grammar';
import { describeMix } from '../toolbar/rail/describeMix';
import { requestSelectSimilar, type SimilarKey } from '../toolbar/rail/menuExtras';
import { editor } from '../../engine/api/EditorAPI';
import { useStore } from '../../hooks/useStore';
import { arrangeGhost, alignKey } from '../../engine/arrange/preview';
import { isPlan, planMatchSize, summarizeStyle, type MatchDimension, type StyleSummary } from '../../engine/arrange/plans';
import { commitPatches } from '../../engine/arrange/livePreview';
import { canFrameSelection, frameSelection } from '../../engine/arrange/frameSelection';
import type { UnitSet } from '../../engine/arrange/units';
import type { AnyNode } from '../../engine/model/schema';
import { kindNoun } from '../../engine/model/selectMatching';
import { selectionBounds } from '../../engine/model/selection';
import { ghostHandlers, planHint } from './ghost';
import './arrange.css';

/**
 * The selection chip, opened: what the selection is and what it shares.
 *
 * The count leads the rail, as in FigJam. Opened, it says what is in the
 * selection and how it is painted, honestly: one value where every object
 * agrees, Mixed where they do not, None, or nothing at all for a property no
 * selected object has. Each shared property can widen the selection to
 * everything on the board painted the same way. Below that, the two set-level
 * commands that have no better home on the rail: Match size and Frame
 * selection.
 */

const Swatch: React.FC<{ color?: string; gradient?: boolean }> = ({ color, gradient }) => (
  <i
    className="arr-swatch"
    data-gradient={gradient || undefined}
    style={color ? ({ '--swatch': color } as React.CSSProperties) : undefined}
    aria-hidden="true"
  />
);

const SameButton: React.FC<{ what: SimilarKey; label: string; close: () => void }> = ({ what, label, close }) => (
  <button
    type="button"
    className="ctx-btn arr-same"
    aria-label={label}
    data-tooltip={label}
    onClick={() => {
      requestSelectSimilar(what);
      close();
    }}
  >
    <SquareDashedMousePointer size={14} />
  </button>
);

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fillWords(fill: StyleSummary['fill']): string {
  if (fill.state === 'mixed') return 'Mixed';
  if (fill.state === 'none') return 'None';
  if (fill.gradient) return 'Gradient';
  return (fill.color ?? '').toUpperCase();
}

function strokeWords(stroke: StyleSummary['stroke']): string {
  if (stroke.state === 'mixed') return 'Mixed';
  if (stroke.state === 'none') return 'None';
  return `${stroke.width} px`;
}

const MATCH: Array<{ dim: MatchDimension; label: string; icon: React.ReactNode }> = [
  { dim: 'width', label: 'Match width', icon: <StretchHorizontal size={16} /> },
  { dim: 'height', label: 'Match height', icon: <StretchVertical size={16} /> },
  { dim: 'both', label: 'Match width and height', icon: <MoveDiagonal2 size={16} /> },
];

const SelectionPanel: React.FC<{ nodes: readonly AnyNode[]; unitSet: UnitSet; close: () => void }> = ({ nodes, unitSet, close }) => {
  const summary = summarizeStyle(nodes);
  const bounds = selectionBounds(nodes);
  const groupCount = unitSet.units.filter((u) => u.group).length;
  const uniformType = nodes.every((n) => n.type === nodes[0]?.type);
  const key = alignKey.get();
  const keyKey = key.target === 'key' ? key.key : null;
  useEffect(() => () => arrangeGhost.set(null), []);

  return (
    <div className="arr-panel arr-panel--selection">
      <div className="arr-head">
        <span className="arr-head__title">{capitalise(describeMix(nodes))}</span>
        {bounds && (
          <span className="arr-head__mix">
            {Math.round(bounds.width)} × {Math.round(bounds.height)}
            {groupCount > 0 && ` · ${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`}
          </span>
        )}
      </div>

      <div className="arr-summary">
        {summary.fill.state !== 'na' && (
          <Row label="Fill">
            <span className="arr-value" data-mixed={summary.fill.state === 'mixed' || undefined}>
              {summary.fill.state === 'one' && <Swatch color={summary.fill.color} gradient={summary.fill.gradient} />}
              {fillWords(summary.fill)}
            </span>
            <SameButton what="fill" label="Select everything with this fill" close={close} />
          </Row>
        )}
        {summary.stroke.state !== 'na' && (
          <Row label="Stroke">
            <span className="arr-value" data-mixed={summary.stroke.state === 'mixed' || undefined}>
              {summary.stroke.state === 'one' && <Swatch color={summary.stroke.color} />}
              {strokeWords(summary.stroke)}
            </span>
            <SameButton what="stroke" label="Select everything with this stroke" close={close} />
          </Row>
        )}
        <Row label="Opacity">
          <span className="arr-value" data-mixed={summary.opacity.state === 'mixed' || undefined}>
            {summary.opacity.state === 'one' ? `${summary.opacity.value}%` : 'Mixed'}
          </span>
        </Row>
        <Row label="Type">
          <span className="arr-value" data-mixed={!uniformType || undefined}>
            {uniformType && nodes[0] ? capitalise(kindNoun(nodes[0], true)) : 'Mixed'}
          </span>
          <SameButton what="type" label="Select everything of these types" close={close} />
        </Row>
      </div>

      <div className="arr-rule" aria-hidden="true" />
      <Row label="Match size">
        <div className="arr-tiles__run" role="group" aria-label="Match size">
          {MATCH.map(({ dim, label, icon }) => {
            const plan = planMatchSize(unitSet.units, dim, keyKey);
            const what = keyKey ? 'the key object' : 'the largest';
            return (
              <button
                key={dim}
                type="button"
                className="ctx-shape-btn arr-tile"
                aria-label={`${label} of ${what}`}
                data-tooltip={planHint(plan, `${label} of ${what}`, 'Already the same size')}
                disabled={!isPlan(plan)}
                onClick={() => {
                  arrangeGhost.set(null);
                  if (isPlan(plan)) commitPatches(plan.patches);
                }}
                {...ghostHandlers(plan)}
              >
                {icon}
              </button>
            );
          })}
        </div>
      </Row>

      <div className="arr-rule" aria-hidden="true" />
      <div className="rail-list arr-list">
        <button
          type="button"
          className="rail-list__item"
          disabled={!canFrameSelection(nodes)}
          onClick={() => {
            const id = frameSelection(nodes, useStore.getState().objects);
            close();
            if (id) editor.select(id);
          }}
        >
          <Frame size={15} />
          <span className="rail-list__label">Frame selection</span>
        </button>
      </div>
    </div>
  );
};

export interface SelectionControlProps {
  nodes: readonly AnyNode[];
  unitSet: UnitSet;
}

/** The count chip that leads a multiple selection's rail, and the summary behind it. */
export const SelectionControl: React.FC<SelectionControlProps> = ({ nodes, unitSet }) => (
  <RailPopover
    label="Selection"
    align="start"
    trigger={
      <span className="rail-kind">
        <Layers size={15} aria-hidden />
        <span className="rail-kind__name">{nodes.length}</span>
        <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
      </span>
    }
  >
    {(close) => <SelectionPanel nodes={nodes} unitSet={unitSet} close={close} />}
  </RailPopover>
);
