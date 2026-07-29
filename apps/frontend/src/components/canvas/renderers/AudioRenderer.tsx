import React, { useEffect, useRef, useState } from 'react';
import { Html } from 'react-konva-utils';
import type { AudioNode } from '../../../engine/model/schema';

interface Props {
  node: AudioNode;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = (total % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

/**
 * Voice note player.
 *
 * Rendered as a DOM overlay rather than Konva shapes because it needs real
 * audio controls. That does mean it is absent from PNG exports (which capture
 * the canvas only) — the SVG exporter draws a labelled placeholder for audio
 * nodes so at least the document structure survives.
 */
export const AudioRenderer: React.FC<Props> = React.memo(({ node }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const tick = () => {
      const el = audioRef.current;
      if (el && el.duration) setProgress(el.currentTime / el.duration);
      frameRef.current = requestAnimationFrame(tick);
    };
    if (isPlaying) frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      // play() rejects when the element has no decodable source; without
      // catching it that surfaces as an unhandled rejection in the console.
      el.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false)
      );
    }
  };

  const waveform = node.waveform.length > 0 ? node.waveform : new Array(40).fill(0.15);
  const accent = node.author.color;

  return (
    <Html divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="hover-shadow-lg"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--surface-primary)',
          padding: '8px 16px',
          borderRadius: 40,
          border: '1px solid var(--border-divider)',
          boxShadow: 'var(--shadow-md)',
          width: node.width,
          pointerEvents: 'auto',
          cursor: 'default',
        }}
      >
        {node.src && (
          <audio
            ref={audioRef}
            src={node.src}
            preload="metadata"
            onEnded={() => {
              setIsPlaying(false);
              setProgress(0);
            }}
          />
        )}

        <button
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: accent,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'white',
            flexShrink: 0,
            boxShadow: `0 4px 12px ${accent}80`,
          }}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.05em' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.author.name}
            </span>
            <span style={{ flexShrink: 0 }}>
              {formatClock(progress * node.durationMs)} / {formatClock(node.durationMs)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 16 }}>
            {waveform.map((value, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: Math.max(4, value * 24),
                  background: i / waveform.length <= progress ? accent : 'var(--surface-hover)',
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
        </div>

        <div
          title={node.author.name}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold',
            fontSize: 12,
            flexShrink: 0,
            border: '2px solid var(--surface-primary)',
          }}
        >
          {node.author.name.charAt(0).toUpperCase()}
        </div>
      </div>
    </Html>
  );
});

AudioRenderer.displayName = 'AudioRenderer';
