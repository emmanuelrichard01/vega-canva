import React from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  FoldHorizontal,
  FoldVertical,
  ListOrdered,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  UnfoldVertical,
  WrapText,
} from 'lucide-react';
import type { CodeNode } from '../../engine/model/schema';
import { RailButton, RailMenuButton } from './RailBase';
import { RailPopover } from './RailPopover';
import { CODE_THEMES } from '../../engine/code/codeThemes';
import { CODE_THEME_IDS } from '../../engine/code/codeTypes';
import { languageById } from '../../engine/code/codeLanguages';
import { tokenize } from '../../engine/code/codeTokenize';
import { fitCodeWidth, updateCode } from '../../engine/code/codeApply';
import { languageMenuEntries, pickCodeLanguage } from '../code/codeMenus';

/** How many lines a folded block keeps showing. */
export const FOLD_AT = 12;

/**
 * A code block's kind chip is its language, as words: the one fact about a
 * snippet worth reading first. The spark says the board detected it.
 */
export const CodeLanguageControl: React.FC<{ node: CodeNode }> = ({ node }) => {
  const { code } = node;
  const language = languageById(code.language);
  return (
    <RailMenuButton
      label="Language"
      trigger={
        <span className="rail-kind">
          {code.detected && <Sparkles size={12} aria-hidden className="rail-kind__spark" />}
          <span className="rail-kind__name">{language.label}</span>
          <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
        </span>
      }
      entries={() => languageMenuEntries(code.language, Boolean(code.detected), (pick) => pickCodeLanguage(node, pick))}
    />
  );
};

/** The block's theme is its paint: ground and keyword colour, split on the diagonal. */
export const CodeThemeControl: React.FC<{ node: CodeNode }> = ({ node }) => {
  const { code } = node;
  const current = CODE_THEMES[code.theme];
  return (
    <RailPopover
      label="Theme"
      trigger={
        <span
          className="ctx-code-swatch"
          style={{ background: `linear-gradient(135deg, ${current.background} 50%, ${current.tokens.keyword} 50%)` }}
        />
      }
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
                  aria-pressed={code.theme === id && !code.followBoard}
                  onClick={() => {
                    // An explicit pick is the theme as chosen, so it stops matching the board.
                    updateCode(node, { theme: id, followBoard: undefined });
                    close();
                  }}
                >
                  <span className="ctx-code-theme__preview" style={{ background: theme.background, borderColor: theme.border }}>
                    {sample.map((t, i) => (
                      <span key={i} style={{ color: theme.tokens[t.kind] }}>
                        {t.text}
                      </span>
                    ))}
                  </span>
                  <span className="ctx-code-theme__name">
                    {theme.label}
                    {code.theme === id && !code.followBoard && <Check size={12} aria-hidden />}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(code.followBoard)}
            className="ctx-popover__action"
            onClick={() => updateCode(node, { followBoard: code.followBoard ? undefined : true })}
          >
            <SunMoon size={14} />
            Match board
          </button>
        </>
      )}
    </RailPopover>
  );
};

export const CopyCodeButton: React.FC<{ source: string }> = ({ source }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <RailButton
      label={copied ? 'Copied' : 'Copy code'}
      onClick={() => {
        void navigator.clipboard?.writeText(source).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </RailButton>
  );
};

/** How the block is laid out: wrap, numbers, fold and width, as one popover of toggles. */
export const CodeViewControl: React.FC<{ node: CodeNode }> = ({ node }) => {
  const { code } = node;
  const lineCount = code.source.split('\n').length;
  const foldable = lineCount > FOLD_AT || Boolean(code.maxLines);
  return (
    <RailPopover label="Layout" trigger={<SlidersHorizontal size={16} />} align="start">
      <span className="ctx-popover__label">Layout</span>
      <div className="ctx-popover__toggles" role="group" aria-label="Code layout">
        <button
          type="button"
          role="switch"
          aria-checked={code.wrap}
          className="ctx-popover__action"
          onClick={() => updateCode(node, { wrap: !code.wrap })}
        >
          <WrapText size={14} />
          Wrap long lines
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={code.lineNumbers}
          className="ctx-popover__action"
          onClick={() => updateCode(node, { lineNumbers: !code.lineNumbers })}
        >
          <ListOrdered size={14} />
          Line numbers
        </button>
        {foldable && (
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(code.maxLines)}
            className="ctx-popover__action"
            onClick={() => updateCode(node, { maxLines: code.maxLines ? null : FOLD_AT })}
          >
            {code.maxLines ? <UnfoldVertical size={14} /> : <FoldVertical size={14} />}
            {code.maxLines ? `Folded to ${FOLD_AT} of ${lineCount} lines` : `Fold to ${FOLD_AT} lines`}
          </button>
        )}
        <button type="button" className="ctx-popover__action" onClick={() => fitCodeWidth(node)}>
          <FoldHorizontal size={14} />
          Fit width to the longest line
        </button>
      </div>
    </RailPopover>
  );
};

