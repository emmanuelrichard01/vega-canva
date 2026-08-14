import React from 'react';
import {
  Magnet, Radiation, Waves, Zap, ArrowDownToLine, Tornado,
  RotateCcw, Check, Snowflake, Target, Sparkles,
} from 'lucide-react';
import { useStore } from '../hooks/useStore';
import {
  FALLOFF_IDS,
  FALLOFF_SPECS,
  FORCE_IDS,
  FORCE_SPECS,
  MAX_FORCE_RADIUS_SCALE,
  MAX_FORCE_SCALE,
  MIN_FORCE_RADIUS_SCALE,
  MIN_FORCE_SCALE,
  type FalloffId,
  type ForceId,
} from '../engine/physics/forces';

interface ForcesBarProps {
  activeForce: ForceId;
  onPickForce: (id: ForceId) => void;
  /** Leave force behind and go back to ordinary editing. */
  onExit: () => void;
  /** Stop everything where it is, keeping the arrangement. */
  onCalm?: () => void;
  /**
   * How many objects are selected.
   *
   * Passed in rather than read from the store because selection is React state
   * owned by `Room`, not store state — the panel would otherwise be reading a
   * field that does not exist.
   */
  selectedCount: number;
}

const ICONS: Record<ForceId, React.ReactNode> = {
  magnet: <Magnet size={15} />,
  repel: <Radiation size={15} />,
  gravity: <ArrowDownToLine size={15} />,
  wind: <Waves size={15} />,
  swirl: <Tornado size={15} />,
  shockwave: <Zap size={15} />,
};

/**
 * A specimen of the falloff curve, not a symbol for it.
 *
 * The same call the stroke controls make: three words — "smooth", "linear",
 * "even" — describe three shapes, and the shapes are quicker to read than the
 * words. Drawn as the profile of the field: full strength at the left edge
 * (the cursor) decaying to nothing at the right (the rim).
 */
const FalloffIcon: React.FC<{ id: FalloffId }> = ({ id }) => {
  const d =
    id === 'constant' ? 'M 1 3 L 15 3 L 15 11'
    : id === 'linear' ? 'M 1 3 L 15 11'
    : 'M 1 3 C 6 3, 10 11, 15 11';
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
};

/** A labelled slider with its value, used for both continuous controls. */
const Dial: React.FC<{
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  accent: string;
  onChange: (v: number) => void;
}> = ({ label, hint, value, min, max, step, format, accent, onChange }) => (
  <label className="forces__dial" title={hint}>
    <span className="forces__dial-label">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={`${label} — ${hint}`}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ accentColor: accent }}
    />
    <span className="forces__dial-value">{format(value)}</span>
  </label>
);

/**
 * The Forces mode panel.
 *
 * ## What this is for
 *
 * Force used to be two disconnected controls: a "Physics" switch in the header
 * and a flyout of magic tools in the dock that was greyed out until you found
 * that switch. Nothing showed what a tool would affect, nothing let you soften
 * it, and nothing offered a way back once a shockwave had rearranged the board.
 *
 * ## Why it now has four controls instead of one
 *
 * The first version had a Strength slider and nothing else, which meant every
 * force was the same shape and the same size — you could only make that one
 * shape harder or softer. The three added here are the ones that change what
 * the tool *is*:
 *
 *  - **Area** decides whether a shockwave separates two overlapping notes or
 *    clears the whole board. It was fixed per force, so it decided that for you.
 *  - **Falloff** is how the force fades from the middle of the field to its rim,
 *    and it is the single biggest lever on how a force feels. It was hardwired
 *    to a straight line.
 *  - **Selection only** is what makes force usable on a board that already has
 *    work on it. Without it every force is all-or-nothing over everything in
 *    reach, so there is no way to tidy one cluster without disturbing the ones
 *    beside it.
 *
 * ## Why both Calm and Restore
 *
 * They are opposites and both are needed. Restore puts the layout back the way
 * it was before you started, which throws away the arrangement you just made.
 * Calm keeps the arrangement and takes only the motion out of it — for when a
 * throw has landed things well but they are still drifting past where you
 * wanted them.
 */
export const ForcesBar: React.FC<ForcesBarProps> = ({
  activeForce,
  onPickForce,
  onExit,
  onCalm,
  selectedCount,
}) => {
  const forceScale = useStore(state => state.forceScale);
  const setForceScale = useStore(state => state.setForceScale);
  const forceRadiusScale = useStore(state => state.forceRadiusScale);
  const setForceRadiusScale = useStore(state => state.setForceRadiusScale);
  const forceFalloff = useStore(state => state.forceFalloff);
  const setForceFalloff = useStore(state => state.setForceFalloff);
  const selectionOnly = useStore(state => state.forceSelectionOnly);
  const setSelectionOnly = useStore(state => state.setForceSelectionOnly);
  const layoutSnapshot = useStore(state => state.layoutSnapshot);
  // Recomputed per render off `version`, so the count tracks the canvas as
  // objects settle rather than going stale after the first throw.
  useStore(state => state.version);
  const driftCount = useStore.getState().layoutDriftCount();

  const spec = FORCE_SPECS[activeForce];
  const canScope = selectedCount > 0;

  return (
    <div
      className="panel-surface forces"
      role="group"
      aria-label="Forces"
      style={{ ['--force-accent' as string]: spec.colorToken }}
    >
      {/* What you are holding, and what it will do. The hint is the
          instruction, so there is never a mystery about what pressing does. */}
      <div className="forces__head">
        <span className="forces__eyebrow">
          <Sparkles size={12} aria-hidden="true" /> Forces
        </span>
        <span className="forces__hint">{spec.hint}</span>
        <button
          type="button"
          className="forces__done"
          onClick={onExit}
          data-tooltip="Back to editing (Esc)"
          aria-label="Back to editing"
        >
          <Check size={14} /> Done
        </button>
      </div>

      {/* Which force. Named as well as drawn, because five abstract glyphs in
          a row tell you nothing about which one pulls. */}
      <div className="forces__picker" role="radiogroup" aria-label="Force">
        {FORCE_IDS.map(id => {
          const isActive = id === activeForce;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`forces__force ${isActive ? 'is-active' : ''}`}
              onClick={() => onPickForce(id)}
              data-tooltip={FORCE_SPECS[id].hint}
              aria-label={`${FORCE_SPECS[id].label} — ${FORCE_SPECS[id].hint}`}
            >
              {ICONS[id]} {FORCE_SPECS[id].label}
            </button>
          );
        })}
      </div>

      {/* How it behaves. */}
      <div className="forces__dials">
        <Dial
          label="Strength" hint="How hard the force pushes"
          value={forceScale} min={MIN_FORCE_SCALE} max={MAX_FORCE_SCALE} step={0.05}
          format={(v) => `${v.toFixed(2)}×`} accent="var(--force-accent)"
          onChange={setForceScale}
        />
        <Dial
          label="Area" hint="How far the field reaches — the ring on the canvas is exactly this size"
          value={forceRadiusScale}
          min={MIN_FORCE_RADIUS_SCALE} max={MAX_FORCE_RADIUS_SCALE} step={0.05}
          // Shown in world pixels rather than as a multiplier: the ring is
          // right there on the canvas, and a radius is a distance, not a ratio.
          format={(v) => `${Math.round(spec.radius * v)}px`}
          accent="var(--force-accent)"
          onChange={setForceRadiusScale}
        />
      </div>

      <div className="forces__row">
        <span className="forces__row-label">Falloff</span>
        <div className="forces__segmented" role="radiogroup" aria-label="Falloff">
          {FALLOFF_IDS.map(id => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={forceFalloff === id}
              className={`forces__segment ${forceFalloff === id ? 'is-active' : ''}`}
              onClick={() => setForceFalloff(id)}
              data-tooltip={FALLOFF_SPECS[id].hint}
              aria-label={`${FALLOFF_SPECS[id].label} — ${FALLOFF_SPECS[id].hint}`}
            >
              <FalloffIcon id={id} />
              {FALLOFF_SPECS[id].label}
            </button>
          ))}
        </div>

        {/* Offered always and disabled with a reason when nothing is selected,
            rather than appearing and disappearing — a control that is missing
            is indistinguishable from one that is broken. */}
        <button
          type="button"
          className={`forces__scope ${selectionOnly && canScope ? 'is-active' : ''}`}
          onClick={() => setSelectionOnly(!selectionOnly)}
          disabled={!canScope}
          aria-pressed={selectionOnly && canScope}
          data-tooltip={
            canScope
              ? `Affect only the ${selectedCount} selected ${selectedCount === 1 ? 'object' : 'objects'}`
              : 'Select something first to limit force to it'
          }
        >
          <Target size={13} />
          {canScope ? `Selection (${selectedCount})` : 'Selection'}
        </button>
      </div>

      {/* The ways back. */}
      <div className="forces__footer">
        <span className="forces__status">
          {layoutSnapshot && driftCount > 0
            ? `${driftCount} ${driftCount === 1 ? 'object has' : 'objects have'} moved`
            : 'Your layout is saved — you can always put it back.'}
        </span>

        {onCalm && (
          <button
            type="button"
            className="forces__action"
            onClick={onCalm}
            data-tooltip="Stop everything where it is, keeping this arrangement"
          >
            <Snowflake size={12} /> Calm
          </button>
        )}

        <button
          type="button"
          className="forces__action"
          onClick={() => useStore.getState().restoreLayout()}
          disabled={!layoutSnapshot || driftCount === 0}
          data-tooltip="Put every object back where it was before you started"
        >
          <RotateCcw size={12} /> Restore
        </button>
      </div>
    </div>
  );
};
