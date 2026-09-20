import { layoutCode } from './codeLayout';
import { CODE_FONT, CODE_THEMES, CODE_UI_FONT } from './codeThemes';
import { languageById } from './codeLanguages';
import type { CodeSpec } from './codeTypes';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A code block as SVG, from the layout the canvas draws.
 *
 * Real `<text>` with a `<tspan>` per coloured run, not a picture of text: an
 * exported code block should still be selectable and searchable in whatever
 * opens the file, which is most of the reason to export code as vector.
 */
export function codeToSvg(spec: CodeSpec, width: number, height: number, id: string): string {
  const theme = CODE_THEMES[spec.theme];
  const layout = layoutCode(spec, width);
  const m = layout.metrics;
  const clip = `code-clip-${id.replace(/[^\w-]/g, '')}`;
  const title = spec.filename || languageById(spec.language).label;
  const parts: string[] = [
    `<defs><clipPath id="${clip}"><rect width="${width}" height="${height}" rx="12"/></clipPath></defs>`,
    `<g clip-path="url(#${clip})">`,
    `<rect width="${width}" height="${height}" fill="${theme.background}"/>`,
    `<rect width="${width}" height="${m.headerHeight}" fill="${theme.header}"/>`,
    `<line x1="0" y1="${m.headerHeight}" x2="${width}" y2="${m.headerHeight}" stroke="${theme.border}"/>`,
    `<text x="${m.padX}" y="${m.headerHeight / 2}" dominant-baseline="central" font-family="${esc(CODE_UI_FONT)}" font-size="${Math.round(m.fontSize * 0.92)}" font-weight="600" fill="${theme.muted}">${esc(title)}</text>`,
  ];

  for (const row of layout.rows) {
    if (row.y > height) break;
    if (row.highlighted) {
      parts.push(`<rect x="0" y="${row.y}" width="${width}" height="${m.lineHeight}" fill="${theme.highlight}"/>`);
      parts.push(`<rect x="0" y="${row.y}" width="3" height="${m.lineHeight}" fill="${theme.highlightBar}"/>`);
    }
    const baseline = row.y + m.lineHeight / 2;
    if (spec.lineNumbers && row.first) {
      parts.push(
        `<text x="${m.padX + m.gutterWidth - m.fontSize}" y="${baseline}" text-anchor="end" dominant-baseline="central" font-family="${esc(CODE_FONT)}" font-size="${m.fontSize}" fill="${row.highlighted ? theme.highlightBar : theme.gutter}">${row.lineNumber}</text>`
      );
    } else if (spec.lineNumbers && !row.first) {
      parts.push(
        `<text x="${m.padX + m.gutterWidth - m.fontSize}" y="${baseline}" text-anchor="end" dominant-baseline="central" font-family="${esc(CODE_FONT)}" font-size="${Math.round(m.fontSize * 0.82)}" fill="${theme.gutter}">↳</text>`
      );
    }
    const spans = row.tokens
      .map((t) => `<tspan fill="${theme.tokens[t.kind]}"${t.kind === 'comment' ? ' font-style="italic"' : ''}>${esc(t.text)}</tspan>`)
      .join('');
    if (spans) {
      parts.push(
        `<text x="${layout.codeLeft}" y="${baseline}" dominant-baseline="central" xml:space="preserve" font-family="${esc(CODE_FONT)}" font-size="${m.fontSize}">${spans}</text>`
      );
    }
  }

  if (layout.hidden > 0) {
    const y = height - m.footerHeight;
    parts.push(`<rect x="0" y="${y}" width="${width}" height="${m.footerHeight}" fill="${theme.header}"/>`);
    parts.push(
      `<text x="${width / 2}" y="${y + m.footerHeight / 2}" text-anchor="middle" dominant-baseline="central" font-family="${esc(CODE_UI_FONT)}" font-size="${Math.round(m.fontSize * 0.9)}" fill="${theme.muted}">${layout.hidden} more ${layout.hidden === 1 ? 'line' : 'lines'}</text>`
    );
  }

  parts.push('</g>');
  parts.push(`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="${theme.border}"/>`);
  return parts.join('');
}
