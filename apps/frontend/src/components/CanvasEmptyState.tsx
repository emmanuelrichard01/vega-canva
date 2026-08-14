import React from 'react';
import { MessageSquare, Command, MousePointerClick, StickyNote, Type } from 'lucide-react';
import { useStore } from '../hooks/useStore';

/**
 * What a brand-new canvas says for itself.
 *
 * An empty infinite canvas is the least self-explanatory surface in the
 * product: there is nothing on screen, no edges, and no indication that the
 * dock at the bottom is where you begin. Previously it showed nothing at all,
 * so a first-time user's only option was to guess.
 *
 * Deliberately non-modal and non-blocking — it sits behind the pointer, does
 * not intercept clicks, and disappears the instant the first object exists,
 * so it never becomes something to dismiss.
 */
export const CanvasEmptyState: React.FC<{ visible: boolean }> = ({ visible }) => {
  const objectCount = useStore((state) => Object.keys(state.objects).length);

  if (!visible || objectCount > 0) return null;

  const hints: Array<{ icon: React.ReactNode; label: string; keys: string; tool: string }> = [
    { icon: <StickyNote size={15} />, label: 'Sticky note', keys: 'S', tool: 'sticky' },
    { icon: <Type size={15} />, label: 'Text', keys: 'T', tool: 'text' },
    { icon: <MessageSquare size={15} />, label: 'Comment', keys: 'C', tool: 'comment' },
  ];

  return (
    <div
      // The prose is decoration and must never sit between the user and the
      // canvas — but the three chips below are real controls, so they opt
      // pointer events back on individually. They were pill-shaped, elevated
      // and captioned with a shortcut key, which is the visual grammar of a
      // button; being inert made them a lie about what they were.
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-6)',
        pointerEvents: 'none',
        zIndex: 1,
        animation: 'fadeIn var(--motion-nav)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div
          style={{
            width: 56, height: 56, margin: '0 auto var(--space-4)',
            borderRadius: 'var(--radius-2xl)',
            background: 'var(--surface-secondary)',
            border: '1px solid var(--border-divider)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tertiary)',
          }}
        >
          <MousePointerClick size={24} />
        </div>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)', margin: '0 0 var(--space-2)', letterSpacing: '-0.02em' }}>
          A canvas with no edges
        </h2>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
          Pick a tool below and click anywhere to begin. Scroll to pan, pinch or
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}> Ctrl</span>+scroll to zoom.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {hints.map((hint) => (
          <button
            key={hint.label}
            type="button"
            // Arms the tool through the same event the dock dispatches, so
            // there is one way in and no second tool-selection path to drift.
            onClick={() => window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: hint.tool }))}
            aria-label={`${hint.label} tool, shortcut ${hint.keys}`}
            className="hover-surface"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-elevated)',
              // Elevation declared once. It carried a border *and* a shadow,
              // which is two depth systems on one 28px chip.
              border: 'none',
              boxShadow: 'var(--shadow-float)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>{hint.icon}</span>
            {hint.label}
            <kbd
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
                border: '1px solid var(--border-divider)', borderRadius: 'var(--radius-sm)',
                padding: '1px 5px', color: 'var(--text-tertiary)',
              }}
            >
              {hint.keys}
            </kbd>
          </button>
        ))}
      </div>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
        <Command size={13} />
        Press <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', border: '1px solid var(--border-divider)', borderRadius: 'var(--radius-sm)', padding: '1px 5px' }}>Ctrl K</kbd> for everything else
      </span>
    </div>
  );
};
