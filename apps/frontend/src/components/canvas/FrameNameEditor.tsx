import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { SmilePlus } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { updateNode } from '../../engine/document';
import { canEditObjects } from '../../engine/model/permissions';
import { nodeBounds } from '../../engine/model/selection';
import { MAX_FRAME_DESCRIPTION } from '../../engine/document/normalize';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { isInsidePortalSurface } from '../ui/portalSurface';
import { Emoji } from '../emoji/Emoji';
import { EmojiPickerPopover } from '../emoji/EmojiPickerPopover';
import { openEmojiPicker } from '../emoji/openEmojiPicker';
import { useEmojiAutocomplete } from '../emoji/useEmojiAutocomplete';
import './frameName.css';

/** Ask for a frame's name to be edited in place. Sent by the header on double-click. */
export function requestFrameRename(id: string): void {
  window.dispatchEvent(new CustomEvent('renameFrame', { detail: { id } }));
}

/**
 * Ask for a frame's emoji to be chosen, from the header on the canvas.
 * `rect` is where the emoji is on screen; the picker hangs from it.
 */
export function requestFrameIcon(id: string, rect?: { left: number; top: number; width: number; height: number }): void {
  if (!canEditObjects()) return;
  const frame = (useStore.getState().objects as Record<string, AnyNode>)[id];
  if (!frame || frame.type !== 'frame') return;
  const at = rect ?? headerRect(frame as FrameNode);
  openEmojiPicker({
    rect: at,
    label: 'Frame icon',
    current: (frame as FrameNode).icon,
    onPick: (icon) => canEditObjects() && updateNode(id, { icon }),
    onRemove: (frame as FrameNode).icon ? () => canEditObjects() && updateNode(id, { icon: undefined }) : undefined,
    removeLabel: 'Remove icon',
  });
}

/** Where a frame's header sits in the viewport. */
function headerRect(frame: FrameNode): { left: number; top: number; width: number; height: number } {
  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const box = nodeBounds(frame);
  const left = (stage?.left ?? 0) + box.x * cameraSystem.zoom + cameraSystem.x;
  const top = (stage?.top ?? 0) + box.y * cameraSystem.zoom + cameraSystem.y - (frame.description ? 40 : 24);
  return { left, top, width: 18, height: 18 };
}

/**
 * The in-place editor for a frame's header: its emoji, its name and its
 * description, laid over where they are drawn.
 *
 * Enter commits, Escape cancels, and leaving the editor commits — the emoji
 * picker it opens counts as inside it. A blank name is not a name, so the
 * frame keeps the one it has; a blank description removes it. `:shortcode`
 * autocompletes in both fields. Editors only, because all three are part of
 * the document.
 */
export const FrameNameEditor: React.FC = () => {
  const [id, setId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);
  const nameComplete = useEmojiAutocomplete(nameRef, setName);
  const descComplete = useEmojiAutocomplete(descRef, setDesc);

  const frame = useStore((s) => {
    const node = id ? (s.objects as Record<string, AnyNode>)[id] : undefined;
    return node?.type === 'frame' ? (node as FrameNode) : undefined;
  });

  useEffect(() => {
    const onRename = (e: Event) => {
      const target = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!target || !canEditObjects()) return;
      const node = (useStore.getState().objects as Record<string, AnyNode>)[target];
      if (!node || node.type !== 'frame') return;
      doneRef.current = false;
      setName(node.title ?? 'Frame');
      setDesc(node.description ?? '');
      setIcon(node.icon);
      setId(target);
    };
    window.addEventListener('renameFrame', onRename);
    return () => window.removeEventListener('renameFrame', onRename);
  }, []);

  useEffect(() => {
    if (!id) return;
    const onCamera = () => setTick((t) => t + 1);
    engineEvents.on('CameraChanged', onCamera);
    return () => engineEvents.off('CameraChanged', onCamera);
  }, [id]);

  useEffect(() => {
    if (id && !frame) setId(null);
  }, [id, frame]);

  useEffect(() => {
    if (!id) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [id]);

  if (!id || !frame) return null;

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPickerOpen(false);
    if (commit && canEditObjects()) {
      const nextName = name.trim();
      const nextDesc = desc.replace(/\s+/g, ' ').trim().slice(0, MAX_FRAME_DESCRIPTION);
      const patch: Record<string, unknown> = {};
      if (nextName && nextName !== frame.title) patch.title = nextName;
      if (nextDesc !== (frame.description ?? '')) patch.description = nextDesc || undefined;
      if (icon !== frame.icon) patch.icon = icon;
      if (Object.keys(patch).length) updateNode(frame.id, patch);
    }
    setId(null);
  };

  /** Leaving the editor commits, unless focus went to the picker it opened. */
  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (rootRef.current?.contains(next) || isInsidePortalSurface(next))) return;
    // The picker steals focus without a related target while it mounts.
    if (pickerOpen) return;
    nameComplete.dismiss();
    descComplete.dismiss();
    finish(true);
  };

  const keys = (complete: ReturnType<typeof useEmojiAutocomplete>) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (complete.onKeyDown(e)) return;
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  };

  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const box = nodeBounds(frame);
  const left = (stage?.left ?? 0) + box.x * cameraSystem.zoom + cameraSystem.x;
  const bottom = (stage?.top ?? 0) + box.y * cameraSystem.zoom + cameraSystem.y - 4;
  const width = Math.min(360, Math.max(220, box.width * cameraSystem.zoom));

  return ReactDOM.createPortal(
    <div
      ref={rootRef}
      className="frame-header-editor"
      role="group"
      aria-label="Frame header"
      style={{ left, top: bottom, width }}
      onBlur={onBlur}
    >
      <div className="frame-header-editor__row">
        <button
          ref={iconRef}
          type="button"
          className="frame-header-editor__icon"
          aria-label={icon ? 'Change icon' : 'Add icon'}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          data-tooltip={icon ? 'Change icon' : 'Add icon'}
          onClick={() => setPickerOpen((o) => !o)}
        >
          {icon ? <Emoji native={icon} size={16} /> : <SmilePlus size={14} aria-hidden="true" />}
        </button>
        <input
          ref={nameRef}
          className="frame-header-editor__name"
          aria-label="Frame name"
          value={name}
          maxLength={80}
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value);
            nameComplete.sync();
          }}
          onSelect={nameComplete.sync}
          onKeyDown={keys(nameComplete)}
          {...nameComplete.fieldProps}
        />
      </div>
      <input
        ref={descRef}
        className="frame-header-editor__desc"
        aria-label="Frame description"
        placeholder="Add a description"
        value={desc}
        maxLength={MAX_FRAME_DESCRIPTION}
        onChange={(e) => {
          setDesc(e.target.value);
          descComplete.sync();
        }}
        onSelect={descComplete.sync}
        onKeyDown={keys(descComplete)}
        {...descComplete.fieldProps}
      />
      {nameComplete.menu}
      {descComplete.menu}
      <EmojiPickerPopover
        anchor={iconRef}
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          nameRef.current?.focus();
        }}
        label="Frame icon"
        current={icon}
        onPick={(native) => setIcon(native)}
        onRemove={icon ? () => setIcon(undefined) : undefined}
        removeLabel="Remove icon"
      />
    </div>,
    document.body
  );
};
