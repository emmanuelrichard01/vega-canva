import { nanoid } from 'nanoid';
import { editor } from '../api/EditorAPI';
import { applyNodePatches, nextZIndex } from '../document';
import type { AnyNode, CodeNode } from '../model/schema';
import { defaultCodeSpec, type CodeSpec } from './codeTypes';
import { layoutCode, measureCharWidth, naturalCodeWidth } from './codeLayout';
import { CODE_FONT } from './codeThemes';
import { detectLanguage } from './codeDetect';
import { languageById, languageForFilename } from './codeLanguages';

/**
 * Making and changing code blocks, with their box kept honest.
 *
 * A code block's height is never set by hand: it is the height its lines take
 * at its width. Every write that could change that — the source, the font
 * size, wrapping, line numbers, the fold — goes through `updateCode`, which
 * re-measures in the same transaction, so the box on the canvas and the text in
 * it cannot disagree for even one frame.
 */

const charWidth = (fontSize: number) => measureCharWidth(fontSize, CODE_FONT);

export function fittedHeight(spec: CodeSpec, width: number): number {
  return layoutCode(spec, width, charWidth(spec.fontSize)).height;
}

/** A width a new block should open at: its longest line, within reason. */
export function openingWidth(spec: CodeSpec): number {
  return Math.round(Math.min(760, Math.max(380, naturalCodeWidth(spec, charWidth(spec.fontSize)) + 8)));
}

export function createCode(
  at: { x: number; y: number },
  source = '',
  options: Partial<CodeSpec> & { centred?: boolean; width?: number } = {}
): string {
  const detection = options.language ? null : source.trim() ? detectLanguage(source) : null;
  const language =
    options.language ??
    (options.filename ? languageForFilename(options.filename) : null) ??
    (detection && detection.language !== 'plaintext' ? detection.language : 'typescript');
  const spec: CodeSpec = {
    ...defaultCodeSpec(source, language),
    ...options,
    language,
    detected: !options.language && Boolean(detection && detection.language !== 'plaintext') ? true : undefined,
  };
  delete (spec as { centred?: boolean }).centred;
  delete (spec as { width?: number }).width;
  const width = options.width ?? openingWidth(spec);
  const height = fittedHeight(spec, width);
  const id = nanoid();
  editor.createNode({
    id,
    type: 'code',
    x: Math.round(options.centred === false ? at.x : at.x - width / 2),
    y: Math.round(options.centred === false ? at.y : at.y - height / 2),
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: nextZIndex(),
    code: spec,
  } as never);
  return id;
}

/** Write a change to a block's spec, re-fitting its height in the same write. */
export function updateCode(node: CodeNode, patch: Partial<CodeSpec>, extra: Partial<AnyNode> = {}): void {
  const spec = { ...node.code, ...patch };
  const width = (extra as { width?: number }).width ?? node.width;
  applyNodePatches([{ id: node.id, changes: { ...extra, code: spec, height: fittedHeight(spec, width) } }]);
}

/** Many blocks at once — the rail acting on a multiple selection. */
export function updateCodes(nodes: CodeNode[], patch: Partial<CodeSpec>): void {
  applyNodePatches(
    nodes.map((node) => {
      const spec = { ...node.code, ...patch };
      return { id: node.id, changes: { code: spec, height: fittedHeight(spec, node.width) } };
    })
  );
}

/** Width to the longest line, so nothing is cut off and nothing is air. */
export function fitCodeWidth(node: CodeNode): void {
  const width = openingWidth(node.code);
  updateCode(node, {}, { width });
}

export function toggleHighlight(node: CodeNode, line: number): void {
  const has = node.code.highlights.includes(line);
  updateCode(node, {
    highlights: has ? node.code.highlights.filter((n) => n !== line) : [...node.code.highlights, line].sort((a, b) => a - b),
  });
}

/** A file name for "Download", from the block's own or its language. */
export function codeFilename(spec: CodeSpec): string {
  if (spec.filename) return spec.filename.split(/[\\/]/).pop() || 'snippet.txt';
  const lang = languageById(spec.language);
  return lang.ext === 'Dockerfile' ? 'Dockerfile' : `snippet.${lang.ext}`;
}

export function downloadCode(spec: CodeSpec): void {
  const blob = new Blob([spec.source], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = codeFilename(spec);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The block as a Markdown fence, the way code moves between chat, docs and tickets. */
export function codeAsFence(spec: CodeSpec): string {
  const tag = spec.language === 'plaintext' ? '' : spec.language;
  const title = spec.filename ? ` title="${spec.filename}"` : '';
  return `\`\`\`${tag}${title}\n${spec.source}\n\`\`\``;
}
