import React from 'react';
import { Square } from 'lucide-react';

interface Props {
  elapsedMs: number;
  level: number;
  levels: number[];
  onStop: () => void;
}

const formatElapsed = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

/**
 * Live recording HUD.
 *
 * The AudioTool always captured real waveform data, but nothing ever rendered it —
 * `setOverlayState({ type: 'audio-recording' })` was called and then dropped on the
 * floor, so recording had zero visual feedback: no timer, no meter, no stop control.
 * Users had no way to tell recording had started, was still running, or how to end it.
 */
export const AudioRecordingHUD: React.FC<Props> = ({ elapsedMs, levels, onStop }) => {
  const bars = levels.length ? levels : Array(24).fill(0.05);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        pointerEvents: 'auto',
      }}
    >
      <div
        className="panel-surface"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 16px',
          borderRadius: 999,
          boxShadow: 'var(--shadow-float)',
          animation: 'popIn 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        {/* Pulsing record dot */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#EF4444',
              animation: 'recPulse 1.2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 38,
            }}
          >
            {formatElapsed(elapsedMs)}
          </span>
        </span>

        {/* Live level meter — real input, not a decorative animation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28 }}>
          {bars.map((v, i) => (
            <span
              key={i}
              style={{
                width: 3,
                borderRadius: 2,
                background: 'var(--text-primary)',
                opacity: 0.25 + Math.min(v * 2, 1) * 0.75,
                height: `${Math.max(3, Math.min(v * 2.2, 1) * 28)}px`,
                transition: 'height 60ms linear',
              }}
            />
          ))}
        </div>

        <button
          onClick={onStop}
          title="Stop recording and place the voice note"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--text-primary)',
            color: 'var(--surface-primary)',
            border: 'none',
            borderRadius: 999,
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'var(--motion-hover)',
          }}
        >
          <Square size={11} fill="currentColor" /> Stop
        </button>
      </div>
    </div>
  );
};
