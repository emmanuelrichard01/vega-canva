import React, { useEffect, useState } from 'react';
import { Html } from 'react-konva-utils';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { DEFAULT_TYPOGRAPHY, type TextBearingNode } from '../../engine/model/schema';
import { domTextStyle } from './renderers/shared';
import { STICKY_PADDING, THEMES } from './renderers/StickyRenderer';

interface Props {
  node: TextBearingNode;
  onCommit: (text: string, size?: { width: number; height: number }) => void;
  onCancel: () => void;
}

/**
 * The in-place text editor.
 *
 * Positioned in *screen* space from the camera rather than nested inside
 * Konva's transform tree. Deriving the position from the camera is what keeps
 * the caret glued to the object: react-konva-utils' `Html` composes its own
 * CSS transform from the node's absolute Konva transform, which drifted out of
 * alignment through nested offset/rotation groups, most visibly after any pan
 * or zoom.
 *
 * One component now covers text, shape labels, stickies and comments. There
 * used to be four near-identical inline textarea blocks in the renderer
 * switch, each with slightly different styling and commit behaviour — which is
 * how sticky editing ended up writing to a different field than the sticky
 * renderer read.
 */
export const NodeEditor: React.FC<Props> = ({ node, onCommit, onCancel }) => {
  const [value, setValue] = useState(node.text ?? '');
  const [, forceReposition] = useState(0);
  const cancelledRef = React.useRef(false);
  const sizeRef = React.useRef({ width: node.width, height: node.height });

  // Nothing else forces a re-render while the camera moves, so without this
  // the overlay would stay put while the canvas panned beneath it.
  useEffect(() => {
    const onCameraChange = () => forceReposition((n) => n + 1);
    engineEvents.on('CameraChanged', onCameraChange);
    return () => engineEvents.off('CameraChanged', onCameraChange);
  }, []);

  const zoom = cameraSystem.zoom;
  const screenX = node.x * zoom + cameraSystem.x;
  const screenY = node.y * zoom + cameraSystem.y;

  const isSticky = node.type === 'sticky';
  const padding = isSticky ? STICKY_PADDING * zoom : 0;

  // Stickies render in a fixed handwriting face rather than carrying their own
  // typography; comments have none at all.
  const typography =
    node.type === 'sticky'
      ? {
          ...DEFAULT_TYPOGRAPHY,
          fontFamily: 'Caveat, cursive',
          fontWeight: 700,
          fontSize: node.fontSize,
          color: THEMES[node.theme]?.text ?? DEFAULT_TYPOGRAPHY.color,
          lineHeight: 1.4,
        }
      : node.type === 'comment'
        ? { ...DEFAULT_TYPOGRAPHY, fontSize: 13 }
        : (node.typography ?? DEFAULT_TYPOGRAPHY);

  const handleBlur = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      onCancel();
      return;
    }
    onCommit(value, node.type === 'text' ? sizeRef.current : undefined);
  };

  return (
    <Html
      transform={false}
      divProps={{
        // `Html` assigns this via Object.assign(div.style, ...), not through
        // React's style diffing — so numeric values are NOT auto-suffixed with
        // "px" and are silently dropped by the CSSOM. Every length here must
        // be an explicit string.
        style: {
          position: 'fixed',
          left: `${screenX}px`,
          top: `${screenY}px`,
          width: `${node.width * zoom}px`,
          height: `${node.height * zoom}px`,
          padding: `${padding}px`,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          zIndex: '1000',
        },
      }}
    >
      <textarea
        autoFocus
        value={value}
        data-gramm="false"
        spellCheck={false}
        placeholder={node.type === 'text' ? 'Type something…' : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          // Bare text boxes grow with their content; containers (sticky,
          // shape, comment) wrap inside fixed bounds.
          if (node.type === 'text') {
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
            sizeRef.current = {
              width: Math.max(40, el.scrollWidth / zoom),
              height: Math.max(20, el.scrollHeight / zoom),
            };
          }
        }}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            e.currentTarget.blur();
          }
          // Stop canvas-level shortcuts (tool switches, delete) from firing
          // while typing.
          e.stopPropagation();
        }}
        style={{
          ...domTextStyle(typography),
          fontSize: `${typography.fontSize * zoom}px`,
          letterSpacing: `${typography.letterSpacing * zoom}px`,
          width: '100%',
          height: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: 0,
          margin: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          pointerEvents: 'auto',
          textAlign: node.type === 'shape' ? 'center' : typography.align,
        }}
      />
    </Html>
  );
};
