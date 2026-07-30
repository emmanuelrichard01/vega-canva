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
  /**
   * The dock's three grouped tools (pen, shape, forces) share one menu model.
   *
   * Each opens on hover *or* on click, and only a click keeps it open. Hover
   * alone is a trap: the menu is invisible until you happen to pass over the
   * icon, and on a touch device there is no hover at all — the variants behind
   * these three buttons simply could not be reached. One piece of state rather
   * than a pair per menu also guarantees only one can ever be open.
   */
  type DockMenu = 'pen' | 'shape' | 'forces';
  const [pinnedMenu, setPinnedMenu] = useState<DockMenu | null>(null);
  const [hoveredMenu, setHoveredMenu] = useState<DockMenu | null>(null);
  const openMenu = pinnedMenu ?? hoveredMenu;

  const toggleMenu = (menu: DockMenu) => setPinnedMenu(current => (current === menu ? null : menu));
  const hoverProps = (menu: DockMenu) => ({
    onMouseEnter: () => setHoveredMenu(menu),
    onMouseLeave: () => setHoveredMenu(current => (current === menu ? null : current)),
    // Keep presses inside a menu away from the close-on-outside-press listener,
    // which would otherwise cancel the button's own toggle.
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  });

  // A click-opened menu needs an obvious way out: anywhere else, or Escape.
  useEffect(() => {
    if (!pinnedMenu) return;
    const close = () => setPinnedMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinnedMenu]);

  // Canvas.tsx owns the real ToolManager instance and reacts to this event —
  // there used to be a second, entirely unused ToolRegistry here that this
  // called into first, but nothing ever registered tools on it.
  const setTool = (id: string) => {
    window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: id }));
  };

  /** One look for every item inside a dock flyout: icon plus its name. */
  const menuItemStyle: React.CSSProperties = {
    padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
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
      /* Layout lives entirely in `.tool-dock`. These were duplicated inline,
         which meant two sources of truth for the same box — and the inline
         z-index of 10 quietly overrode the stylesheet's 100. */
    >
      <button className={`btn-icon ${activeToolId === 'select' ? 'active' : ''}`} aria-pressed={activeToolId === 'select'} onClick={() => setTool('select')} data-tooltip="Select (V)" aria-label="Select (V)" style={{ padding: '6px' }}>
        <MousePointer2 size={18} />
      </button>
      <button className={`btn-icon ${activeToolId === 'hand' ? 'active' : ''}`} aria-pressed={activeToolId === 'hand'} onClick={() => setTool('hand')} data-tooltip="Hand (H)" aria-label="Hand (H)" style={{ padding: '6px' }}>
        <Hand size={18} />
      </button>
      <div style={{ width: 1, height: 18, background: 'var(--border-divider)', margin: 'auto 4px' }} />
      <div style={{ position: 'relative' }} {...hoverProps('pen')}>
        <button
          className={`btn-icon ${['pen', 'bezier-pen'].includes(activeToolId) ? 'active' : ''}`}
          aria-pressed={['pen', 'bezier-pen'].includes(activeToolId)}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'pen'}
          onClick={() => toggleMenu('pen')}
          data-tooltip={openMenu === 'pen' ? undefined : 'Drawing tools'}
          aria-label="Drawing tools"
          style={{ padding: '6px' }}
        >
          {activeToolId === 'bezier-pen' ? <PenToolIcon size={18} /> : <Pen size={18} />}
        </button>
        {openMenu === 'pen' && (
          <div role="menu" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 6, zIndex: 20 }}>
            <div className="panel-surface" style={{ display: 'flex', gap: 2, padding: 4 }}>
              <button role="menuitemradio" className={`btn-icon ${activeToolId === 'pen' ? 'active' : ''}`} aria-checked={activeToolId === 'pen'} onClick={() => { setTool('pen'); setPinnedMenu(null); }} data-tooltip="Freehand drawing" aria-label="Pencil (N) — freehand drawing" style={menuItemStyle}><Pen size={16} /><span>Pencil</span></button>
              <button role="menuitemradio" className={`btn-icon ${activeToolId === 'bezier-pen' ? 'active' : ''}`} aria-checked={activeToolId === 'bezier-pen'} onClick={() => { setTool('bezier-pen'); setPinnedMenu(null); }} data-tooltip="Anchor points and curves" aria-label="Pen (P) — anchor points and curves" style={menuItemStyle}><PenToolIcon size={16} /><span>Pen</span></button>
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
      
      <div style={{ position: 'relative' }} {...hoverProps('shape')}>
        <button
          className={`btn-icon ${isShape ? 'active' : ''}`}
          aria-pressed={isShape}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'shape'}
          onClick={() => toggleMenu('shape')}
          data-tooltip={openMenu === 'shape' ? undefined : 'Shapes (R)'}
          aria-label="Shapes"
          style={{ padding: '6px' }}
        >
          {renderShapeIcon()}
        </button>
        {openMenu === 'shape' && (
          <div role="menu" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 6, zIndex: 20 }}>
            <div className="panel-surface" style={{ display: 'flex', gap: 2, padding: 4 }}>
              <button className={`btn-icon ${activeToolId === 'shape-rect' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-rect'} role="menuitemradio" onClick={() => { setTool('shape-rect'); setPinnedMenu(null); }} data-tooltip="Rectangle" aria-label="Rectangle" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-ellipse' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-ellipse'} role="menuitemradio" onClick={() => { setTool('shape-ellipse'); setPinnedMenu(null); }} data-tooltip="Ellipse" aria-label="Ellipse" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-triangle' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-triangle'} role="menuitemradio" onClick={() => { setTool('shape-triangle'); setPinnedMenu(null); }} data-tooltip="Triangle" aria-label="Triangle" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3L21 20H3L12 3Z"></path></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-hexagon' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-hexagon'} role="menuitemradio" onClick={() => { setTool('shape-hexagon'); setPinnedMenu(null); }} data-tooltip="Hexagon" aria-label="Hexagon" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon></svg></button>
              <button className={`btn-icon ${activeToolId === 'shape-star' ? 'active' : ''}`} aria-pressed={activeToolId === 'shape-star'} role="menuitemradio" onClick={() => { setTool('shape-star'); setPinnedMenu(null); }} data-tooltip="Star" aria-label="Star" style={{ padding: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button>
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
        {...hoverProps('forces')}
      >
        <button
          className={`btn-icon ${isForceTool(activeToolId) ? 'active' : ''}`}
          aria-pressed={isForceTool(activeToolId)}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'forces'}
          // Click opens the menu rather than silently selecting Pull. The five
          // forces used to be reachable *only* by hovering — undiscoverable
          // with a mouse and completely unreachable on a touch device, where
          // you could press the icon but never see what was behind it.
          onClick={() => toggleMenu('forces')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPinnedMenu(null);
          }}
          data-tooltip={openMenu === 'forces' ? undefined : 'Forces — push, pull and drop objects'}
          aria-label="Forces"
          style={{ padding: '6px' }}
        >
          <Sparkles size={18} />
        </button>
        {openMenu === 'forces' && (
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
                  onClick={() => { setTool(id); setPinnedMenu(null); }}
                  data-tooltip={FORCE_SPECS[id].hint}
                  aria-label={`${FORCE_SPECS[id].label} — ${FORCE_SPECS[id].hint}`}
                  style={menuItemStyle}
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
