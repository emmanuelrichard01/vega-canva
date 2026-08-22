import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { ensureFontLoaded } from '../../engine/text/measure';
import { PORTAL_SURFACE_ATTR, isInsidePortalSurface } from './portalSurface';

/**
 * The curated suite of clean, modern, and premium typefaces available for canvas text.
 *
 * Every face is loaded globally through Google Fonts and self-hosted variable font bundles,
 * ensuring flawless pixel-accurate rendering across all collaborator machines and platforms.
 */
const GROUPS: Array<{ label: string; fonts: string[] }> = [
  {
    label: 'Modern Sans',
    fonts: ['Inter', 'Plus Jakarta Sans', 'DM Sans', 'Outfit', 'Space Grotesk', 'Roboto'],
  },
  {
    label: 'Editorial Serif',
    fonts: ['Playfair Display', 'Lora', 'Georgia'],
  },
  {
    label: 'Developer Mono',
    fonts: ['JetBrains Mono', 'Courier New'],
  },
  {
    label: 'Signature Hand',
    fonts: ['Caveat', 'Architects Daughter'],
  },
];

interface Props {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

export const FontSelector: React.FC<Props> = ({ value, onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const selectFont = useCallback(
    (font: string) => {
      ensureFontLoaded(font);
      onChange(font);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const width = Math.max(220, trigger.width);
    const height = popoverRef.current?.offsetHeight ?? 300;
    const margin = 8;

    let top = trigger.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, trigger.top - height - 4);
    }
    let left = trigger.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPosition({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target) ||
        isInsidePortalSurface(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const displayFont = value || 'Inter';

  return (
    <div className={className} style={{ position: 'relative', width: '100%', minWidth: 120 }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Font: ${displayFont}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: 28,
          padding: '0 8px 0 10px',
          background: 'var(--surface-hover)',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          borderRadius: 6,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          outline: 'none',
          transition: 'border-color var(--motion-hover), background var(--motion-hover)',
        }}
      >
        <span
          style={{
            fontFamily: canvasFontFamily(displayFont),
            fontSize: 12,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginRight: 6,
          }}
        >
          {displayFont}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            color: 'var(--text-secondary)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {isOpen &&
        position &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            {...{ [PORTAL_SURFACE_ATTR]: 'true' }}
            role="listbox"
            aria-label="Select font"
            className="panel-surface custom-scrollbar"
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: 320,
              overflowY: 'auto',
              zIndex: 99999,
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              borderRadius: 8,
              padding: '4px',
              boxShadow: 'var(--shadow-float, 0 12px 32px rgba(0, 0, 0, 0.4))',
              animation: 'popIn 120ms var(--ease-settle)',
            }}
          >
            {GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: 4 }}>
                <div
                  style={{
                    padding: '6px 8px 3px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    userSelect: 'none',
                  }}
                >
                  {group.label}
                </div>
                {group.fonts.map((font) => {
                  const isSelected = font === displayFont;
                  return (
                    <button
                      key={font}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectFont(font)}
                      onMouseEnter={() => ensureFontLoaded(font)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '6px 8px',
                        border: 'none',
                        borderRadius: 4,
                        background: isSelected ? 'var(--surface-active, rgba(59, 130, 246, 0.15))' : 'transparent',
                        color: isSelected ? 'var(--text-accent)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background var(--motion-hover)',
                      }}
                      onMouseOver={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'var(--surface-hover)';
                      }}
                      onMouseOut={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span
                        style={{
                          fontFamily: canvasFontFamily(font),
                          fontSize: 13,
                          fontWeight: isSelected ? 600 : 400,
                          lineHeight: 1.2,
                        }}
                      >
                        {font}
                      </span>
                      {isSelected && <Check size={14} style={{ color: 'var(--text-accent)', flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
