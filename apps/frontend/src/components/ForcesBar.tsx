import React from 'react';
import { Magnet, Radiation, Waves, Zap, ArrowDownToLine, RotateCcw, Check } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import {
  FORCE_IDS,
  FORCE_SPECS,
  MAX_FORCE_SCALE,
  MIN_FORCE_SCALE,
  type ForceId,
} from '../engine/physics/forces';

interface ForcesBarProps {
  activeForce: ForceId;
  onPickForce: (id: ForceId) => void;
  /** Leave force behind and go back to ordinary editing. */
  onExit: () => void;
}

const ICONS: Record<ForceId, React.ReactNode> = {
  magnet: <Magnet size={15} />,
  repel: <Radiation size={15} />,
  gravity: <ArrowDownToLine size={15} />,
  wind: <Waves size={15} />,
  shockwave: <Zap size={15} />,
};

/**
 * The Forces mode bar.
 *
 * Force used to be two disconnected controls: a "Physics" switch in the header
 * and a flyout of magic tools in the dock that was greyed out until you found
 * that switch. Nothing showed what a tool would affect, nothing let you soften
 * it, and nothing offered a way back once a shockwave had rearranged the board.
 *
 * This is the whole mode in one place: what force is selected, how hard it
 * pushes, what it will do when you press, and — the part that makes any of it
 * safe to try — a way to put the layout back exactly as it was.
 */
export const ForcesBar: React.FC<ForcesBarProps> = ({ activeForce, onPickForce, onExit }) => {
  const forceScale = useStore(state => state.forceScale);
  const setForceScale = useStore(state => state.setForceScale);
  const layoutSnapshot = useStore(state => state.layoutSnapshot);
  // Recomputed per render off `version`, so the count tracks the canvas as
  // objects settle rather than going stale after the first throw.
  useStore(state => state.version);
  const driftCount = useStore.getState().layoutDriftCount();

  const spec = FORCE_SPECS[activeForce];

  return (
    <div
      className="panel-surface"
      role="group"
      aria-label="Forces"
      style={{
        position: 'absolute',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) var(--space-5) var(--space-3)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-float)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        width: 560,
        animation: 'popIn 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
            fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)' as any,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            color: spec.colorToken, flexShrink: 0,
          }}
        >
          Forces
        </span>
        {/* The hint is the instruction, so there is never a mystery about what
            pressing will do. */}
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {spec.hint}
        </span>

        <button
          onClick={onExit}
          title="Back to editing (Esc)"
          aria-label="Back to editing"
          style={{
            marginLeft: 'auto', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
            background: 'var(--text-primary)', color: 'var(--surface-primary)',
            border: 'none', borderRadius: 'var(--radius-md)',
            padding: '6px 12px', fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)' as any, cursor: 'pointer',
            transition: 'var(--motion-hover)',
          }}
        >
          <Check size={14} /> Done
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Force picker */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface-secondary)', padding: 3, borderRadius: 'var(--radius-lg)', flexShrink: 0 }}>
          {FORCE_IDS.map(id => {
            const isActive = id === activeForce;
            return (
              <button
                key={id}
                onClick={() => onPickForce(id)}
                aria-pressed={isActive}
                title={FORCE_SPECS[id].hint}
                aria-label={FORCE_SPECS[id].label}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                  padding: '5px 10px', border: 'none', cursor: 'pointer',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: (isActive ? 'var(--weight-semibold)' : 'var(--weight-medium)') as any,
                  background: isActive ? 'var(--surface-primary)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                  transition: 'var(--motion-hover)',
                }}
              >
                {ICONS[id]} {FORCE_SPECS[id].label}
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>Strength</span>
          <input
            type="range"
            min={MIN_FORCE_SCALE}
            max={MAX_FORCE_SCALE}
            step={0.05}
            value={forceScale}
            onChange={e => setForceScale(Number(e.target.value))}
            aria-label="Force strength"
            style={{ flex: 1, minWidth: 60, accentColor: spec.colorToken, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', width: 32, textAlign: 'right' }}>
            {forceScale.toFixed(2)}×
          </span>
        </label>
      </div>

      {/* The way back. Only offered once something has actually moved, so it is
          never a button that does nothing. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 24 }}>
        {layoutSnapshot && driftCount > 0 ? (
          <>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {driftCount} {driftCount === 1 ? 'object has' : 'objects have'} moved
            </span>
            <button
              onClick={() => useStore.getState().restoreLayout()}
              title="Put every object back where it was before you started"
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                background: 'var(--surface-hover)', border: 'none',
                color: 'var(--text-primary)', borderRadius: 'var(--radius-md)',
                padding: '4px 10px', fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-medium)' as any, cursor: 'pointer',
                transition: 'var(--motion-hover)',
              }}
            >
              <RotateCcw size={12} /> Restore layout
            </button>
          </>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Your layout is saved — you can always put it back.
          </span>
        )}
      </div>
    </div>
  );
};
