import React from 'react';

interface Props {
  workspaceId: string;
  name: string;
}

// Simple hash function for deterministic seeded values
const cyrb53 = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

export const WorkspaceCover: React.FC<Props> = ({ workspaceId }) => {
  const hash = cyrb53(workspaceId);
  
  // Deterministic values based on hash
  const r1 = (hash % 100) / 100;
  const r2 = ((hash >> 4) % 100) / 100;
  const r3 = ((hash >> 8) % 100) / 100;
  
  const colors = ['var(--amber-500)', 'var(--text-primary)', 'var(--border-focus)', 'var(--surface-active)'];
  const primaryColor = colors[Math.floor(r1 * colors.length)];
  const secondaryColor = colors[Math.floor(r2 * colors.length)];
  
  const shapeType = Math.floor(r3 * 3); // 0: circle, 1: rect, 2: polygon
  
  return (
    <div style={{ 
      width: '100%', 
      height: '140px', 
      background: 'var(--surface-secondary)', 
      borderBottom: '1px solid var(--border-divider)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Engineering Dot Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
        opacity: 0.6
      }} />
      
      {/* Dynamic Geometric Shape */}
      <div style={{ position: 'relative', zIndex: 1, width: 80, height: 80 }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          {shapeType === 0 && (
            <>
              <circle cx="50" cy="50" r="30" fill={primaryColor} fillOpacity="0.8" />
              <circle cx="65" cy="65" r="24" stroke={secondaryColor} strokeWidth="4" />
            </>
          )}
          {shapeType === 1 && (
            <>
              <rect x="25" y="25" width="50" height="50" rx="8" fill={primaryColor} fillOpacity="0.8" />
              <rect x="45" y="45" width="40" height="40" rx="8" stroke={secondaryColor} strokeWidth="4" />
            </>
          )}
          {shapeType === 2 && (
            <>
              <polygon points="50,15 85,75 15,75" fill={primaryColor} fillOpacity="0.8" />
              <polygon points="50,25 80,75 20,75" stroke={secondaryColor} strokeWidth="4" style={{ transformOrigin: 'center', transform: 'rotate(180deg)' }} />
            </>
          )}
        </svg>
      </div>
    </div>
  );
};
