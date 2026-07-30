import React, { useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, BringToFront, ChevronDown, ChevronRight,
  FlipHorizontal, FlipVertical, ImageIcon, Italic, LayoutTemplate, Lock, MessageSquare,
  Mic, PenLine, SendToBack, Sliders, Square, StickyNote, Type, Underline, Unlock,
} from 'lucide-react';
import { lowestZIndex, nextZIndex, provider, updateNode } from '../engine/document';
import { useStore } from '../hooks/useStore';
import { objectRegistry } from '../engine/objects';
import {
  DEFAULT_TYPOGRAPHY,
  type AnyNode,
  type Appearance,
  type TextAlign,
  type Typography,
} from '../engine/model/schema';
import { ColorPickerPopover } from './ui/ColorPickerPopover';
import { NumberStepper } from './ui/NumberStepper';
import { FontSelector } from './ui/FontSelector';
import { SegmentedControl } from './ui/SegmentedControl';
import { THEMES, nearestTheme } from './canvas/renderers/StickyRenderer';
import { MATERIALS, MATERIAL_IDS, resolveMaterial } from '../utils/behaviorSystem';

/**
 * Types that are simulated at all. Comments and frames are anchors — offering
 * them a material would imply a behaviour they deliberately do not have.
 */
const NON_PHYSICAL_TYPES = new Set(['comment', 'artboard', 'frame']);
const isPhysicalType = (type: string) => !NON_PHYSICAL_TYPES.has(type);

interface PropertiesPanelProps {
  selectedId: string | null;
  /** Time Travel replay snapshot, which replaces the live document while scrubbing. */
  overrideObjects?: Record<string, AnyNode> | null;
}

const Accordion: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-divider)' }}>
      <button
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', width: '100%',
        }}
        className="hover-surface"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</span>
        {isOpen ? <ChevronDown size={14} color="var(--text-secondary)" /> : <ChevronRight size={14} color="var(--text-secondary)" />}
      </button>
      {isOpen && <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>{children}</div>}
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
    {children}
  </div>
);

const TYPE_ICONS: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={16} color="var(--text-secondary)" />,
  shape: <Square size={16} color="var(--text-secondary)" />,
  text: <Type size={16} color="var(--text-secondary)" />,
  image: <ImageIcon size={16} color="var(--text-secondary)" />,
  audio: <Mic size={16} color="var(--text-secondary)" />,
  path: <PenLine size={16} color="var(--text-secondary)" />,
  comment: <MessageSquare size={16} color="var(--text-secondary)" />,
};

/** Types that carry their own `typography` block. */
function typographyOf(node: AnyNode): Typography | null {
  if (node.type === 'text') return node.typography;
  if (node.type === 'shape') return node.typography ?? DEFAULT_TYPOGRAPHY;
  return null;
}

function appearanceOf(node: AnyNode): Appearance | null {
  return 'appearance' in node ? (node.appearance ?? {}) : null;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedId, overrideObjects }) => {
  const storeObj = useStore((state) => (selectedId ? state.objects[selectedId] : null));
  const [aspectLocked, setAspectLocked] = useState(false);

  const node: AnyNode | null = (overrideObjects && selectedId ? overrideObjects[selectedId] : storeObj) ?? null;

  if (!node || !selectedId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', gap: '12px', opacity: 0.7, marginTop: '120px' }}>
        <Sliders size={28} />
        <span style={{ fontSize: '14px', fontWeight: 500 }}>Select an object</span>
      </div>
    );
  }

  const capabilities = objectRegistry.get(node.type)?.capabilities ?? {};
  const typography = typographyOf(node);
  const appearance = appearanceOf(node);

  const set = (updates: Partial<AnyNode>) => updateNode(selectedId, updates as Record<string, unknown>);
  const setAppearance = (patch: Partial<Appearance>) =>
    set({ appearance: { ...(appearance ?? {}), ...patch } } as Partial<AnyNode>);
  const setTypography = (patch: Partial<Typography>) =>
    set({ typography: { ...(typography ?? DEFAULT_TYPOGRAPHY), ...patch } } as Partial<AnyNode>);

  // Resizing writes width/height only. There is no second copy of the size to
  // keep in step any more — this used to fan a single edit out to `width`,
  // `content.width` and `geometry.width` and hope they stayed consistent.
  const setWidth = (width: number) => {
    const height = aspectLocked && node.width > 0 ? Math.round(width * (node.height / node.width)) : node.height;
    set({ width: Math.max(1, width), height: Math.max(1, height) });
  };
  const setHeight = (height: number) => {
    const width = aspectLocked && node.height > 0 ? Math.round(height * (node.width / node.height)) : node.width;
    set({ width: Math.max(1, width), height: Math.max(1, height) });
  };

  const awarenessStates = provider.awareness?.getStates();
  const myClientId = provider.awareness?.clientID;
  const activeEditors: Array<{ name: string; color: string }> = [];
  (awarenessStates ?? new Map()).forEach((state: any, clientId: number) => {
    if (clientId !== myClientId && state.user && Array.isArray(state.selection) && state.selection.includes(selectedId)) {
      activeEditors.push({ name: state.user.name || 'Teammate', color: state.user.color || '#EC4899' });
    }
  });

  // Authorship is denormalised onto the node at creation, so it survives the
  // author disconnecting. This used to resolve a bare client id against the
  // live awareness roster and fall back to "Unknown" for anyone who had left.
  const createdByLabel =
    String(node.createdBy) === String(myClientId) ? 'You' : node.createdByName || 'Unknown';

  const isBold = (typography?.fontWeight ?? 400) >= 600;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', userSelect: 'none', background: 'var(--surface-primary)', paddingBottom: '24px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', borderBottom: '1px solid var(--border-divider)', background: 'var(--surface-elevated)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>
            {TYPE_ICONS[node.type] ?? <LayoutTemplate size={16} color="var(--text-secondary)" />}
            <span style={{ textTransform: 'capitalize' }}>{node.type}</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', background: 'var(--surface-hover)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            {node.id.slice(0, 4)}
          </span>
        </div>

        {activeEditors.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--text-secondary)' }}>
            <span style={{ position: 'relative', display: 'flex', height: '8px', width: '8px' }}>
              <span style={{ position: 'absolute', height: '100%', width: '100%', borderRadius: '50%', backgroundColor: activeEditors[0].color, opacity: 0.7, animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', height: '8px', width: '8px', backgroundColor: activeEditors[0].color }} />
            </span>
            {activeEditors[0].name} is editing
          </div>
        )}

        <div style={{ display: 'flex', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px', width: '100%', marginTop: '8px' }}>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ zIndex: nextZIndex() })} title="Bring to Front"><BringToFront size={14} /></button>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ zIndex: lowestZIndex() - 1 })} title="Send to Back"><SendToBack size={14} /></button>
          <div style={{ width: '1px', height: '20px', margin: 'auto 4px', background: 'var(--border-divider)' }} />
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ scaleX: -node.scaleX })} title="Flip Horizontal"><FlipHorizontal size={14} /></button>
          <button className="btn-icon" style={{ flex: 1, padding: '6px' }} onClick={() => set({ scaleY: -node.scaleY })} title="Flip Vertical"><FlipVertical size={14} /></button>
        </div>
      </div>

      <Accordion title="Transform">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <NumberStepper value={Math.round(node.x)} onChange={(v) => set({ x: v })} label="X" />
          <NumberStepper value={Math.round(node.y)} onChange={(v) => set({ y: v })} label="Y" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumberStepper value={Math.round(node.width)} onChange={setWidth} label="W" min={1} />
          </div>
          <button
            className="btn-icon"
            onClick={() => setAspectLocked((v) => !v)}
            data-tooltip={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            aria-pressed={aspectLocked}
            style={{
              padding: '6px', marginTop: '10px', borderRadius: '4px', flexShrink: 0,
              color: aspectLocked ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: aspectLocked ? 'var(--surface-hover)' : 'transparent',
            }}
          >
            {aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumberStepper value={Math.round(node.height)} onChange={setHeight} label="H" min={1} />
          </div>
        </div>
        <div style={{ marginTop: '8px' }}>
          <NumberStepper value={Math.round(node.rotation)} onChange={(v) => set({ rotation: v })} label="R" step={15} />
        </div>
      </Accordion>

      {(capabilities.supportsFill || capabilities.supportsOpacity || capabilities.supportsRadius) && (
        <Accordion title="Appearance">
          {capabilities.supportsFill && appearance && (
            <Row label="Fill">
              <ColorPickerPopover
                color={appearance.fill?.[0]?.color ?? '#000000'}
                onChange={(color) => setAppearance({ fill: [{ type: 'solid', color, opacity: 1 }] })}
              />
            </Row>
          )}
          {capabilities.supportsRadius && (node.type !== 'shape' || node.geometry.kind === 'rect') && (
            <Row label="Corner Radius">
              <NumberStepper
                value={appearance?.cornerRadius ?? 0}
                onChange={(v) => setAppearance({ cornerRadius: v })}
                min={0} max={200}
              />
            </Row>
          )}
          {capabilities.supportsOpacity && (
            <Row label="Opacity">
              <NumberStepper value={Math.round(node.opacity * 100)} onChange={(v) => set({ opacity: v / 100 })} min={0} max={100} step={10} />
            </Row>
          )}
        </Accordion>
      )}

      {capabilities.supportsStroke && appearance && (
        <Accordion title="Stroke">
          <Row label="Color">
            <ColorPickerPopover
              color={appearance.stroke?.color ?? 'transparent'}
              onChange={(color) => setAppearance({ stroke: { width: appearance.stroke?.width ?? 2, ...appearance.stroke, color } })}
            />
          </Row>
          <Row label="Width">
            <NumberStepper
              value={appearance.stroke?.width ?? 0}
              onChange={(width) => setAppearance({ stroke: { color: appearance.stroke?.color ?? '#000000', ...appearance.stroke, width } })}
              min={0} max={100}
            />
          </Row>
        </Accordion>
      )}

      {capabilities.supportsTypography && typography && (
        <Accordion title="Typography">
          <FontSelector value={typography.fontFamily} onChange={(fontFamily) => setTypography({ fontFamily })} />
          <Row label="Size">
            <NumberStepper value={typography.fontSize} onChange={(fontSize) => setTypography({ fontSize })} min={8} max={500} />
          </Row>
          <Row label="Color">
            <ColorPickerPopover color={typography.color} onChange={(color) => setTypography({ color })} />
          </Row>
          <Row label="Style">
            <div style={{ display: 'flex', background: 'var(--surface-hover)', padding: '2px', borderRadius: '6px' }}>
              {/* These write the same canonical fields Cmd+B/I/U do, and the
                  renderer composes Konva's fontStyle from them in one place. */}
              <ToggleButton active={isBold} onClick={() => setTypography({ fontWeight: isBold ? 400 : 700 })} label="Bold"><Bold size={14} /></ToggleButton>
              <ToggleButton active={typography.italic} onClick={() => setTypography({ italic: !typography.italic })} label="Italic"><Italic size={14} /></ToggleButton>
              <ToggleButton active={typography.underline} onClick={() => setTypography({ underline: !typography.underline })} label="Underline"><Underline size={14} /></ToggleButton>
            </div>
          </Row>
          <Row label="Alignment">
            <SegmentedControl
              value={typography.align}
              onChange={(v) => setTypography({ align: v as TextAlign })}
              segments={[
                { value: 'left', icon: <AlignLeft size={14} /> },
                { value: 'center', icon: <AlignCenter size={14} /> },
                { value: 'right', icon: <AlignRight size={14} /> },
              ]}
            />
          </Row>
          <Row label="Line Height">
            <NumberStepper value={typography.lineHeight} onChange={(lineHeight) => setTypography({ lineHeight })} min={0.5} max={3} step={0.1} />
          </Row>
          <Row label="Spacing">
            <NumberStepper value={typography.letterSpacing} onChange={(letterSpacing) => setTypography({ letterSpacing })} min={-10} max={50} step={1} />
          </Row>
        </Accordion>
      )}

      {node.type === 'sticky' && (
        <Accordion title="Sticky Note">
          <Row label="Color">
            <ColorPickerPopover
              // A sticky's colour is a named theme on the node, not a paint.
              // This used to write `appearance.fill`, which the sticky renderer
              // never reads — so recolouring a sticky here did nothing at all.
              color={THEMES[node.theme]?.bg ?? '#FDE047'}
              onChange={(color) => set({ theme: nearestTheme(color) })}
            />
          </Row>
          <Row label="Text Size">
            <NumberStepper value={node.fontSize} onChange={(fontSize) => set({ fontSize })} min={8} max={72} />
          </Row>
          <Row label="Pinned">
            <input type="checkbox" checked={node.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
          </Row>
        </Accordion>
      )}

      {/* What the object is made of, and therefore how it moves under force.
          The material profiles have always driven the simulation but were keyed
          to node type and invisible — an audio note was bouncy and nobody could
          see why, or make a sticky heavy. */}
      {isPhysicalType(node.type) && (
        <Accordion title="Physics">
          <Row label="Material">
            <select
              value={resolveMaterial(node).id}
              onChange={(e) => set({ material: e.target.value } as Partial<AnyNode>)}
              aria-label="Material"
              style={{
                background: 'var(--surface-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-divider)',
                borderRadius: 'var(--radius-md)',
                padding: '4px 8px',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              {MATERIAL_IDS.map((id) => (
                <option key={id} value={id}>{MATERIALS[id].label}</option>
              ))}
            </select>
          </Row>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            {resolveMaterial(node).hint}
          </p>
        </Accordion>
      )}

      <Accordion title="Metadata" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <Row label="ID">
            <span style={{ fontFamily: 'monospace', background: 'var(--surface-hover)', padding: '2px 4px', borderRadius: '4px' }}>{node.id.slice(0, 8)}</span>
          </Row>
          <Row label="Created"><span>{new Date(node.createdAt).toLocaleString()}</span></Row>
          {/* Now genuinely updated — the document layer stamps updatedAt on
              every write, where before nothing ever set it after creation and
              this always displayed the creation date. */}
          <Row label="Updated"><span>{new Date(node.updatedAt).toLocaleString()}</span></Row>
          <Row label="Author"><span>{createdByLabel}</span></Row>
          {node.parentId && (
            <Row label="Group">
              <span style={{ fontFamily: 'monospace', background: 'var(--surface-hover)', padding: '2px 4px', borderRadius: '4px' }}>{node.parentId.slice(0, 8)}</span>
            </Row>
          )}
        </div>
      </Accordion>
    </div>
  );
};

const ToggleButton: React.FC<{ active: boolean; onClick: () => void; label: string; children: React.ReactNode }> = ({ active, onClick, label, children }) => (
  <button
    className="btn-icon"
    aria-pressed={active}
    aria-label={label}
    onClick={onClick}
    style={{
      padding: '6px', borderRadius: '4px',
      background: active ? 'var(--surface-primary)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      boxShadow: active ? 'var(--shadow-sm)' : 'none',
    }}
  >
    {children}
  </button>
);
