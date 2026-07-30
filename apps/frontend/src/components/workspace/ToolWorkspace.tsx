import React, { useEffect, useState } from 'react';
import { MousePointer2, Hand, Pen, PenTool as PenToolIcon, Type, Square, StickyNote, MessageSquare, ImageIcon, Mic, Sparkles, Magnet, Radiation, Waves, Zap, ArrowDownToLine } from 'lucide-react';
import { FORCE_IDS, FORCE_SPECS, isForceTool, type ForceId } from '../../engine/physics/forces';

interface Props {
  activeToolId: string;
}

const FORCE_ICONS: Record<ForceId, React.ReactNode> = {
  magnet: <Magnet size={16} />,
  repel: <Radiation size={16} />,
  gravity: <ArrowDownToLine size={16} />,
  wind: <Waves size={16} />,
  shockwave: <Zap size={16} />,
};

export const ToolWorkspace: React.FC<Props> = ({ activeToolId }) => {
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showPenMenu, setShowPenMenu] = useState(false);
  /**
   * The forces menu opens on hover *or* on click, and only a click keeps it
   * open. Hover alone is a trap: it is invisible until you happen to pass over
   * the icon, and on a touch device there is no hover at all — the five forces
   * simply could not be reached.
   */
  const [forcesPinned, setForcesPinned] = useState(false);
  const [forcesHovered, setForcesHovered] = useState(false);
  const showMagicMenu = forcesPinned || forcesHovered;

  // Clicking elsewhere, or pressing Escape, closes a pinned menu — otherwise a
  // click-opened menu has no obvious way out.
  useEffect(() => {
    if (!forcesPinned) return;
    const close = () => setForcesPinned(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setForcesPinned(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [forcesPinned]);

  // Canvas.tsx owns the real ToolManager instance and reacts to this event —
  // there used to be a second, entirely unused ToolRegistry here that this
  // called into first, but nothing ever registered tools on it.
  const setTool = (id: string) => {
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: id }));
  };

  const isShape = activeToolId.startsWith('shape');

  const renderShapeIcon = () => {
    if (activeToolId === 'shape-ellipse') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle></svg>;
    if (activeToolId === 'shape-triangle') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3L21 20H3L12 3Z"></path></svg>;
    if (activeToolId === 'shape-hexagon') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon></svg>;
    if (activeToolId === 'shape-star') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>;
    return <Square size={18} />;
  };



  // Default Creation Dock
  return (
    <div
      className="tool-dock panel-surface"
      role="toolbar"
      aria-label="Canvas tools"
      aria-orientation="horizontal"
      style={{ display: 'flex', gap: '4px', padding: '6px 8px', borderRadius: 'var(--radius-lg)', position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}
    >
      <button className={`btn-icon ${activeToolId === 'select' ? 'active' : ''}`} aria-pressed={activeToolId === 'select'} onClick={() => setTool('select')} data-tooltip="Select (V)" aria-label="Select (V)" style={{ padding: '6px' }}>
        <MousePointer2 size={18} />
      </button>
      <button className={`btn-icon ${activeToolId === 'hand' ? 'active' : ''}`} aria-pressed={activeToolId === 'hand'} onClick={() => setTool('hand')} data-tooltip="Hand (H)" aria-label="Hand (H)" style={{ padding: '6px' }}>
        <Hand size={18} />
      </button>
      <div style={{ width: 1, height: 18, background: 'var(--border-divider)', margin: 'auto 4px' }} />
      <div style={{ position: 'relative' }} onMouseEnter={() => setShowPenMenu(true)} onMouseLeave={() => setShowPenMenu(false)}>
        <button
          className={`btn-icon ${['pen', 'bezier-pen'].includes(activeToolId) ? 'active' : ''}`}
          onClick={() => setTool(activeToolId === 'bezier-pen' ? 'bezier-pen' : 'pen')}
          data-tooltip={showPenMenu ? undefined : (activeToolId === 'bezier-pen' ? 'Pen (P)' : 'Pencil (N)')}
          style={{ padding: '6px' }}
        >
          {activeToolId === 'bezier-pen' ? <PenToolIcon size={18} /> : <Pen size={18} />}
        </button>
        {showPenMenu && (
          <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 4, zIndex: 20 }}>
            <div className="panel-surface" style={{ display: 'flex', gap: 2, padding: 4 }}>
              <button className={`btn-icon ${activeToolId === 'pen' ? 'active' : ''}`} aria-pressed={activeToolId === 'pen'} onClick={() => setTool('pen')} data-tooltip="Pencil (N) — freehand drawing" aria-label="Pencil (N) — freehand drawing" style={{ padding: '6px' }}><Pen size={16} /></button>
              <button className={`btn-icon ${activeToolId === 'bezier-pen' ? 'active' : ''}`} aria-pressed={activeToolId === 'bezier-pen'} onClick={() => setTool('bezier-pen')} data-tooltip="Pen (P) — anchor points & curves" aria-label="Pen (P) — anchor points & curves" style={{ padding: '6px' }}><PenToolIcon size={16} /></button>
            </div>
          </div>
        )}
      </div>
      <button className={`btn-icon ${activeToolId === 'eraser' ? 'active' : ''}`} aria-pressed={activeToolId === 'eraser'} onClick={() => setTool('eraser')} data-tooltip="Eraser (E)" aria-label="Eraser (E)" style={{ padding: '6px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
      </button>
      <button className={`btn-icon ${activeToolId === 'text' ? 'active' : ''}`} aria-pressed={activeToolId === 'text'} onClick={() => setTool('text')} data-tooltip="Text (T)" aria-label="Text (T)" style={{ padding: '6px' }}>
        <Type size={18} />
      </button>
      
      <div style={{ position: 'relative' }} onMouseEnter={() => setShowShapeMenu(true)} onMouseLeave={() => setShowShapeMenu(false)}>
        <button className={`btn-icon ${isShape ? 'active' : ''}`} onClick={() => setTool(isShape ? activeToolId : 'shape-rect')} data-tooltip={showShapeMenu ? undefined : "Shape (R)"} style={{ padding: '6px' }}>
          {renderShapeIcon()}
        </button>
        {showShapeMenu && (
          <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 4, zIndex: 20 }}>
            <div className="panel-surface" style={{ display: 'flex', gap: 2, padding: 4 }}>
              <button className={`btn-icon ${activeToolId === 'shape-rect' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-rect'} onClick={() => setTool('shape-rect')} data-tooltip="Rectangle" aria-label="Rectangle" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-ellipse' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-ellipse'} onClick={() => setTool('shape-ellipse')} data-tooltip="Ellipse" aria-label="Ellipse" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-triangle' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-triangle'} onClick={() => setTool('shape-triangle')} data-tooltip="Triangle" aria-label="Triangle" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3L21 20H3L12 3Z"></path></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-hexagon' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-hexagon'} onClick={() => setTool('shape-hexagon')} data-tooltip="Hexagon" aria-label="Hexagon" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-star' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-star'} onClick={() => setTool('shape-star')} data-tooltip="Star" aria-label="Star" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button>
            </div>
          </div>
        )}
      </div>

      <button className={`btn-icon ${activeToolId === 'sticky' ? 'active' : ''}`} aria-pressed={activeToolId === 'sticky'} onClick={() => setTool('sticky')} data-tooltip="Sticky Note (S)" aria-label="Sticky Note (S)" style={{ padding: '6px' }}>
        <StickyNote size={18} />
      </button>
      <button className={`btn-icon ${activeToolId === 'comment' ? 'active' : ''}`} aria-pressed={activeToolId === 'comment'} onClick={() => setTool('comment')} data-tooltip="Comment (C)" aria-label="Comment (C)" style={{ padding: '6px' }}>
        <MessageSquare size={18} />
      </button>
      
      {/* Forces. No longer gated on a switch elsewhere in the UI: this used to
          sit dimmed at 40% opacity with a tooltip telling you to go and turn
          Physics on in the header first. A disabled control whose enabling
          condition lives in another corner of the screen is a dead end —
          reaching for a force tool is itself the decision to use force. */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setForcesHovered(true)}
        onMouseLeave={() => setForcesHovered(false)}
        // Keep presses inside the menu away from the close-on-outside-click
        // listener, which would otherwise cancel the button's own toggle.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className={`btn-icon ${isForceTool(activeToolId) ? 'active' : ''}`}
          aria-pressed={isForceTool(activeToolId)}
          aria-haspopup="menu"
          aria-expanded={showMagicMenu}
          // Click opens the menu rather than silently selecting Pull. The five
          // forces used to be reachable *only* by hovering — undiscoverable
          // with a mouse and completely unreachable on a touch device, where
          // you could press the icon but never see what was behind it.
          onClick={() => setForcesPinned(open => !open)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setForcesPinned(false);
          }}
          data-tooltip={showMagicMenu ? undefined : 'Forces — push, pull and drop objects'}
          aria-label="Forces"
          style={{ padding: '6px' }}
        >
          <Sparkles size={18} />
        </button>
        {showMagicMenu && (
          <div role="menu" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 4, zIndex: 20 }}>
            <div className="panel-surface" style={{ display: 'flex', gap: 2, padding: 4 }}>
              {FORCE_IDS.map(id => (
                <button
                  key={id}
                  role="menuitemradio"
                  className={`btn-icon ${activeToolId === id ? 'active' : ''}`}
                  aria-checked={activeToolId === id}
                  // Naming each force next to its icon, because five abstract
                  // glyphs in a row tell you nothing about which one pulls.
                  onClick={() => { setTool(id); setForcesPinned(false); }}
                  data-tooltip={FORCE_SPECS[id].hint}
                  aria-label={`${FORCE_SPECS[id].label} — ${FORCE_SPECS[id].hint}`}
                  style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500 }}
                >
                  {FORCE_ICONS[id]}
                  <span>{FORCE_SPECS[id].label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button className={`btn-icon ${activeToolId === 'image' ? 'active' : ''}`} aria-pressed={activeToolId === 'image'} onClick={() => setTool('image')} data-tooltip="Image" aria-label="Image" style={{ padding: '6px' }}>
        <ImageIcon size={18} />
      </button>
      <button className={`btn-icon ${activeToolId === 'audio' ? 'active' : ''}`} aria-pressed={activeToolId === 'audio'} onClick={() => setTool('audio')} data-tooltip="Voice Note" aria-label="Voice Note" style={{ padding: '6px' }}>
        <Mic size={18} />
      </button>
    </div>
  );
};
