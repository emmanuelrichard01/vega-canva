import React, { useState } from 'react';
import { Check, Copy, Link as LinkIcon, X, Users } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShareModalProps {
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ onClose }) => {
  const [copied, setCopied] = useState(false);
  const link = window.location.href;
  // Handles Escape, keeps Tab inside the dialog, and restores focus on close.
  const dialogRef = useFocusTrap(true, onClose);

  const handleCopy = () => {
    // Was fire-and-forget — a denied clipboard permission or an insecure
    // context still showed "Copied!" even though nothing was actually
    // copied, with no indication anything went wrong.
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (err) => console.warn('Failed to copy share link', err)
    );
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)'
    }} onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        aria-describedby="share-modal-desc"
        className="panel-surface"
        style={{
          padding: '24px', width: '380px',
          display: 'flex', flexDirection: 'column', gap: '20px',
          animation: 'fadeIn 0.15s ease-out', transform: 'translateY(0)',
          boxShadow: 'var(--shadow-overlay)',
          borderRadius: 'var(--radius-xl)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Users size={18} color="var(--text-primary)" />
              <h2 id="share-modal-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>Share Workspace</h2>
            </div>
            <p id="share-modal-desc" style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13, lineHeight: 1.4 }}>Anyone with this link can view and edit the canvas.</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 4, borderRadius: 4 }} className="hover-surface">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Invite Link</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-secondary)', border: '1px solid var(--border-divider)', borderRadius: 6, padding: '4px 4px 4px 12px' }}>
            <LinkIcon size={14} color="var(--text-tertiary)" />
            <input 
              type="text" 
              readOnly 
              value={link} 
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }}
              onClick={e => e.currentTarget.select()}
            />
            <button 
              onClick={handleCopy}
              style={{ 
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontWeight: 500, fontSize: 13,
                borderRadius: 4, background: copied ? 'var(--amber-500)' : 'var(--surface-primary)', color: copied ? 'white' : 'var(--text-primary)', 
                cursor: 'pointer', transition: 'all 0.1s', boxShadow: copied ? 'none' : 'var(--shadow-sm)',
                border: copied ? '1px solid transparent' : '1px solid var(--border-divider)'
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
