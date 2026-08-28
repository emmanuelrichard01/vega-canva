import React from 'react';
import {
  Magnet, Radiation, Waves, Zap, ArrowDownToLine, Tornado,
  RotateCcw, Check, Snowflake, Target, Hand, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { Slider } from './ui/Slider';
import {
  FALLOFF_IDS,
  FALLOFF_SPECS,
  FORCE_IDS,
  FORCE_SPECS,
  LATCH_SECONDS,
  canLatch,
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

/**
 * A labelled slider with its value, used for both continuous controls.
 *
 * ## Why this is now a wrapper rather than an implementation
 *
 * It was a bare `input[type="range"]` with an inline `accentColor` — which is
 * precisely what `ui/Slider` was built to replace, and its docstring says so:
 * "the three ranges already in this codebase are bare `input[type=range]`
 * elements with inline styles, so they inherit each browser's default track
 * and thumb — which do not follow the theme, do not follow the focus ring, and
 * do not look like each other across platforms."
 *
 * Only the properties panel had adopted it, so the forces panel was one of the
 * ranges that comment was describing. These two dials sit in the app's most
 * deliberately-designed surface and were rendering with Chrome's stock thumb.
 *
 * The primitive gained a `format`, an `accent` and a `hint` to take them, which
 * is a smaller change than keeping a second slider alive — and it brings
 * double-click-to-reset and a real focus ring with it.
 *
 * The hint also stops being a `title`. Everywhere else in this app a hint is
 * `data-tooltip`, drawn by `TooltipLayer`; `title` is the browser's own, with a
 * second of delay, no styling and no theme. Two of the four controls on this
 * panel explained themselves through a different, worse mechanism than the
 * other two.
 */
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
  <div className="forces__dial">
    <Slider
      label={label}
      hint={hint}
      value={value}
      min={min}
      max={max}
      step={step}
      format={format}
      accent={accent}
      onChange={onChange}
    />
  </div>
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

  const forceLatch = useStore(state => state.forceLatch);
  const setForceLatch = useStore(state => state.setForceLatch);
  const latchSeconds = useStore(state => state.forceLatchSeconds);
  const setLatchSeconds = useStore(state => state.setForceLatchSeconds);

  const spec = FORCE_SPECS[activeForce];
  const canScope = selectedCount > 0;
  const latchable = canLatch(activeForce);

  /**
   * Tuning is folded away by default.
   *
   * The bar had grown to five stacked rows — picker, two dials, press mode,
   * falloff and scope, then a footer — which is over five hundred pixels of
   * panel sitting on top of the board you are trying to watch. On the one
   * screen whose whole point is seeing what happens, the instrument was
   * taking more room than the experiment.
   *
   * Strength and Area are the two anyone actually reaches for, so they stay.
   * Falloff and Selection are set once and rarely revisited, so they fold —
   * and the fold is remembered, because someone who opens it is someone who
   * uses it.
   */
  /**
   * Out of the way entirely.
   *
   * Once a force is chosen and tuned, the panel has nothing left to say — and
   * it is sitting on the board you armed the force to watch. Folding rows
   * helped; the honest end of that thought is that the instrument should be
   * dismissable, leaving only enough of itself to come back from.
   *
   * Remembered, because someone who works this way works this way every time.
   */
  const [collapsed, setCollapsed] = React.useState(
    () => window.localStorage.getItem('vega_forces_collapsed') === '1'
  );
  const setCollapsedPref = (val: boolean) => {
    window.localStorage.setItem('vega_forces_collapsed', val ? '1' : '0');
    setCollapsed(val);
  };

  const [tuning, setTuning] = React.useState(
    () => window.localStorage.getItem('vega_forces_tuning') === '1'
  );
  const toggleTuning = () => {
    setTuning((open) => {
      window.localStorage.setItem('vega_forces_tuning', open ? '0' : '1');
      return !open;
    });
  };

  /**
   * Collapsed: a single handle naming what is armed.
   *
   * Not a bare chevron. The one thing you cannot see once the panel is gone
   * is *which* force is in your hand, and that is exactly what a press is
   * about to do — so the handle is the answer to that question, and reopening
   * is the side effect. Escape still leaves the mode entirely, so the handle
   * never becomes the only way out.
   */
  if (collapsed) {
    return (
      <button
        type="button"
        className="panel-surface forces-handle"
        style={{ ['--force-accent' as string]: spec.colorToken }}
        onClick={() => setCollapsedPref(false)}
        data-tooltip="Show the force controls. Escape leaves the mode"
        aria-label={`${spec.label} armed. Show the force controls`}
      >
        <span className="forces-handle__dot" aria-hidden="true" />
        {spec.label}
        <ChevronUp size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className="panel-surface forces"
      role="group"
      aria-label="Forces"
      style={{ ['--force-accent' as string]: spec.colorToken }}
    >
      {/* The whole header is gone.

          It carried an uppercase "FORCES" kicker over a panel whose first row
          is six buttons named Pull, Push and Drop — labelling the obvious, on
          the one screen whose point is watching the board rather than reading
          the instrument. It also cost a row of its own, and the panel was
          275px tall on a 900px screen.

          The instruction it held has moved to the foot, where it shares a line
          with the ways out, and Done went with it. */}

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
              aria-label={`${FORCE_SPECS[id].label}. ${FORCE_SPECS[id].hint}`}
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
          label="Area" hint="How far the field reaches. The ring on the canvas is exactly this size"
          value={forceRadiusScale}
          min={MIN_FORCE_RADIUS_SCALE} max={MAX_FORCE_RADIUS_SCALE} step={0.05}
          // Shown in world pixels rather than as a multiplier: the ring is
          // right there on the canvas, and a radius is a distance, not a ratio.
          format={(v) => `${Math.round(spec.radius * v)}px`}
          accent="var(--force-accent)"
          onChange={setForceRadiusScale}
        />
      </div>

      {/* Scope, phrased as the question it answers.

          It was a lone toggle labelled "Selection", pressed in or not — which
          says what it is *about* but never what either state means, so the
          only way to learn that force normally hits everything was to press
          it and compare.

          Still offered when nothing is selected, and disabled with a reason
          rather than hidden: a control that vanishes is indistinguishable
          from one that is broken. */}
      <div className="forces__row forces__row--press">
        <span className="forces__row-label">Affects</span>
        <div className="forces__segmented" role="radiogroup" aria-label="What the force affects">
          <button
            type="button" role="radio" aria-checked={!selectionOnly || !canScope}
            className={`forces__segment ${!selectionOnly || !canScope ? 'is-active' : ''}`}
            onClick={() => setSelectionOnly(false)}
            data-tooltip="Every object the ring touches"
          >
            Everything
          </button>
          <button
            type="button" role="radio" aria-checked={selectionOnly && canScope}
            className={`forces__segment ${selectionOnly && canScope ? 'is-active' : ''}`}
            onClick={() => setSelectionOnly(true)}
            disabled={!canScope}
            data-tooltip={
              canScope
                ? `Only the ${selectedCount} you selected move, straight through everything else, which stays exactly where it is`
                : 'Select some objects first, then force can be aimed at just those'
            }
          >
            <Target size={12} />
            {canScope ? `Just my ${selectedCount} selected` : 'Just my selection'}
          </button>
        </div>
      </div>

      {/* One row, four answers, and the duration *is* the label.

          This was two controls: a Hold/Latch switch, and — only once Latch was
          chosen — a separate 3/6/10 duration. Two steps to express one choice,
          and "Latch" is a word for a mechanism rather than for anything you
          wanted to do. Picking a number now *is* latching, so the row reads
          as a sentence with four endings and needs no explaining. */}
      <div className="forces__row forces__row--press">
        <span className="forces__row-label">A press</span>
        <div className="forces__segmented" role="radiogroup" aria-label="What a press does">
          <button
            type="button" role="radio" aria-checked={!forceLatch || !latchable}
            className={`forces__segment ${!forceLatch || !latchable ? 'is-active' : ''}`}
            onClick={() => setForceLatch(false)}
            data-tooltip="The force applies while you hold the pointer down, and you aim it as you go"
          >
            <Hand size={13} /> lasts while held
          </button>
          {LATCH_SECONDS.map(sec => (
            <button
              key={sec}
              type="button" role="radio"
              aria-checked={forceLatch && latchable && latchSeconds === sec}
              className={`forces__segment ${forceLatch && latchable && latchSeconds === sec ? 'is-active' : ''}`}
              onClick={() => { setForceLatch(true); setLatchSeconds(sec); }}
              disabled={!latchable}
              data-tooltip={
                latchable
                  ? `Click once and let go. The field keeps running for ${sec} seconds, and Escape stops it`
                  : 'Shockwave is a single burst, so there is nothing to leave running'
              }
            >
              runs {sec}s
            </button>
          ))}
        </div>
      </div>

      <div className="forces__row" hidden={!tuning}>
        <span className="forces__row-label">Edge</span>
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
              aria-label={`${FALLOFF_SPECS[id].label}. ${FALLOFF_SPECS[id].hint}`}
            >
              <FalloffIcon id={id} />
              {FALLOFF_SPECS[id].label}
            </button>
          ))}
        </div>

      </div>

      {/* The ways back. */}
      <div className="forces__footer">
        {/* One text slot, not two.

            The header said what a press would do and the footer said the
            layout was safe — both true, both permanent, and between them a
            whole row of the panel. They are never equally interesting at the
            same moment: before anything has moved the only useful sentence is
            what pressing does, and once things *have* moved the only useful
            one is how many and that you can undo it. So the slot says
            whichever is currently true. */}
        <span className="forces__status">
          {layoutSnapshot && driftCount > 0
            ? `${driftCount} ${driftCount === 1 ? 'object' : 'objects'} moved`
            : forceLatch && latchable
              ? `Click to ${spec.short} for ${latchSeconds}s`
              : spec.continuous
                ? `Hold to ${spec.short}`
                : `Click to ${spec.short}`}
        </span>

        <button
          type="button"
          className="forces__more"
          aria-expanded={tuning}
          onClick={toggleTuning}
        >
          <ChevronDown size={13} className={tuning ? 'is-open' : ''} aria-hidden="true" />
          {tuning ? 'Less' : 'More'}
        </button>

        {onCalm && (
          <button
            type="button"
            className="forces__action"
            onClick={onCalm}
            data-tooltip="Stop everything moving, and keep it exactly where it is now"
          >
            <Snowflake size={12} /> Freeze
          </button>
        )}

        <button
          type="button"
          className="forces__action"
          onClick={() => useStore.getState().restoreLayout()}
          disabled={!layoutSnapshot || driftCount === 0}
          data-tooltip="Send every object back to where it was before you armed a force"
        >
          <RotateCcw size={12} /> Put back
        </button>

        <button
          type="button"
          className="forces__action"
          onClick={() => setCollapsedPref(true)}
          data-tooltip="Hide these controls and keep the force armed"
          aria-label="Hide the force controls"
        >
          <ChevronDown size={12} /> Hide
        </button>

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
    </div>
  );
};
