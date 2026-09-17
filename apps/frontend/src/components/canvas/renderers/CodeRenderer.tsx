import React from 'react';
import { Group, Rect, Shape } from 'react-konva';
import type { CodeNode } from '../../../engine/model/schema';
import { layoutCode, measureCharWidth } from '../../../engine/code/codeLayout';
import { CODE_FONT, CODE_THEMES, CODE_UI_FONT } from '../../../engine/code/codeThemes';
import { languageById } from '../../../engine/code/codeLanguages';
import { useStore } from '../../../hooks/useStore';

/**
 * A code block on the canvas.
 *
 * ## Drawn, not composed
 *
 * One `Shape` with a scene function rather than a node per token. A two-hundred
 * line file is a few thousand coloured runs, and a Konva node each would be a
 * few thousand objects to hit-test and diff on every frame the board moves. The
 * scene function draws only the rows inside the viewport — the same culling the
 * table renderer does — so a long file costs what a short one does.
 *
 * ## Columns, not measured runs
 *
 * Each run is placed at `column × charWidth` rather than after the previous
 * run's measured width. In a monospace face the two are the same number, and
 * computing it from the column is what keeps the canvas, the in-place editor
 * and the exported SVG aligned to the character: all three place by column.
 */

function roundRect(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
}

const RADIUS = 12;

export const CodeRenderer: React.FC<{ node: CodeNode }> = ({ node }) => {
  const spec = node.code;
  const charWidth = measureCharWidth(spec.fontSize, CODE_FONT);
  const layout = React.useMemo(() => layoutCode(spec, node.width, charWidth), [spec, node.width, charWidth]);
  const editing = useStore((s) => s.codeEditNodeId === node.id);
  const theme = CODE_THEMES[spec.theme];
  const language = languageById(spec.language);

  const draw = React.useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const w = node.width;
      const h = node.height;
      const m = layout.metrics;

      ctx.save();
      roundRect(ctx, w, h, RADIUS);
      ctx.fillStyle = theme.background;
      ctx.fill();
      ctx.clip();

      // Header.
      ctx.fillStyle = theme.header;
      ctx.fillRect(0, 0, w, m.headerHeight);
      ctx.fillStyle = theme.border;
      ctx.fillRect(0, m.headerHeight - 1, w, 1);

      const mid = m.headerHeight / 2;
      const uiSize = Math.max(11, Math.round(m.fontSize * 0.9));
      ctx.textBaseline = 'middle';

      // The language, as a small chip in its own keyword colour: the one mark
      // that says "this is Python" before a single token is read.
      const chipText = language.label;
      ctx.font = `600 ${Math.round(uiSize * 0.86)}px ${CODE_UI_FONT}`;
      const chipW = ctx.measureText(chipText).width + uiSize * 1.1;
      const chipH = Math.round(uiSize * 1.55);
      const chipX = w - m.padX - chipW;
      ctx.fillStyle = theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';
      roundRect2(ctx, chipX, mid - chipH / 2, chipW, chipH, chipH / 2);
      ctx.fill();
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.fillText(chipText, chipX + chipW / 2, mid + 0.5);

      // The file, or failing that the line count, on the left.
      ctx.textAlign = 'left';
      const dotR = Math.max(3, Math.round(uiSize * 0.28));
      ctx.fillStyle = theme.tokens.keyword;
      ctx.beginPath();
      ctx.arc(m.padX + dotR, mid, dotR, 0, Math.PI * 2);
      ctx.fill();
      const titleX = m.padX + dotR * 2 + uiSize * 0.6;
      const title = spec.filename || `${layout.lineCount} ${layout.lineCount === 1 ? 'line' : 'lines'}`;
      ctx.font = `${spec.filename ? 600 : 500} ${uiSize}px ${CODE_UI_FONT}`;
      ctx.fillStyle = spec.filename ? theme.text : theme.muted;
      const room = chipX - titleX - uiSize;
      ctx.fillText(ellipsize(ctx, title, room), titleX, mid + 0.5);

      // Only the rows on screen.
      const t = ctx.getTransform();
      const scaleY = Math.hypot(t.b, t.d) || 1;
      const top = -t.f / scaleY;
      const bottom = (ctx.canvas.height / (window.devicePixelRatio || 1) - t.f) / scaleY;
      const lh = m.lineHeight;
      const baselineShift = lh / 2 + 0.5;
      const bodyBottom = h - (layout.hidden > 0 ? m.footerHeight : 0);

      for (const row of layout.rows) {
        if (row.y + lh < top - 4 || row.y > bottom + 4) continue;
        if (row.y > bodyBottom) break;
        if (row.highlighted) {
          ctx.fillStyle = theme.highlight;
          ctx.fillRect(0, row.y, w, lh);
          ctx.fillStyle = theme.highlightBar;
          ctx.fillRect(0, row.y, 3, lh);
        }
        if (spec.lineNumbers && row.first) {
          ctx.font = `${m.fontSize}px ${CODE_FONT}`;
          ctx.textAlign = 'right';
          ctx.fillStyle = row.highlighted ? theme.highlightBar : theme.gutter;
          ctx.fillText(String(row.lineNumber), m.padX + m.gutterWidth - m.fontSize, row.y + baselineShift);
        }
        if (editing) continue;
        ctx.textAlign = 'left';
        let col = 0;
        for (const token of row.tokens) {
          if (token.text.trim()) {
            ctx.font = `${token.kind === 'comment' ? 'italic ' : ''}${token.kind === 'heading' || token.kind === 'emphasis' ? '600 ' : ''}${m.fontSize}px ${CODE_FONT}`;
            ctx.fillStyle = theme.tokens[token.kind];
            ctx.fillText(token.text, layout.codeLeft + col * charWidth, row.y + baselineShift);
          }
          col += token.text.length;
        }
      }

      if (!spec.source && !editing) {
        ctx.font = `italic ${m.fontSize}px ${CODE_FONT}`;
        ctx.fillStyle = theme.gutter;
        ctx.textAlign = 'left';
        ctx.fillText('Double-click to write code, or paste some', layout.codeLeft, layout.contentTop + baselineShift);
      }

      // The fold: the rest of the file, one gesture away.
      if (layout.hidden > 0) {
        const fy = h - m.footerHeight;
        const fade = ctx.createLinearGradient(0, fy - lh * 1.5, 0, fy);
        fade.addColorStop(0, hexToRgba(theme.background, 0));
        fade.addColorStop(1, theme.background);
        ctx.fillStyle = fade;
        ctx.fillRect(0, fy - lh * 1.5, w, lh * 1.5);
        ctx.fillStyle = theme.header;
        ctx.fillRect(0, fy, w, m.footerHeight);
        ctx.fillStyle = theme.border;
        ctx.fillRect(0, fy, w, 1);
        ctx.font = `500 ${uiSize}px ${CODE_UI_FONT}`;
        ctx.fillStyle = theme.muted;
        ctx.textAlign = 'center';
        ctx.fillText(
          `${layout.hidden} more ${layout.hidden === 1 ? 'line' : 'lines'}  ·  double-click to open`,
          w / 2,
          fy + m.footerHeight / 2 + 0.5
        );
      }

      ctx.restore();

      roundRect(ctx, w, h, RADIUS);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    },
    [node.width, node.height, layout, theme, language, spec.filename, spec.lineNumbers, spec.source, editing, charWidth]
  );

  return (
    <Group>
      <Rect width={node.width} height={node.height} fill="rgba(0,0,0,0)" perfectDrawEnabled={false} />
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(context) => draw((context as unknown as { _context: CanvasRenderingContext2D })._context)}
      />
    </Group>
  );
};

function roundRect2(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  roundRect(ctx, w, h, r);
  ctx.restore();
}

const ellipsisCache = new Map<string, string>();

function ellipsize(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (room <= 8) return '';
  const key = `${ctx.font}|${Math.round(room)}|${text}`;
  const hit = ellipsisCache.get(key);
  if (hit !== undefined) return hit;
  let out = text;
  if (ctx.measureText(text).width > room) {
    let n = text.length;
    while (n > 0 && ctx.measureText(`${text.slice(0, n)}…`).width > room) n--;
    out = n > 0 ? `${text.slice(0, n)}…` : '';
  }
  if (ellipsisCache.size > 2000) ellipsisCache.clear();
  ellipsisCache.set(key, out);
  return out;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
