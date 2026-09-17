import React from 'react';
import { Check, ChevronDown, Copy, Keyboard, ListOrdered, Minus, Plus, Sparkles, WrapText } from 'lucide-react';
import type { CodeNode } from '../../engine/model/schema';
import { useStore } from '../../hooks/useStore';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { textEditing } from '../../engine/interaction/textEditing';
import { layoutCode, measureCharWidth } from '../../engine/code/codeLayout';
import { CODE_FONT, CODE_THEMES, CODE_UI_FONT } from '../../engine/code/codeThemes';
import { CODE_THEME_IDS, type CodeSpec } from '../../engine/code/codeTypes';
import { languageById } from '../../engine/code/codeLanguages';
import { detectLanguage } from '../../engine/code/codeDetect';
import { tokenize } from '../../engine/code/codeTokenize';
import { fittedHeight } from '../../engine/code/codeApply';
import { backspace, indent, moveLines, newline, toggleComment, typeChar, type Edit } from '../../engine/code/codeEditing';
import { applyNodePatches } from '../../engine/document';
import { deleteNodesWithFrames } from '../../engine/interaction/frameMembership';
import { CodeTool } from '../../engine/tools/CodeTool';
import { PORTAL_SURFACE_ATTR, isInsidePortalSurface } from '../ui/portalSurface';
import { Menu } from '../menu/Menu';
import { languageMenuEntries } from './codeMenus';
import { IS_MAC, withShortcut } from '../menu/shortcuts';
import './code.css';

/**
 * A code block's source, open where the block is.
 *
 * ## The same pixels, now editable
 *
 * The editor is laid over the block at the camera's zoom and draws from the
 * same layout the canvas does — header, gutter, column grid, colours — so
 * opening it changes nothing on screen except that a caret appears. The text
 * is a transparent `<textarea>` over a highlighted `<pre>`: the browser keeps
 * doing the hard parts of text input (selection, IME, spellcheck-off, native
 * undo) and the highlighting is ours.
 *
 * ## Undo that survives our shortcuts
 *
 * Tab, Enter, bracket pairing and comment toggling change the text on the
 * editor's behalf. Assigning the textarea's value would wipe the browser's undo
 * history with every one of them, so edits are applied as `insertText` over
 * the smallest changed range instead — and Ctrl+Z undoes an auto-indent the
 * way it undoes a letter.
 *
 * ## Writing to the board
 *
 * The document is written a moment after typing pauses, not per keystroke:
 * collaborators see the code arrive in phrases rather than flickering in one
 * letter at a time, and the block's height grows with it. Closing writes
 * immediately. A block opened empty and closed empty removes itself, as a text
 * box does.
 */

const WRITE_DELAY = 220;

export const CodeEditor: React.FC<{ nodeId: string; onClose: () => void }> = ({ nodeId, onClose }) => {
  const node = useStore((s) => s.objects[nodeId]);
  React.useEffect(() => {
    if (!node || node.type !== 'code' || node.locked) onClose();
  }, [node, onClose]);
  if (!node || node.type !== 'code' || node.locked) return null;
  return <Editor node={node} onClose={onClose} />;
};

const Editor: React.FC<{ node: CodeNode; onClose: () => void }> = ({ node, onClose }) => {
  React.useEffect(() => {
    textEditing.begin(node.id);
    return () => textEditing.end(node.id);
  }, [node.id]);

  const [, reposition] = React.useState(0);
  React.useEffect(() => {
    const again = () => reposition((n) => n + 1);
    engineEvents.on('CameraChanged', again);
    engineEvents.on('ObjectMoved', again);
    window.addEventListener('resize', again);
    return () => {
      engineEvents.off('CameraChanged', again);
      engineEvents.off('ObjectMoved', again);
      window.removeEventListener('resize', again);
    };
  }, []);

  const [draft, setDraft] = React.useState(node.code.source);
  const openedWith = React.useRef(node.code.source);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const [caretLine, setCaretLine] = React.useState(1);
  const [menu, setMenu] = React.useState<DOMRect | null>(null);
  const [copied, setCopied] = React.useState(false);
  const pendingSelection = React.useRef<{ start: number; end: number } | null>(null);

  const spec: CodeSpec = React.useMemo(() => ({ ...node.code, source: draft }), [node.code, draft]);
  const theme = CODE_THEMES[spec.theme];
  const charWidth = measureCharWidth(spec.fontSize, CODE_FONT);
  // The whole file while editing: a fold is for reading, not for writing into.
  const layout = React.useMemo(() => layoutCode({ ...spec, maxLines: null }, node.width, charWidth), [spec, node.width, charWidth]);
  const m = layout.metrics;
  const lines = React.useMemo(() => tokenize(draft, spec.language), [draft, spec.language]);

  // ---- writing to the document -----------------------------------------------

  const latest = React.useRef({ node, draft });
  latest.current = { node, draft };

  const write = React.useCallback((source: string) => {
    const live = useStore.getState().objects[latest.current.node.id];
    if (!live || live.type !== 'code') return;
    let patch: Partial<CodeSpec> = { source };
    // A block reading its language from its code keeps doing so as it grows —
    // until someone picks one, which ends the guessing.
    if (live.code.detected !== false && (live.code.detected || !openedWith.current.trim())) {
      const found = detectLanguage(source);
      if (found.language !== 'plaintext' && found.score >= 4 && found.language !== live.code.language) {
        patch = { ...patch, language: found.language, detected: true };
      } else if (!live.code.detected && !openedWith.current.trim() && source.trim()) {
        patch = { ...patch, detected: true };
      }
    }
    const next = { ...live.code, ...patch, maxLines: live.code.maxLines };
    applyNodePatches([{ id: live.id, changes: { code: next, height: fittedHeight(next, live.width) } }]);
  }, []);

  React.useEffect(() => {
    if (draft === latest.current.node.code.source) return;
    const t = window.setTimeout(() => write(draft), WRITE_DELAY);
    return () => window.clearTimeout(t);
  }, [draft, write]);

  const close = React.useCallback(() => {
    const { node: live, draft: final } = latest.current;
    if (!final.trim() && !openedWith.current.trim()) {
      deleteNodesWithFrames([live.id]);
    } else if (final !== live.code.source) {
      write(final);
    }
    onClose();
  }, [onClose, write]);

  // Focus once, with the caret at the end of the code.
  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A press anywhere that is not the editor, its bar or a menu it opened closes it.
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || barRef.current?.contains(target)) return;
      if (isInsidePortalSurface(target) || (target as Element).closest?.('.menu-layer')) return;
      close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [close]);

  React.useLayoutEffect(() => {
    const sel = pendingSelection.current;
    const ta = textareaRef.current;
    if (sel && ta) {
      ta.setSelectionRange(sel.start, sel.end);
      pendingSelection.current = null;
    }
  });

  // ---- keys ------------------------------------------------------------------

  /** Apply an edit as native input over the smallest changed range, so undo keeps it. */
  const apply = (edit: Edit) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = ta.value;
    let prefix = 0;
    while (prefix < before.length && prefix < edit.text.length && before[prefix] === edit.text[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < edit.text.length - prefix &&
      before[before.length - 1 - suffix] === edit.text[edit.text.length - 1 - suffix]
    ) suffix++;
    const replacement = edit.text.slice(prefix, edit.text.length - suffix);
    ta.setSelectionRange(prefix, before.length - suffix);
    const ok = document.execCommand?.('insertText', false, replacement);
    if (!ok) {
      ta.setRangeText(replacement, prefix, before.length - suffix, 'end');
      setDraft(ta.value);
    }
    ta.setSelectionRange(edit.start, edit.end);
    pendingSelection.current = { start: edit.start, end: edit.end };
    trackCaret();
  };

  const trackCaret = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    setCaretLine(ta.value.slice(0, ta.selectionStart).split('\n').length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    const ta = e.currentTarget;
    const { value: text, selectionStart: start, selectionEnd: end } = ta;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape' || (mod && e.key === 'Enter') || (mod && e.key.toLowerCase() === 's')) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      apply(indent(text, start, end, e.shiftKey));
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      apply(newline(text, start, end, spec.language));
      return;
    }
    if (mod && (e.key === '/' || e.code === 'Slash')) {
      e.preventDefault();
      apply(toggleComment(text, start, end, spec.language));
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      apply(moveLines(text, start, end, e.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (e.key === 'Backspace' && !mod && !e.altKey) {
      const edit = backspace(text, start, end);
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
      return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      const edit = typeChar(text, start, end, e.key);
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
    }
  };

  // ---- spec changes from the bar -----------------------------------------------

  const patch = (changes: Partial<CodeSpec>) => {
    const live = useStore.getState().objects[node.id];
    if (!live || live.type !== 'code') return;
    const next = { ...live.code, source: latest.current.draft, ...changes };
    applyNodePatches([{ id: live.id, changes: { code: next, height: fittedHeight(next, live.width) } }]);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const toggleLine = (line: number) => {
    const has = spec.highlights.includes(line);
    patch({ highlights: has ? spec.highlights.filter((n) => n !== line) : [...spec.highlights, line].sort((a, b) => a - b) });
  };

  // ---- placement ---------------------------------------------------------------

  const zoom = cameraSystem.zoom || 1;
  const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
  const left = (stage?.left ?? 0) + node.x * zoom + cameraSystem.x;
  const top = (stage?.top ?? 0) + node.y * zoom + cameraSystem.y;
  const height = layout.height;

  const sidePanels = Array.from(document.querySelectorAll<HTMLElement>('.hierarchy-panel, .context-inspector'))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const freeLeft = Math.max(8, ...sidePanels.filter((r) => r.left < window.innerWidth / 2).map((r) => r.right + 8));
  const freeRight = Math.min(window.innerWidth - 8, ...sidePanels.filter((r) => r.left >= window.innerWidth / 2).map((r) => r.left - 8));
  const barWidth = barRef.current?.offsetWidth ?? 560;
  const barAbove = top - 52;
  const barTop = barAbove < 60 ? top + height * zoom + 10 : barAbove;
  const barLeft = Math.max(freeLeft, Math.min(left, freeRight - barWidth));

  const longest = Math.max(1, ...draft.split('\n').map((l) => l.replace(/\t/g, '  ').length));
  const codeAreaWidth = spec.wrap
    ? layout.columns * charWidth
    : Math.max(node.width - layout.codeLeft - m.padX, longest * charWidth + m.padX);
  const bodyHeight = layout.rows.length * m.lineHeight;
  const language = languageById(spec.language);

  const portal = { [PORTAL_SURFACE_ATTR]: 'code-editor' };

  return (
    <>
      <div ref={barRef} className="cded-bar" style={{ left: barLeft, top: barTop }} {...portal}>
        <button
          type="button"
          className="cded-bar__lang"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
        >
          {spec.detected && <Sparkles size={12} aria-hidden className="cded-bar__auto" />}
          {language.label}
          <ChevronDown size={13} aria-hidden />
        </button>
        <span className="cded-bar__sep" />
        <div className="cded-bar__themes" role="radiogroup" aria-label="Theme">
          {CODE_THEME_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={spec.theme === id}
              aria-label={CODE_THEMES[id].label}
              data-tooltip={CODE_THEMES[id].label}
              className="cded-bar__theme"
              style={{ background: `linear-gradient(135deg, ${CODE_THEMES[id].background} 50%, ${CODE_THEMES[id].tokens.keyword} 50%)` }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => patch({ theme: id })}
            />
          ))}
        </div>
        <span className="cded-bar__sep" />
        <button type="button" className="cded-bar__btn" aria-pressed={spec.wrap} data-tooltip="Wrap long lines" onPointerDown={(e) => e.preventDefault()} onClick={() => patch({ wrap: !spec.wrap })}>
          <WrapText size={15} />
        </button>
        <button type="button" className="cded-bar__btn" aria-pressed={spec.lineNumbers} data-tooltip="Line numbers" onPointerDown={(e) => e.preventDefault()} onClick={() => patch({ lineNumbers: !spec.lineNumbers })}>
          <ListOrdered size={15} />
        </button>
        <span className="cded-bar__sep" />
        <button type="button" className="cded-bar__btn" aria-label="Smaller text" data-tooltip="Smaller" disabled={spec.fontSize <= 9} onPointerDown={(e) => e.preventDefault()} onClick={() => patch({ fontSize: Math.max(9, spec.fontSize - 1) })}>
          <Minus size={14} />
        </button>
        <span className="cded-bar__size">{spec.fontSize}</span>
        <button type="button" className="cded-bar__btn" aria-label="Larger text" data-tooltip="Larger" disabled={spec.fontSize >= 32} onPointerDown={(e) => e.preventDefault()} onClick={() => patch({ fontSize: Math.min(32, spec.fontSize + 1) })}>
          <Plus size={14} />
        </button>
        <span className="cded-bar__sep" />
        <button
          type="button"
          className="cded-bar__btn"
          data-tooltip={copied ? 'Copied' : 'Copy code'}
          aria-label="Copy code"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            void navigator.clipboard?.writeText(draft).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <span
          className="cded-bar__btn cded-bar__keys"
          tabIndex={-1}
          data-tooltip={`Tab indents · ${IS_MAC ? '⌘' : 'Ctrl'}/ comments · ${IS_MAC ? '⌥' : 'Alt'}↑↓ moves a line · click a number to mark it`}
        >
          <Keyboard size={15} />
        </span>
        <button type="button" className="cded-bar__done" onPointerDown={(e) => e.preventDefault()} onClick={close} data-tooltip={withShortcut('Done', 'Esc')}>
          Done
        </button>
      </div>

      {menu && (
        <Menu
          label="Language"
          anchor={{ kind: 'rect', rect: menu, prefer: 'below', align: 'start' }}
          entries={languageMenuEntries(spec.language, Boolean(spec.detected), (pick) => {
            if (pick === 'auto') {
              const found = detectLanguage(latest.current.draft);
              patch({ language: found.language === 'plaintext' ? spec.language : found.language, detected: true });
            } else {
              CodeTool.language = pick;
              patch({ language: pick, detected: false });
            }
          })}
          onClose={() => {
            setMenu(null);
            textareaRef.current?.focus({ preventScroll: true });
          }}
        />
      )}

      <div
        ref={rootRef}
        className="cded"
        data-theme-dark={theme.dark || undefined}
        style={
          {
            left,
            top,
            width: node.width,
            height,
            transform: `scale(${zoom})`,
            '--cded-bg': theme.background,
            '--cded-header': theme.header,
            '--cded-border': theme.border,
            '--cded-text': theme.text,
            '--cded-muted': theme.muted,
            '--cded-gutter': theme.gutter,
            '--cded-hi': theme.highlight,
            '--cded-hi-bar': theme.highlightBar,
            '--cded-caret-line': theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(15,23,42,0.035)',
            '--cded-selection': theme.dark ? 'rgba(130,170,255,0.28)' : 'rgba(9,105,218,0.18)',
            fontFamily: CODE_UI_FONT,
          } as React.CSSProperties
        }
        {...portal}
      >
        <div className="cded__header" style={{ height: m.headerHeight, paddingInline: m.padX }}>
          <span className="cded__dot" style={{ background: theme.tokens.keyword }} />
          <input
            className="cded__filename"
            value={spec.filename ?? ''}
            placeholder="Add a file name"
            spellCheck={false}
            aria-label="File name"
            style={{ fontSize: Math.max(11, Math.round(m.fontSize * 0.9)) }}
            onChange={(e) => {
              const filename = e.target.value;
              const live = useStore.getState().objects[node.id];
              if (!live || live.type !== 'code') return;
              applyNodePatches([{ id: live.id, changes: { code: { ...live.code, source: latest.current.draft, filename: filename || undefined } } }]);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                textareaRef.current?.focus({ preventScroll: true });
              }
            }}
          />
          <span className="cded__lang" style={{ fontSize: Math.max(10, Math.round(m.fontSize * 0.78)) }}>
            {language.label}
          </span>
        </div>

        <div className="cded__body" style={{ top: layout.contentTop, height: bodyHeight }}>
          {layout.rows.map((row, i) =>
            row.highlighted || row.lineNumber === caretLine ? (
              <div
                key={`band-${i}`}
                className={row.highlighted ? 'cded__band cded__band--mark' : 'cded__band'}
                style={{ top: row.y - layout.contentTop, height: m.lineHeight }}
              />
            ) : null
          )}

          {spec.lineNumbers && (
            <div className="cded__gutter" style={{ left: m.padX, width: m.gutterWidth }}>
              {layout.rows.map((row, i) =>
                row.first ? (
                  <button
                    key={`n-${i}`}
                    type="button"
                    tabIndex={-1}
                    className="cded__num"
                    data-marked={row.highlighted || undefined}
                    data-current={row.lineNumber === caretLine || undefined}
                    title={row.highlighted ? 'Unmark this line' : 'Mark this line for attention'}
                    style={{ top: row.y - layout.contentTop, height: m.lineHeight, lineHeight: `${m.lineHeight}px`, fontSize: m.fontSize, paddingRight: m.fontSize }}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => toggleLine(row.lineNumber)}
                  >
                    {row.lineNumber}
                  </button>
                ) : null
              )}
            </div>
          )}

          <div className="cded__scroll" style={{ left: layout.codeLeft, right: spec.wrap ? undefined : 0, width: spec.wrap ? codeAreaWidth + 2 : undefined }}>
            <div className="cded__content" style={{ width: codeAreaWidth, height: bodyHeight }}>
              <pre
                className="cded__pre"
                aria-hidden
                style={{
                  fontSize: m.fontSize,
                  lineHeight: `${m.lineHeight}px`,
                  whiteSpace: spec.wrap ? 'pre-wrap' : 'pre',
                  wordBreak: spec.wrap ? 'break-all' : 'normal',
                }}
              >
                {lines.map((tokens, i) => (
                  <React.Fragment key={i}>
                    {tokens.map((t, k) => (
                      <span key={k} style={{ color: theme.tokens[t.kind], fontStyle: t.kind === 'comment' ? 'italic' : undefined, fontWeight: t.kind === 'heading' || t.kind === 'emphasis' ? 600 : undefined }}>
                        {t.text}
                      </span>
                    ))}
                    {i < lines.length - 1 ? '\n' : ' '}
                  </React.Fragment>
                ))}
              </pre>
              <textarea
                ref={textareaRef}
                className="cded__input"
                value={draft}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                aria-label={`${language.label} code`}
                wrap={spec.wrap ? 'soft' : 'off'}
                style={{
                  fontSize: m.fontSize,
                  lineHeight: `${m.lineHeight}px`,
                  whiteSpace: spec.wrap ? 'pre-wrap' : 'pre',
                  wordBreak: spec.wrap ? 'break-all' : 'normal',
                  caretColor: theme.text,
                }}
                onChange={(e) => {
                  setDraft(e.target.value.replace(/\t/g, '  '));
                  trackCaret();
                }}
                onKeyDown={onKeyDown}
                onKeyUp={trackCaret}
                onClick={trackCaret}
                onSelect={trackCaret}
                onPaste={(e) => e.stopPropagation()}
                onCopy={(e) => e.stopPropagation()}
                onCut={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// Font set on the monospace surfaces from one constant, so a change to the
// stack cannot leave the editor measuring a different face from the canvas.
if (typeof document !== 'undefined') {
  document.documentElement.style.setProperty('--code-font', CODE_FONT);
}
