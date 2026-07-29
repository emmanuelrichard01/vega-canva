import React, { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { Play, Pause, SkipBack, X, Gauge, History, Loader2 } from 'lucide-react';
import { roomHistoryUrl } from '../utils/endpoints';

interface TimeTravelBarProps {
  roomId: string;
  onClose: () => void;
  onApplySnapshot: (objects: Record<string, any> | null) => void;
}

interface UpdateEntry {
  createdAt: string;
  update: string; // Base64-encoded Yjs update
}

const SPEEDS = [1, 2, 4, 8];

/**
 * Time Travel — replays the room's authoring history from the beginning.
 *
 * Replay is driven by the server's append-only log of *incremental* Yjs updates.
 * Because it replays the CRDT update stream rather than a command log, it sees
 * every change regardless of origin — including drag moves and physics settles that
 * bypass the editor command layer entirely.
 *
 * Performance note: the previous version rebuilt the entire Y.Doc from index 0 on
 * every single scrub tick, which is O(n) work per frame and made playback of a long
 * session progressively slower as it advanced. This version keeps a live doc and
 * only applies the *delta* when stepping forward — rebuilding solely when the user
 * scrubs backwards, which is the only case that genuinely requires it.
 */
export const TimeTravelBar: React.FC<TimeTravelBarProps> = ({ roomId, onClose, onApplySnapshot }) => {
  const [history, setHistory] = useState<UpdateEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const playbackTimerRef = useRef<any>(null);
  // Live replay document + how far it has been advanced, so stepping forward is O(1).
  const replayDocRef = useRef<Y.Doc | null>(null);
  const appliedThroughRef = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    async function fetchHistory() {
      try {
        const res = await fetch(roomHistoryUrl(roomId));
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.updates && data.updates.length > 0) {
          setHistory(data.updates);
          setCurrentIndex(data.updates.length - 1);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load session history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchHistory();

    return () => {
      cancelled = true;
      onApplySnapshot(null); // restore live state on unmount
      replayDocRef.current?.destroy();
      replayDocRef.current = null;
    };
  }, [roomId]);

  const emitSnapshot = useCallback((doc: Y.Doc) => {
    const objectsMap = doc.getMap<Y.Map<any>>('objects');
    const snapshotObjects: Record<string, any> = {};
    objectsMap.forEach((objMap, id) => {
      snapshotObjects[id] = objMap.toJSON();
    });
    onApplySnapshot(snapshotObjects);
  }, [onApplySnapshot]);

  // Materialize the document state at `currentIndex`.
  useEffect(() => {
    if (history.length === 0) return;
    const target = Math.min(currentIndex, history.length - 1);

    // Rebuild from scratch only when moving backwards (or on first run) — Yjs updates
    // can't be un-applied, so rewinding genuinely requires a fresh doc.
    if (!replayDocRef.current || target < appliedThroughRef.current) {
      replayDocRef.current?.destroy();
      replayDocRef.current = new Y.Doc();
      appliedThroughRef.current = -1;
    }

    const doc = replayDocRef.current!;
    for (let i = appliedThroughRef.current + 1; i <= target; i++) {
      const binary = Uint8Array.from(atob(history[i].update), c => c.charCodeAt(0));
      Y.applyUpdate(doc, binary);
    }
    appliedThroughRef.current = target;

    emitSnapshot(doc);
  }, [currentIndex, history, emitSnapshot]);

  useEffect(() => {
    if (isPlaying) {
      playbackTimerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= history.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 600 / speed);
    } else {
      clearInterval(playbackTimerRef.current);
    }
    return () => clearInterval(playbackTimerRef.current);
  }, [isPlaying, speed, history.length]);

  const shellStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 96,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 20px',
    borderRadius: 14,
    boxShadow: 'var(--shadow-float)',
    color: 'var(--text-primary)',
    fontFamily: 'Inter, sans-serif',
    animation: 'popIn 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  };

  if (loading) {
    return (
      <div className="panel-surface" style={{ ...shellStyle, fontSize: 13, fontWeight: 500 }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
        Loading session history…
      </div>
    );
  }

  if (error || history.length === 0) {
    return (
      <div className="panel-surface" style={{ ...shellStyle, fontSize: 13 }}>
        <History size={16} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ color: 'var(--text-secondary)' }}>
          {error ? `Time Travel unavailable — ${error}` : 'No history recorded for this room yet.'}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex' }}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const stamp = history[currentIndex]?.createdAt;
  const timeLabel = stamp ? new Date(stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const progressPct = history.length > 1 ? (currentIndex / (history.length - 1)) * 100 : 100;

  return (
    <div className="panel-surface" style={{ ...shellStyle, width: 620 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
        <History size={16} style={{ color: 'var(--amber-500)' }} />
        Time Travel
      </div>

      <button
        onClick={() => setIsPlaying(!isPlaying)}
        title={isPlaying ? 'Pause replay' : 'Play replay'}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: 'var(--text-primary)',
          color: 'var(--surface-primary)',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'var(--motion-hover)',
        }}
      >
        {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>

      <button
        onClick={() => { setCurrentIndex(0); setIsPlaying(false); }}
        title="Restart from beginning"
        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
      >
        <SkipBack size={16} />
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {/* Track fill sits behind the native range input so the played portion reads
              in the accent color without needing a custom thumb implementation. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 4,
              borderRadius: 2,
              background: 'var(--surface-secondary)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              width: `${progressPct}%`,
              height: 4,
              borderRadius: 2,
              background: 'var(--amber-500)',
              pointerEvents: 'none',
              transition: 'width 80ms linear',
            }}
          />
          <input
            type="range"
            min={0}
            max={history.length - 1}
            value={currentIndex}
            onChange={e => {
              setIsPlaying(false);
              setCurrentIndex(Number(e.target.value));
            }}
            style={{
              width: '100%',
              accentColor: 'var(--amber-500)',
              cursor: 'pointer',
              background: 'transparent',
              position: 'relative',
              zIndex: 1,
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            Change {currentIndex + 1} of {history.length}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{timeLabel}</span>
        </div>
      </div>

      <button
        onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
        title="Playback speed"
        style={{
          background: 'var(--surface-hover)',
          border: 'none',
          color: 'var(--text-primary)',
          borderRadius: 6,
          padding: '5px 9px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <Gauge size={13} /> {speed}×
      </button>

      <button
        onClick={onClose}
        title="Exit Time Travel"
        style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex', padding: 2, flexShrink: 0 }}
      >
        <X size={18} />
      </button>
    </div>
  );
};
