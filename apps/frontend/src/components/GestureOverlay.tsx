import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { provider } from '../engine/document';
import { engineEvents } from '../engine/EventBus';
import { nanoid } from 'nanoid';
import { cameraSystem } from '../engine/CameraSystem';

interface Gesture {
  id: string;
  emoji: string;
  x: number;
  y: number;
  timestamp: number;
  userId: number;
}

/**
 * How one gesture tumbles, from its id.
 *
 * Fixed per gesture rather than drawn at render: the overlay re-renders on
 * every camera change, and `Math.random()` in `animate` gave each in-flight
 * emoji a new target scale and rotation on every frame of a pan. Derived from
 * the id, so every viewer sees the same flourish.
 */
function flourish(id: string): { tilt: number; spin: number; grow: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const unit = (shift: number) => ((h >>> shift) & 0xff) / 255;
  return { tilt: unit(0) * 20 - 10, spin: unit(8) * 40 - 20, grow: 1.5 + unit(16) };
}

const GESTURE_KEYS: Record<string, string> = {
  '1': '👏',
  '2': '👍',
  '3': '👀',
  '4': '❤️',
  '5': '🔥',
};

/** Whether a key press belongs to a field or a control rather than the board. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export const GestureOverlay: React.FC = () => {
  const [gestures, setGestures] = useState<Gesture[]>([]);
  /** This overlay sits exactly on the stage's origin, rulers included. */
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleAwarenessUpdate = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;

      const now = Date.now();
      const newGestures: Gesture[] = [];

      states.forEach((state: any, clientId: number) => {
        if (state.gesture && now - state.gesture.timestamp < 3000) {
          newGestures.push({
            id: state.gesture.id,
            emoji: state.gesture.emoji,
            x: state.gesture.x,
            y: state.gesture.y,
            timestamp: state.gesture.timestamp,
            userId: clientId
          });
        }
      });

      if (newGestures.length > 0) {
        setGestures(prev => {
          // Merge avoiding duplicates
          const merged = [...prev];
          for (const g of newGestures) {
            if (!merged.find(m => m.id === g.id)) {
              merged.push(g);
            }
          }
          return merged;
        });
      }
    };

    provider.awareness?.on('change', handleAwarenessUpdate);
    return () => provider.awareness?.off('change', handleAwarenessUpdate);
  }, []);

  // Cleanup old gestures
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setGestures(prev => prev.filter(g => now - g.timestamp < 3000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const [activeGesture, setActiveGesture] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd+digit are zoom shortcuts, and Alt/Shift+digit type characters.
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(document.activeElement)) return;
      const emoji = GESTURE_KEYS[e.key];
      if (emoji) setActiveGesture(emoji);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (GESTURE_KEYS[e.key]) setActiveGesture(null);
    };
    // A key released while the window is in the background never sends keyup.
    const handleBlur = () => setActiveGesture(null);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!activeGesture) return;

    const handlePointerDown = (e: MouseEvent) => {
      // World coordinates, measured from the stage's origin rather than the
      // window's: the rulers and the page chrome sit between the two.
      const origin = layerRef.current?.getBoundingClientRect();
      const x = (e.clientX - (origin?.left ?? 0) - cameraSystem.x) / cameraSystem.zoom;
      const y = (e.clientY - (origin?.top ?? 0) - cameraSystem.y) / cameraSystem.zoom;

      const newGesture = {
        id: nanoid(),
        emoji: activeGesture,
        x,
        y,
        timestamp: Date.now()
      };

      // Broadcast immediately via ephemeral awareness
      provider.awareness?.setLocalStateField('gesture', newGesture);

      // Add locally for zero-latency feedback
      setGestures(prev => [...prev, { ...newGesture, userId: provider.awareness?.clientID || 0 }]);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [activeGesture]);

  const [, setForceRender] = useState(0);
  useEffect(() => {
    const handleCamera = () => setForceRender(r => r + 1);
    engineEvents.on('CameraChanged', handleCamera);
    return () => engineEvents.off('CameraChanged', handleCamera);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={layerRef}
        style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 50, overflow: 'hidden' }}
      >
        <AnimatePresence>
          {gestures.map(g => {
            const screenX = (g.x * cameraSystem.zoom) + cameraSystem.x;
            const screenY = (g.y * cameraSystem.zoom) + cameraSystem.y;
            const { tilt, spin, grow } = flourish(g.id);

            return (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: 20, scale: 0.5, rotate: tilt }}
                animate={{ opacity: 1, y: -40, scale: grow, rotate: spin }}
                exit={{ opacity: 0, y: -100, scale: 0.8 }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY,
                  fontSize: `${32 * cameraSystem.zoom}px`,
                  userSelect: 'none',
                  textShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}
              >
                {g.emoji}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeGesture && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--surface-inverse)', color: 'var(--text-inverse)',
              padding: '12px 24px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, zIndex: 50,
              boxShadow: 'var(--shadow-overlay)', display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>{activeGesture}</span>
            <span>Click anywhere to drop gesture</span>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
};
