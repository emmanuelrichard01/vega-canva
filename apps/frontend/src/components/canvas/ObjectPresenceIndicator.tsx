import React, { useEffect, useState } from 'react';
import { Html } from 'react-konva-utils';
import { provider } from '../../engine/document';
import { AnimatePresence, motion } from 'framer-motion';

export const ObjectPresenceIndicator = ({ objId, width, cx, cy }: { objId: string, width: number, cx: number, cy: number }) => {
  const [editors, setEditors] = useState<{ id: string, name: string, color: string, activity: string }[]>([]);

  useEffect(() => {
    const updateEditors = () => {
      if (!provider.awareness) return;
      const states = Array.from(provider.awareness.getStates().entries());
      const currentEditors: { id: string, name: string, color: string, activity: string }[] = [];
      
      for (const [clientId, state] of states) {
        if (clientId === provider.awareness.clientID) continue; // Skip local
        
        const editing = (state as any).editing;
        if (editing && editing.objectId === objId) {
           currentEditors.push({
             id: clientId.toString(),
             name: (state as any).user?.name || 'User',
             color: (state as any).user?.color || '#3B82F6',
             activity: (state as any).activity || 'editing'
           });
        }
      }
      setEditors(currentEditors);
    };

    updateEditors();
    provider.awareness?.on('change', updateEditors);
    return () => {
      provider.awareness?.off('change', updateEditors);
    };
  }, [objId]);

  if (editors.length === 0) return null;

  return (
    <Html groupProps={{ x: cx, y: cy, offsetX: cx, offsetY: cy }}>
      <div style={{ position: 'absolute', top: -32, left: width / 2, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', pointerEvents: 'none' }}>
        <AnimatePresence>
          {editors.map(ed => (
            <motion.div 
              key={ed.id}
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.8 }}
              style={{
                background: ed.color,
                color: 'white',
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                whiteSpace: 'nowrap'
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', animation: 'recPulse 1.5s infinite' }} />
              {ed.name} {ed.activity}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Html>
  );
};
