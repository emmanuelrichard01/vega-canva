import React from 'react';
import {
  Magnet, Radiation, Waves, Zap, ArrowDownToLine, Tornado,
  RotateCcw, Check, Snowflake, Target, Hand, ChevronDown, ChevronUp,
  ArrowUp, ArrowUpRight, ArrowRight, ArrowDownRight, ArrowDown, ArrowDownLeft, ArrowLeft, ArrowUpLeft,
} from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { Slider } from './ui/Slider';
import { Switch } from './ui/Switch';
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
import { GRAVITY_ANGLES, physicsRuntime, physicsSettings, usePhysicsSettings } from '../engine/physics/settings';
import { storageGet, storageSet } from '../utils/safeStorage';
import './physics/physics.css';

interface ForcesBarProps {
  activeForce: ForceId;
  onPickForce: (id: ForceId) => void;
  /** Leave the mode. Everything is settled and committed as one undo step. */
  onExit: () => void;
  /** Freeze everything where it is, keeping the arrangement and the mode. */
  onCalm?: () => void;
  /** How many objects are selected. Selection is Room state, not store state. */
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

/** Compass directions for Gravity, keyed by angle (0 is right, 90 is down). */
const COMPASS: Record<number, { icon: React.ReactNode; label: string }> = {
  270: { icon: <ArrowUp size={14} />, label: 'Up' },
  315: { icon: <ArrowUpRight size={14} />, label: 'Up and right' },
  0: { icon: <ArrowRight size={14} />, label: 'Right' },
  45: { icon: <ArrowDownRight size={14} />, label: 'Down and right' },
  90: { icon: <ArrowDown size={14} />, label: 'Down' },
  135: { icon: <ArrowDownLeft size={14} />, label: 'Down and left' },
  180: { icon: <ArrowLeft size={14} />, label: 'Left' },
  225: { icon: <ArrowUpLeft size={14} />, label: 'Up and left' },
};

/** The falloff profile: full strength at the cursor (left) fading toward the rim (right). */
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
 * The physics HUD.
 *
 * A floating instrument shown for as long as a force is armed. It answers four
 * questions in order: which force, how hard and how far, what it may touch,
 * and how to get out. The footer always says that physics is on and what a
 * press will do, and carries the three ways out: Freeze keeps the arrangement
 * and the mode, Reset sends everything back, Done settles and leaves.
 *
 * Escape freezes first when anything is moving or a field is running, and
 * leaves the mode on the next press.
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
  // Re-read per document version so the moved count tracks what has settled.
  useStore(state => state.version);
  const driftCount = useStore.getState().layoutDriftCount();

  const forceLatch = useStore(state => state.forceLatch);
  const setForceLatch = useStore(state => state.setForceLatch);
  const latchSeconds = useStore(state => state.forceLatchSeconds);
  const setLatchSeconds = useStore(state => state.setForceLatchSeconds);
  const { gravityAngle, includeFrames } = usePhysicsSettings();

  const spec = FORCE_SPECS[activeForce];
  const canScope = selectedCount > 0;
  const latchable = canLatch(activeForce);

  const [collapsed, setCollapsed] = React.useState(() => storageGet('vega_forces_collapsed') === '1');
  const setCollapsedPref = (val: boolean) => {
    storageSet('vega_forces_collapsed', val ? '1' : '0');
    setCollapsed(val);
  };

  const [tuning, setTuning] = React.useState(() => storageGet('vega_forces_tuning') === '1');
  const toggleTuning = () => {
    setTuning((open) => {
      storageSet('vega_forces_tuning', open ? '0' : '1');
      return !open;
    });
  };

  const calm = React.useCallback(() => onCalm?.(), [onCalm]);

  // Escape freezes when something is moving or a field is running. Registered
  // in the capture phase so it runs before the room's own Escape handling,
  // which would otherwise leave the mode on the same press.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (physicsRuntime.moving === 0 && !physicsRuntime.latched) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      calm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [calm]);

  const reset = () => {
    // Stop what is moving first, so nothing lands after the layout returns.
    calm();
    useStore.getState().restoreLayout();
  };

  const status =
    layoutSnapshot && driftCount > 0
      ? `${driftCount} ${driftCount === 1 ? 'object' : 'objects'} moved`
      : forceLatch && latchable
        ? `Click to ${spec.short} for ${latchSeconds}s`
        : spec.continuous
          ? `Hold to ${spec.short}`
          : `Click to ${spec.short}`;

  if (collapsed) {
    return (
      <button
        type="button"
        className="panel-surface forces-handle"
        style={{ ['--force-accent' as string]: spec.colorToken }}
        onClick={() => setCollapsedPref(false)}
        data-tooltip="Show the physics controls. Escape freezes, then leaves"
        aria-label={`Physics on, ${spec.label}. Show the controls`}
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
      aria-label="Physics"
      style={{ ['--force-accent' as string]: spec.colorToken }}
    >
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

      <div className="forces__dials">
        <div className="forces__dial">
          <Slider
            label="Strength" hint="How hard the force pushes"
            value={forceScale} min={MIN_FORCE_SCALE} max={MAX_FORCE_SCALE} step={0.05}
            format={(v) => `${v.toFixed(2)}×`} accent="var(--force-accent)"
            onChange={setForceScale}
          />
        </div>
        <div className="forces__dial">
          <Slider
            label="Area" hint="How far the field reaches. The ring on the canvas is exactly this size"
            value={forceRadiusScale}
            min={MIN_FORCE_RADIUS_SCALE} max={MAX_FORCE_RADIUS_SCALE} step={0.05}
            format={(v) => `${Math.round(spec.radius * v)}px`}
            accent="var(--force-accent)"
            onChange={setForceRadiusScale}
          />
        </div>
      </div>

      {activeForce === 'gravity' && (
        <div className="forces__row forces__row--press">
          <span className="forces__row-label">Direction</span>
          <div className="forces__compass" role="radiogroup" aria-label="Gravity direction">
            {GRAVITY_ANGLES.map(angle => (
              <button
                key={angle}
                type="button"
                role="radio"
                aria-checked={gravityAngle === angle}
                aria-label={COMPASS[angle].label}
                className={`forces__compass-btn ${gravityAngle === angle ? 'is-active' : ''}`}
                onClick={() => physicsSettings.setGravityAngle(angle)}
                data-tooltip={COMPASS[angle].label}
              >
                {COMPASS[angle].icon}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeForce === 'wind' && (
        <div className="forces__row forces__row--press">
          <span className="forces__note">Wind blows the way you drag. Hold and sweep across the objects.</span>
        </div>
      )}

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
            type="button" role="radio"
            aria-checked={selectionOnly && canScope}
            className={`forces__segment ${selectionOnly && canScope ? 'is-active' : ''}`}
            onClick={() => setSelectionOnly(true)}
            disabled={!canScope}
            data-tooltip={
              canScope
                ? `Only the ${selectedCount} you selected move, straight through everything else`
                : 'Select some objects first to aim force at just those'
            }
          >
            <Target size={12} aria-hidden="true" />
            {canScope ? `Just my ${selectedCount} selected` : 'Just my selection'}
          </button>
        </div>
      </div>

      <div className="forces__row forces__row--press">
        <span className="forces__row-label">A press</span>
        <div className="forces__segmented" role="radiogroup" aria-label="What a press does">
          <button
            type="button" role="radio" aria-checked={!forceLatch || !latchable}
            className={`forces__segment ${!forceLatch || !latchable ? 'is-active' : ''}`}
            onClick={() => setForceLatch(false)}
            data-tooltip="The force applies while you hold the pointer down, and you aim it as you go"
          >
            <Hand size={13} aria-hidden="true" /> lasts while held
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

      {tuning && (
        <>
          <div className="forces__row">
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
          <div className="forces__row">
            <Switch
              checked={includeFrames}
              onChange={(on) => physicsSettings.setIncludeFrames(on)}
              label="Include objects inside frames"
            />
          </div>
        </>
      )}

      <div className="forces__footer">
        <span className="forces__live" role="status">
          <span className="forces__live-name">
            <span className="forces__live-dot" aria-hidden="true" />
            Physics on
          </span>
          <span className="forces__live-hint">{status}</span>
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

        <button
          type="button"
          className="forces__action"
          onClick={calm}
          data-tooltip="Stop everything moving and keep it exactly where it is now (Esc)"
        >
          <Snowflake size={12} aria-hidden="true" /> Freeze <kbd className="forces__kbd">Esc</kbd>
        </button>

        <button
          type="button"
          className="forces__action"
          onClick={reset}
          disabled={!layoutSnapshot || driftCount === 0}
          data-tooltip={
            layoutSnapshot && driftCount > 0
              ? 'Send every object back to where it was before you armed a force'
              : 'Nothing has moved yet'
          }
        >
          <RotateCcw size={12} aria-hidden="true" /> Reset
        </button>

        <button
          type="button"
          className="forces__action forces__action--icon"
          onClick={() => setCollapsedPref(true)}
          data-tooltip="Hide these controls and keep physics on"
          aria-label="Hide the physics controls"
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="forces__done"
          onClick={onExit}
          data-tooltip="Settle everything and go back to editing. One undo puts it all back"
          aria-label="Done. Settle everything and go back to editing"
        >
          <Check size={14} aria-hidden="true" /> Done
        </button>
      </div>
    </div>
  );
};
