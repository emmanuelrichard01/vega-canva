import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowRightLeft,
  MoveHorizontal,
  MoveVertical,
} from 'lucide-react';
import { RailPopover } from './RailPopover';
import { NumberStepper } from '../ui/NumberStepper';
import { SegmentedControl } from '../ui/SegmentedControl';
import { PairRow, Row } from '../panel/grammar';
import type { AlignEdge, DistributeAxis } from '../../engine/model/align';
import type { AnyNode } from '../../engine/model/schema';
import type { UnitSet } from '../../engine/arrange/units';
import {
  currentSpacing,
  defaultKey,
  isPlan,
  planAlign,
  planDistribute,
  planSpacing,
  sharedFrame,
  type AlignTarget,
  type Plan,
} from '../../engine/arrange/plans';
import { alignKey, arrangeGhost, setAlignKey } from '../../engine/arrange/preview';
import { clearShown, commitPatches, showPatches } from '../../engine/arrange/livePreview';
import { ghostHandlers, planHint } from '../arrange/ghost';
import '../arrange/arrange.css';

/**
 * Align and distribute, from one panel on the rail.
 *
 * Illustrator's Align panel, in Figma's glyphs:
 *
 * - **Align to** the selection, a key object, or the frame they sit in. The
 *   key is the one the rest move to and it holds still; with the panel open
 *   it wears a ring on the board and any other selected object can be clicked
 *   to take over. The frame is the one every object shares.
 * - **Six edges**, each drawing where things would land while it is pointed at.
 * - **Distribute** evens the gaps between the outermost two, or sets one exact
 *   gap along either axis, typed or scrubbed, live on the board and one undo
 *   step when it lands. A spacing that differs reads Mixed.
 *
 * A group is one object here (see `arrange/units`), and every control that
 * cannot act says why on hover rather than doing nothing.
 */

const EDGES: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: 'left', label: 'Align left', icon: <AlignStartVertical size={16} /> },
  { edge: 'centerX', label: 'Align horizontal centres', icon: <AlignCenterVertical size={16} /> },
  { edge: 'right', label: 'Align right', icon: <AlignEndVertical size={16} /> },
  { edge: 'top', label: 'Align top', icon: <AlignStartHorizontal size={16} /> },
  { edge: 'middleY', label: 'Align vertical centres', icon: <AlignCenterHorizontal size={16} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={16} /> },
];

const TARGETS = [
  { value: 'selection', label: 'Selection', hint: 'Line them up with each other' },
  { value: 'key', label: 'Key object', hint: 'Line them up with one of them, which stays put' },
  { value: 'frame', label: 'Frame', hint: 'Line them up with the frame they are in' },
];

const useAlignKey = () => useSyncExternalStore(alignKey.subscribe, alignKey.get, alignKey.get);

/** Press: write the plan as one undo step and drop its preview. */
const apply = (plan: Plan) => {
  arrangeGhost.set(null);
  if (isPlan(plan)) commitPatches(plan.patches);
};

const Tile: React.FC<{ label: string; plan: Plan; done: string; children: React.ReactNode }> = ({ label, plan, done, children }) => (
  <button
    type="button"
    className="ctx-shape-btn arr-tile"
    aria-label={label}
    data-tooltip={planHint(plan, label, done)}
    disabled={!isPlan(plan)}
    onClick={() => apply(plan)}
    {...ghostHandlers(plan)}
  >
    {children}
  </button>
);

/** One axis of exact spacing: shows the shared gap, takes a new one live. */
const SpacingField: React.FC<{
  axis: DistributeAxis;
  units: UnitSet['units'];
  anchor: string | null;
}> = ({ axis, units, anchor }) => {
  const gap = currentSpacing(units, axis);
  const plan = (value: number) => planSpacing(units, axis, value, anchor);
  const label = axis === 'horizontal' ? 'Horizontal spacing' : 'Vertical spacing';
  const disabled = units.length < 2 ? 'Needs two or more objects.' : undefined;
  return (
    <NumberStepper
      aria-label={label}
      glyph={axis === 'horizontal' ? <MoveHorizontal size={13} /> : <MoveVertical size={13} />}
      value={gap ?? 0}
      mixed={gap === null}
      step={1}
      precision={1}
      disabledReason={disabled}
      onScrubStart={() => arrangeGhost.set(null)}
      onPreview={(value) => {
        const p = plan(value);
        if (isPlan(p)) showPatches(p.patches);
      }}
      onScrubEnd={(cancelled) => {
        if (cancelled) clearShown();
      }}
      onChange={(value) => {
        const p = plan(value);
        if (isPlan(p)) commitPatches(p.patches);
        else clearShown();
      }}
    />
  );
};

const AlignPanel: React.FC<{ unitSet: UnitSet; objects: Readonly<Record<string, AnyNode>> }> = ({ unitSet, objects }) => {
  const { units, locked } = unitSet;
  const state = useAlignKey();
  const target = state.target;
  const keyKey = units.some((u) => u.key === state.key) ? state.key : defaultKey(units);
  const frame = useMemo(() => sharedFrame(units, objects), [units, objects]);

  // While the panel is open and a key is wanted, the board offers every unit to click.
  useEffect(() => {
    setAlignKey({ picking: target === 'key' ? units.map((u) => ({ key: u.key, box: u.box })) : null });
  }, [target, units]);
  useEffect(
    () => () => {
      setAlignKey({ picking: null });
      arrangeGhost.set(null);
      clearShown();
    },
    []
  );
  useEffect(() => {
    if (state.key !== keyKey) setAlignKey({ key: keyKey });
  }, [state.key, keyKey]);

  const ctx = { units, target, keyKey, frame };
  const anchor = target === 'key' ? keyKey : null;

  return (
    <div className="arr-panel">
      <Row label="Align to" stack>
        <SegmentedControl
          ariaLabel="Align to"
          fill
          value={target}
          onChange={(v) => setAlignKey({ target: v as AlignTarget })}
          segments={TARGETS}
        />
      </Row>
      <div className="arr-tiles" role="group" aria-label="Align">
        <div className="arr-tiles__run">
          {EDGES.slice(0, 3).map(({ edge, label, icon }) => (
            <Tile key={edge} label={label} plan={planAlign(ctx, edge)} done="Already lined up">
              {icon}
            </Tile>
          ))}
        </div>
        <div className="arr-tiles__run">
          {EDGES.slice(3).map(({ edge, label, icon }) => (
            <Tile key={edge} label={label} plan={planAlign(ctx, edge)} done="Already lined up">
              {icon}
            </Tile>
          ))}
        </div>
      </div>
      {target === 'key' && units.length > 1 && (
        <div className="arr-keyline">
          <p className="ctx-popover__note arr-note">Click another selected object on the board to make it the key.</p>
          <button
            type="button"
            className="ctx-btn arr-same"
            aria-label="Make the next object the key"
            data-tooltip="Next key"
            onClick={() => {
              const at = units.findIndex((u) => u.key === keyKey);
              setAlignKey({ key: units[(at + 1) % units.length].key });
            }}
          >
            <ArrowRightLeft size={14} />
          </button>
        </div>
      )}
      <div className="arr-rule" aria-hidden="true" />
      <Row label="Distribute">
        <div className="arr-tiles__run">
          <Tile label="Even horizontal gaps" plan={planDistribute(units, 'horizontal')} done="Gaps are already even">
            <AlignHorizontalSpaceBetween size={16} />
          </Tile>
          <Tile label="Even vertical gaps" plan={planDistribute(units, 'vertical')} done="Gaps are already even">
            <AlignVerticalSpaceBetween size={16} />
          </Tile>
        </div>
      </Row>
      <Row label="Spacing" hint="One exact gap between them, typed or dragged">
        <PairRow>
          <SpacingField axis="horizontal" units={units} anchor={anchor} />
          <SpacingField axis="vertical" units={units} anchor={anchor} />
        </PairRow>
      </Row>
      {locked > 0 && (
        <p className="ctx-popover__note arr-note">
          {locked === 1 ? 'One locked object stays where it is.' : `${locked} locked objects stay where they are.`}
        </p>
      )}
    </div>
  );
};

export interface AlignControlProps {
  unitSet: UnitSet;
  objects: Readonly<Record<string, AnyNode>>;
}

/** The rail's Align and distribute trigger and its panel, planned only while open. */
export const AlignControl: React.FC<AlignControlProps> = ({ unitSet, objects }) => (
  <RailPopover label="Align and distribute" trigger={<AlignStartVertical size={16} />} align="start" live>
    <AlignPanel unitSet={unitSet} objects={objects} />
  </RailPopover>
);
