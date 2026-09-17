import React from 'react';
import { Check, ChevronDown, Copy, FoldVertical, ListOrdered, SquarePen, Sparkles, UnfoldVertical, Workflow, WrapText } from 'lucide-react';
import type { CodeNode } from '../../engine/model/schema';
import { useStore } from '../../hooks/useStore';
import { RailButton, RailMenuButton, Divider } from './RailBase';
import { RailPopover } from './RailPopover';
import { CODE_THEMES } from '../../engine/code/codeThemes';
import { CODE_THEME_IDS } from '../../engine/code/codeTypes';
import { languageById } from '../../engine/code/codeLanguages';
import { tokenize } from '../../engine/code/codeTokenize';
import { updateCode } from '../../engine/code/codeApply';
import { languageMenuEntries, pickCodeLanguage } from '../code/codeMenus';
import { withShortcut } from '../menu/shortcuts';

/** How many lines a folded block keeps showing. */
export const FOLD_AT = 12;

/**
 * What a selected code block puts on the rail.
 *
 * The decisions people make about a snippet on a board, in the order they make
 * them: what language it is, how it looks, whether to open it, whether to take
 * it away. The language leads as words, not an icon, because it is the one fact
 * about a block worth reading before anything else — and "Auto" beside it says
 * the board worked it out rather than someone choosing it.
 */
export const CodeRailSection: React.FC<{ node: CodeNode; onRenderDiagram: (source: string) => void }> = ({ node, onRenderDiagram }) => {
  const { code } = node;
  const language = languageById(code.language);
  const [copied, setCopied] = React.useState(false);
  const lineCount = code.source.split('\n').length;

  return (
    <>
      <div className="ctx-group">
        <RailMenuButton
          label="Language"
          trigger={
            <span className="ctx-trigger">
              {code.detected && <Sparkles size={12} aria-hidden style={{ color: 'var(--text-tertiary)' }} />}
              <span className="ctx-value" style={{ fontFamily: 'inherit', minWidth: 0 }}>{language.label}</span>
              <ChevronDown size={12} aria-hidden />
            </span>
          }
          entries={() =>
            languageMenuEntries(code.language, Boolean(code.detected), (pick) => pickCodeLanguage(node, pick))
          }
        />

        <RailPopover
          label="Theme"
          trigger={<span className="ctx-code-swatch" style={{ background: `linear-gradient(135deg, ${CODE_THEMES[code.theme].background} 50%, ${CODE_THEMES[code.theme].tokens.keyword} 50%)` }} />}
          align="start"
        >
          {(close) => (
            <>
              <span className="ctx-popover__label">Theme</span>
              <div className="ctx-code-themes">
                {CODE_THEME_IDS.map((id) => {
                  const theme = CODE_THEMES[id];
                  const sample = tokenize('const ok = await ship(42);', 'typescript')[0];
                  return (
                    <button
                      key={id}
                      type="button"
                      className="ctx-code-theme"
                      aria-pressed={code.theme === id}
                      onClick={() => {
                        updateCode(node, { theme: id });
                        close();
                      }}
                    >
                      <span className="ctx-code-theme__preview" style={{ background: theme.background, borderColor: theme.border }}>
                        {sample.map((t, i) => (
                          <span key={i} style={{ color: theme.tokens[t.kind] }}>{t.text}</span>
                        ))}
                      </span>
                      <span className="ctx-code-theme__name">
                        {theme.label}
                        {code.theme === id && <Check size={12} aria-hidden />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </RailPopover>
      </div>
      <Divider />

      <div className="ctx-group">
        <RailButton label="Edit code" hint={withShortcut('Edit code', 'Enter')} onClick={() => useStore.getState().setCodeEditNodeId(node.id)}>
          <SquarePen size={16} />
        </RailButton>
        <RailButton label="Wrap long lines" pressed={code.wrap} onClick={() => updateCode(node, { wrap: !code.wrap })}>
          <WrapText size={16} />
        </RailButton>
        <RailButton label="Line numbers" pressed={code.lineNumbers} onClick={() => updateCode(node, { lineNumbers: !code.lineNumbers })}>
          <ListOrdered size={16} />
        </RailButton>
        {(lineCount > FOLD_AT || code.maxLines) && (
          <RailButton
            label={code.maxLines ? 'Show every line' : `Fold to ${FOLD_AT} lines`}
            hint={code.maxLines ? `Show all ${lineCount} lines` : `Keep the first ${FOLD_AT} lines on show`}
            pressed={Boolean(code.maxLines)}
            onClick={() => updateCode(node, { maxLines: code.maxLines ? null : FOLD_AT })}
          >
            {code.maxLines ? <UnfoldVertical size={16} /> : <FoldVertical size={16} />}
          </RailButton>
        )}
        <RailButton
          label={copied ? 'Copied' : 'Copy code'}
          onClick={() => {
            void navigator.clipboard?.writeText(code.source).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </RailButton>
        {/* A Mermaid block is a diagram written down: one press draws it. */}
        {code.language === 'mermaid' && code.source.trim() && (
          <RailButton label="Render as diagram" hint="Draw this Mermaid on the board as shapes and arrows" onClick={() => onRenderDiagram(code.source)}>
            <Workflow size={16} />
          </RailButton>
        )}
      </div>
      <Divider />
    </>
  );
};
