import React, { useEffect, useState } from 'react';
import { Html } from 'react-konva-utils';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { DEFAULT_TYPOGRAPHY, type TextBearingNode } from '../../engine/model/schema';
import { domTextStyle } from './renderers/shared';
import { STICKY_PADDING, THEMES } from './renderers/StickyRenderer';
import { measureStickyHeight, stickyFit, STICKY_FONT_FAMILY } from './renderers/stickyFit';
import { STICKY_LINE_HEIGHT } from '../../engine/model/stickyText';
import { chainSticky } from '../../engine/tools/stickyChain';

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
  const chainRef = React.useRef(false);
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

  /**
   * A sticky's size is fitted to what is being typed, live.
   *
   * Computed from `value` — the text in the box right now, not the committed
   * text — so the type resizes as you write, exactly as it will once you stop.
   * It goes through the same `stickyFit` the renderer uses; two independent
   * "close enough" implementations would make the words jump on commit.
   */
  const stickyBox = isSticky
    ? {
        width: node.width - STICKY_PADDING * 2,
        height: node.height - STICKY_PADDING * 2 - 18,
      }
    : null;
  const stickySize = stickyBox
    ? stickyFit(value, stickyBox.width, stickyBox.height).fontSize
    : 0;

  // How far down to push the first line so the block sits centred, in screen
  // pixels. Measured with the same Konva probe the renderer uses.
  const stickyTopPad = stickyBox
    ? Math.max(
        0,
        ((stickyBox.height - measureStickyHeight(value, stickySize, stickyBox.width)) / 2) * zoom
      )
    : 0;

  // Stickies render in a fixed handwriting face rather than carrying their own
  // typography; comments have none at all.
  const typography =
    node.type === 'sticky'
      ? {
          ...DEFAULT_TYPOGRAPHY,
          fontFamily: STICKY_FONT_FAMILY,
          // 600, not 700: only 400 and 600 of Caveat are loaded, and asking
          // for bold gets a synthesised one that does not match the canvas.
          fontWeight: 600,
          fontSize: stickySize,
          color: THEMES[node.theme]?.text ?? DEFAULT_TYPOGRAPHY.color,
          lineHeight: STICKY_LINE_HEIGHT,
          align: 'center' as const,
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

    // After the commit, so the note this chains from has its text saved before
    // the next one takes the caret.
    if (chainRef.current) {
      chainRef.current = false;
      if (node.type === 'sticky' && value.trim()) chainSticky(node);
    }
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
          // Which dimensions follow the text is the box's own setting. A
          // fixed box grows in neither, and an auto-height box grows only
          // downward — measuring both regardless is how a wrapped paragraph
          // used to widen itself out of the layout it was wrapped for.
          if (node.type === 'text' && node.resize !== 'fixed') {
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
            sizeRef.current = {
              width:
                node.resize === 'width' ? Math.max(40, el.scrollWidth / zoom) : sizeRef.current.width,
              height: Math.max(20, el.scrollHeight / zoom),
            };
          }
        }}
        // An auto-width box must not wrap while it is being typed into
        // either, or the caret sits on a line the canvas will not draw.
        wrap={node.type === 'text' && node.resize === 'width' ? 'off' : 'soft'}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            e.currentTarget.blur();
          }
          // Tab chains a new note beside this one and puts the caret in it, so
          // a run of ideas costs one keystroke each instead of a round trip to
          // the toolbar. A literal tab character in a sticky is worth nothing,
          // so nothing is lost by taking the key.
          if (e.key === 'Tab' && isSticky) {
            e.preventDefault();
            chainRef.current = true;
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
          // A fixed box truncates on the canvas, so the editor scrolls rather
          // than growing — the one mode where what you type can be longer than
          // what is shown.
          overflow: node.type === 'text' && node.resize === 'fixed' ? 'auto' : 'hidden',
          whiteSpace: node.type === 'text' && node.resize === 'width' ? 'pre' : 'pre-wrap',
          pointerEvents: 'auto',
          textAlign: node.type === 'shape' ? 'center' : typography.align,
          // A `<textarea>` cannot centre its content vertically, so the note's
          // padding is nudged instead: the gap above the first line is however
          // much of the box the text does not use. Without this the words sit
          // at the top while editing and snap to the middle on commit.
          ...(isSticky ? { paddingTop: `${stickyTopPad}px` } : null),
        }}
      />
    </Html>
  );
};
