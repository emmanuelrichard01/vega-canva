import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { updateNode } from '../../engine/document';
import { canEditObjects } from '../../engine/model/permissions';
import { nodeBounds } from '../../engine/model/selection';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import './frameName.css';

/** Ask for a frame's name to be edited in place. Sent by the name label on double-click. */
export function requestFrameRename(id: string): void {
  window.dispatchEvent(new CustomEvent('renameFrame', { detail: { id } }));
}

/**
 * The in-place editor for a frame's name, laid over its label.
 *
 * Single line: Enter or leaving the field commits, Escape cancels. A blank name
 * is not a name, so it keeps the one the frame has. Editors only, because the
 * name is part of the document.
 */
export const FrameNameEditor: React.FC = () => {
  const [id, setId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const onRename = (e: Event) => {
      const target = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!target || !canEditObjects()) return;
      doneRef.current = false;
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

  const frame = useStore((s) => {
    const node = id ? (s.objects as Record<string, AnyNode>)[id] : undefined;
    return node?.type === 'frame' ? (node as FrameNode) : undefined;
  });

  useEffect(() => {
    if (id && !frame) setId(null);
  }, [id, frame]);

  useEffect(() => {
    if (!id) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [id]);

  if (!id || !frame) return null;

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = inputRef.current?.value.trim();
    if (commit && next && next !== frame.title) updateNode(frame.id, { title: next });
    setId(null);
  };

  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const box = nodeBounds(frame);
  const left = (stage?.left ?? 0) + box.x * cameraSystem.zoom + cameraSystem.x;
  const top = (stage?.top ?? 0) + box.y * cameraSystem.zoom + cameraSystem.y - 26;

  return ReactDOM.createPortal(
    <input
      ref={inputRef}
      className="frame-name-input"
      aria-label="Frame name"
      defaultValue={frame.title ?? 'Frame'}
      maxLength={80}
      spellCheck={false}
      style={{ left, top, width: Math.min(320, Math.max(140, box.width * cameraSystem.zoom)) }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      }}
    />,
    document.body
  );
};
