import React, { useEffect, useState } from 'react';
import { Html } from 'react-konva-utils';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { consumePendingCaret } from '../../engine/interaction/pendingEdit';
import { textEditing } from '../../engine/interaction/textEditing';
import { DEFAULT_TYPOGRAPHY, type TextBearingNode } from '../../engine/model/schema';
import { STICKY_PADDING, THEMES } from '../../engine/model/stickyThemes';
import { textBox } from '../../engine/model/stickyFooter';
import { measureStickyHeight, stickyFit, STICKY_FONT_FAMILY } from './renderers/stickyFit';
import { STICKY_LINE_HEIGHT } from '../../engine/model/stickyText';
import { chainSticky } from '../../engine/tools/stickyChain';
import { domTextStyle } from './renderers/shared';

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
/**
 * How long after opening a blur is treated as part of the creating gesture.
 *
 * Comfortably longer than the press-to-release of a normal click, and far
 * shorter than any deliberate "I have decided not to write anything".
 */
const FOCUS_GRACE_MS = 600;

/** Enough for the gesture's own blur, not enough to trap the caret. */
const MAX_FOCUS_RECOVERIES = 2;

export const NodeEditor: React.FC<Props> = ({ node, onCommit, onCancel }) => {
  const [value, setValue] = useState(node.text ?? '');
  const [, forceReposition] = useState(0);
  const cancelledRef = React.useRef(false);
  const chainRef = React.useRef(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  /**
   * When this editor opened, and how many spurious blurs it has shrugged off.
   *
   * ## The bug this exists for
   *
   * Placing a sticky created the note on **pointerdown**, and the note is
   * discarded again if its editor closes while still empty — which is right,
   * because an empty note is a coloured square pretending to be content.
   *
   * But a real click is not instantaneous. Roughly a tenth of a second passes
   * between pressing and releasing, and that is long enough for React to mount
   * this editor and `autoFocus` to take the caret. The **pointerup** then lands
   * on the canvas underneath, focus leaves the textarea, `onBlur` fires, the
   * value is still empty — and the note the user just placed is deleted before
   * they could type a character. The activity feed had already announced it,
   * so the board reported adding a note that was not there.
   *
   * It is timing-dependent, which is why it looked intermittent and why
   * synthetic events never reproduced it: dispatching pointerdown and pointerup
   * in the same tick beats the editor to the mount, so no blur ever happens.
   *
   * A blur inside this window, with nothing typed, is the tail of the gesture
   * that created the note rather than a decision to abandon it. The caret is
   * taken back instead of the note being thrown away.
   */
  const openedAtRef = React.useRef(Date.now());
  const recoveredRef = React.useRef(0);
  const sizeRef = React.useRef({ width: node.width, height: node.height });
  /**
   * The box's size *while it is being typed into*.
   *
   * The overlay's own box was `node.width * zoom` — the committed width, which
   * does not change until you stop editing. So an auto-width box, whose entire
   * definition is "grows with the text", did not grow: it measured itself into
   * a ref, kept that to itself, and let the words run out of a container that
   * stayed exactly as wide as it started. An auto-height box had the same
   * problem downward.
   *
   * State rather than the ref because this has to re-render the thing it
   * describes; the ref stays, because the commit reads it and must not depend
   * on a render having happened.
   */
  const [liveSize, setLiveSize] = React.useState({ width: node.width, height: node.height });

  // A different node in the same editor starts from its own size.
  React.useEffect(() => {
    sizeRef.current = { width: node.width, height: node.height };
    setLiveSize({ width: node.width, height: node.height });
  }, [node.id, node.width, node.height]);

  // Announced so the rest of the canvas can react — the transform handles in
  // particular, which must not sit on top of the words being typed.
  useEffect(() => {
    textEditing.begin(node.id);
    return () => textEditing.end(node.id);
  }, [node.id]);

  /**
   * Take the caret to where the click was, if one asked for it.
   *
   * The click that opens this editor lands on the *canvas*, never on the
   * textarea — the textarea does not exist yet — so the browser has no idea
   * where in the sentence you were aiming. `ObjectRenderer` works that out from
   * the layout and leaves the offset in a latch; this collects it.
   *
   * Deferred a frame for the same reason the focus recovery below is: setting
   * a selection range on an element that is still being focused is discarded
   * by every browser, silently.
   */
  useEffect(() => {
    const caret = consumePendingCaret(node.id);
    if (caret === null) return;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const at = Math.max(0, Math.min(caret, el.value.length));
      el.setSelectionRange(at, at);
    });
  }, [node.id]);

  // Nothing else forces a re-render while the camera moves, so without this
  // the overlay would stay put while the canvas panned beneath it.
  useEffect(() => {
    const onCameraChange = () => forceReposition((n) => n + 1);
    engineEvents.on('CameraChanged', onCameraChange);
    return () => engineEvents.off('CameraChanged', onCameraChange);
  }, []);

  const zoom = cameraSystem.zoom;

  /**
   * Where the stage sits on the page.
   *
   * The overlay is `position: fixed`, so its coordinates are **viewport**
   * coordinates — but `cameraSystem.x/y` are **stage** coordinates, and the
   * stage does not start at the top-left of the window: the header is above it
   * and the ruler is to its left, putting its origin at roughly (22, 74).
   *
   * Those two frames were being used interchangeably, so the editor appeared
   * up and to the left of the object it belonged to — the caret floating on
   * bare canvas instead of sitting inside the note. Anything that moves the
   * stage's origin (collapsing a panel, hiding the rulers, resizing the
   * window) changed the size of the error, which is why it looked erratic.
   *
   * Read on every render rather than cached: this component already
   * re-renders on `CameraChanged`, and the value is one `getBoundingClientRect`
   * on a single element, only while something is actually being typed into.
   */
  const stageOrigin = (() => {
    const el = document.querySelector('.konvajs-content');
    const rect = el?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
  })();

  /**
   * A line's label is edited where it is drawn — at the middle of the run.
   *
   * Every other type fills its own box, and for a rectangle that is exactly
   * right. A line's box is the *diagonal* it spans, so placing the editor at
   * its top-left corner put the caret in empty canvas a long way from the
   * label: you typed up in the corner and the words jumped to the middle of
   * the line the moment you finished. The commit was correct and the editing
   * was somewhere else.
   *
   * The midpoint is the centre of the box whichever diagonal the line takes,
   * so this needs no knowledge of the flip. The overlay is sized to the words
   * rather than to the node, matching the plate the renderer draws.
   */
  const isOpenRun =
    node.type === 'shape' &&
    (node.geometry.kind === 'line' || node.geometry.kind === 'arrow');

  const runBox = isOpenRun
    ? {
        // Wide enough for a short label and no wider — a line's label is a
        // word or two ("yes", "retry"), and a full-width box would put the
        // caret nowhere near the text it is editing.
        width: Math.max(80, Math.min(240, (value.length || 4) * 9 + 24)),
        // The plate is the type plus its padding, matching the renderer's.
        height: Math.max(24, ((node.typography?.fontSize ?? DEFAULT_TYPOGRAPHY.fontSize) + 10)),
      }
    : null;

  const screenX = runBox
    ? stageOrigin.left + (node.x + node.width / 2) * zoom + cameraSystem.x - (runBox.width * zoom) / 2
    : stageOrigin.left + node.x * zoom + cameraSystem.x;
  const screenY = runBox
    ? stageOrigin.top + (node.y + node.height / 2) * zoom + cameraSystem.y - (runBox.height * zoom) / 2
    : stageOrigin.top + node.y * zoom + cameraSystem.y;

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
  const stickyBox =
    isSticky && node.type === 'sticky'
      ? textBox(node.width, node.height, STICKY_PADDING, node.tags.length > 0)
      : null;
  const stickySize = stickyBox
    ? stickyFit(value, stickyBox.width, stickyBox.height).fontSize
    : 0;

  /**
   * How far down to push the first line so the block sits where it is drawn.
   *
   * Two parts, and the first was missing. The **band above** — the tag strip,
   * and the padding — is where the renderer's text box begins; the editor was
   * starting at the plain padding, so a note with tags typed one strip higher
   * than it drew. The **centring** is the rest, measured with the same Konva
   * probe the renderer uses.
   *
   * That `stickyBox` now comes from `textBox` is the point of the whole
   * exercise: the comment above has always claimed the editor and the renderer
   * ask the same question, and until now it handed `stickyFit` a *different
   * box* — no footer band, no tag strip. Same function, different arguments,
   * so the words jumped the moment you clicked into a note anybody had reacted
   * to or tagged.
   */
  const stickyTopPad = stickyBox
    ? (stickyBox.y - STICKY_PADDING) * zoom +
      Math.max(
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

    /**
     * Take the caret back rather than commit an empty note out of existence.
     *
     * Bounded twice over — a short window, and a retry cap — so this can never
     * become an editor that refuses to close. Past either bound a blur means
     * what it has always meant.
     */
    if (
      !value.trim() &&
      recoveredRef.current < MAX_FOCUS_RECOVERIES &&
      Date.now() - openedAtRef.current < FOCUS_GRACE_MS
    ) {
      recoveredRef.current += 1;
      // Deferred to the next frame: focusing from inside the blur handler is
      // re-entrant and browsers may discard it while the old focus is still
      // being torn down.
      requestAnimationFrame(() => textareaRef.current?.focus());
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
          width: `${(runBox?.width ?? liveSize.width) * zoom}px`,
          height: `${(runBox?.height ?? liveSize.height) * zoom}px`,
          padding: `${padding}px`,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          zIndex: '1000',
        },
      }}
    >
      <textarea
        ref={textareaRef}
        autoFocus
        value={value}
        data-gramm="false"
        spellCheck={false}
        /**
         * Short, because the box it sits in is provisional.
         *
         * "Type something…" needs about 200px at the default size — and the
         * placeholder scales with the node's own font size, so at 48pt it
         * wants closer to 600. No seed width can fit that, which is why the
         * hint was always clipped mid-word. The caret is already visible and
         * already says the box is ready; the word only has to confirm it.
         */
        placeholder={node.type === 'text' ? 'Type…' : undefined}
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
            const next = {
              width:
                node.resize === 'width' ? Math.max(40, el.scrollWidth / zoom) : sizeRef.current.width,
              height: Math.max(20, el.scrollHeight / zoom),
            };
            sizeRef.current = next;
            // Grow the overlay with the words, so what you are typing into is
            // the box you are actually making.
            setLiveSize(next);
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
          // A line's label sits on a plate the colour of the board, so the
          // editor wears the same ground — otherwise the words are being typed
          // over the stroke they are meant to interrupt.
          ...(runBox
            ? {
                background: 'var(--surface-primary)',
                borderRadius: `${3 * zoom}px`,
                textAlign: 'center' as const,
              }
            : null),
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
