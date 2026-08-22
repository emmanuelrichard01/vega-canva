import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

export const GestureOverlay: React.FC = () => {
  const [gestures, setGestures] = useState<Gesture[]>([]);

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
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      
      const gesturesMap: Record<string, string> = {
        '1': '👏',
        '2': '👍',
        '3': '👀',
        '4': '❤️',
        '5': '🔥'
      };

      if (gesturesMap[e.key]) {
        setActiveGesture(gesturesMap[e.key]);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        setActiveGesture(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!activeGesture) return;

    const handlePointerDown = (e: MouseEvent) => {
      // Calculate world coordinates
      const x = (e.clientX - cameraSystem.x) / cameraSystem.zoom;
      const y = (e.clientY - cameraSystem.y) / cameraSystem.zoom;

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
    <>
      <div
        style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 50, overflow: 'hidden' }}
      >
        <AnimatePresence>
          {gestures.map(g => {
            const screenX = (g.x * cameraSystem.zoom) + cameraSystem.x;
            const screenY = (g.y * cameraSystem.zoom) + cameraSystem.y;

            return (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: 20, scale: 0.5, rotate: Math.random() * 20 - 10 }}
                animate={{ opacity: 1, y: -40, scale: 1.5 + Math.random(), rotate: Math.random() * 40 - 20 }}
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
              background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', color: '#FFFFFF',
              padding: '12px 24px', borderRadius: 999, fontSize: 13, fontWeight: 500, zIndex: 50,
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>{activeGesture}</span>
            <span>Click anywhere to drop gesture</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
