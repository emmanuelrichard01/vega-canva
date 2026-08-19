import React from 'react';
import { Group, Path, Rect, Text } from 'react-konva';
import type { TextNode } from '../../../engine/model/schema';
import { updateNode } from '../../../engine/document';
import { applyTextCase } from '../../../engine/model/textCase';
import { contrastInk } from '../../../engine/model/color';
import { layoutText, type TextLayout } from '../../../engine/text/layout';
import { measurerFor, textFontEpoch } from '../../../engine/text/measure';
import { highlightPath } from '../../../engine/text/highlight';
import { konvaFontStyle, konvaTextDecoration, shadowProps } from './shared';

interface Props {
  node: TextNode;
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  visible: boolean;
}

/**
 * Text, laid out here and drawn line by line.
 *
 * This used to be a single `Konva.Text` holding the whole string, which draws
 * words and gives you nothing to work with afterwards. Every feature the
 * specification had parked — paragraph spacing, the rounded per-line
 * highlight, an outline, a glow, honest vertical alignment — needed the same
 * missing thing: **where each line is and how wide it is**. `engine/text/layout`
 * computes that once and everything here consumes the same numbers, so the
 * highlight behind a line and the glyphs on top of it can never disagree
 * about where that line was.
 *
 * One `Konva.Text` per line, positioned absolutely with `wrap="none"`, rather
 * than a `sceneFunc` calling `fillText`. Konva's text node already handles the
 * font shorthand, the decorations and the device pixel ratio; re-implementing
 * that to save a node per line would be trading correctness for an allocation
 * that React reconciles anyway.
 */
export const TextRenderer: React.FC<Props> = React.memo(({ node, visible }) => {
  const t = node.typography;

  // Re-run the layout when the real font lands. Everything measured against a
  // fallback face wrapped in the wrong place; see `textFontEpoch`.
  const fontEpoch = React.useSyncExternalStore(textFontEpoch.subscribe, textFontEpoch.get);

  const layout: TextLayout = React.useMemo(() => {
    const body = applyTextCase(node.text, t.textCase);
    return layoutText({
      text: body,
      // Auto width means no wrapping at all: the box is as wide as the longest
      // line, which is what a label wants.
      wrap: node.resize === 'width' ? 'none' : 'word',
      width: node.width,
      // Only `fixed` imposes a height — the other two grow downward, and
      // handing them one would truncate text the box was meant to follow.
      height: node.resize === 'fixed' ? node.height : undefined,
      fontSize: t.fontSize,
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      paragraphSpacing: t.paragraphSpacing,
      align: t.align,
      verticalAlign: t.verticalAlign,
      ellipsis: node.resize === 'fixed',
      measure: measurerFor(t),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.text, node.resize, node.width, node.height, t, fontEpoch]);

  /**
   * Keep the stored box in step with the text that is actually drawn.
   *
   * `width`/`height` are the document's only source of bounds — selection, the
   * handles, marquee hit-testing, culling, the radar and every exporter read
   * them and nothing else — but an auto-width box takes its width from its own
   * content, so something has to write the measurement back.
   *
   * This now comes from the layout rather than from asking a Konva node what
   * it did after the fact, which removes the last place two measurement
   * engines had to agree: the editor overlay used the textarea's `scrollWidth`
   * while the canvas used Konva's metrics, and they agreed only by luck.
   *
   * Deferred and guarded because it is a CRDT write: it waits for the size to
   * settle rather than firing per keystroke, and only writes on a real
   * difference — otherwise every client watching the board writes the same
   * numbers back at each other forever.
   */
  React.useEffect(() => {
    if (!visible || node.resize === 'fixed') return;
    // An empty box has nothing to measure and must not be measured: collapsing
    // a brand-new node to a hairline takes the editor overlay with it, since
    // the overlay is sized from the node.
    if (!node.text) return;

    const width = node.resize === 'width' ? layout.width : node.width;
    const height = layout.height;
    if (Math.abs(width - node.width) < 0.5 && Math.abs(height - node.height) < 0.5) return;

    const timer = window.setTimeout(() => {
      updateNode(node.id, { width: Math.max(1, width), height: Math.max(1, height) });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [node.id, node.resize, node.width, node.height, node.text, layout, visible]);

  if (!visible) return null;

  const highlight = t.highlight;
  // A highlight is chosen for how it reads against the *board*; the words then
  // have to stay legible against the highlight, which is a different question.
  // `autoContrast` answers it from the fill rather than leaving it to whoever
  // picked the colour.
  const ink =
    highlight && highlight.autoContrast ? contrastInk(highlight.color) : t.color;

  const outline = t.outline;
  const glow = t.glow;

  // The glyph shadow and the glow are the same Konva mechanism, and a node can
  // only carry one. The glow wins where both are set, because it is the more
  // deliberate of the two — nobody turns a glow on by accident.
  const halo = glow
    ? { shadowColor: glow.color, shadowBlur: glow.blur, shadowOpacity: 1, shadowOffset: { x: 0, y: 0 } }
    : shadowProps(node.appearance);

  const common = {
    fontSize: t.fontSize,
    fontFamily: t.fontFamily,
    // Weight and slant are composed into Konva's single fontStyle string in
    // exactly one place — see shared.ts.
    fontStyle: konvaFontStyle(t),
    textDecoration: konvaTextDecoration(t),
    letterSpacing: t.letterSpacing,
    // Every line is already positioned and already fits: wrapping here would
    // be a second, disagreeing opinion about where the breaks go.
    wrap: 'none' as const,
    listening: false,
  };

  return (
    <Group>
      {/*
        The hit area, and the whole node's presence in Konva's hit graph.

        Every drawn element below is `listening={false}`, because a click has to
        land on *the node* and not on whichever line of type happens to be under
        the pointer — with per-line text nodes, the gaps between lines and the
        ragged space beside a short line would otherwise be holes you could
        click straight through.

        This regressed when text moved from one `Konva.Text` to a line per row:
        the single text node had been the hit shape, and nothing replaced it, so
        a text node could be created and then never selected or dragged again.
        `AudioRenderer` needs the same rectangle for the same reason, and says
        so in its own header.

        Sized to the larger of the stored box and the measured layout, so the
        target is correct in the window before the derived-bounds write settles
        rather than lagging a frame behind the words.
      */}
      <Rect
        width={Math.max(node.width, layout.width)}
        height={Math.max(node.height, layout.height)}
        fill="transparent"
      />
      {highlight && layout.lines.length > 0 && (
        <Path
          data={highlightPath(layout.lines, highlight)}
          fill={highlight.color}
          listening={false}
          // Drawn as one path rather than one node per line so the tucked
          // corners are part of a single outline — separate plates leave a
          // hairline seam wherever two of them share an edge, which shows the
          // moment the fill is not fully opaque.
          perfectDrawEnabled={false}
        />
      )}
      {layout.lines.map((line, i) => (
        <React.Fragment key={i}>
          {/* The outline is drawn as its own pass beneath the fill, because a
              stroke centred on the letterforms eats into them from both sides
              — half the weight lands inside the glyph. Drawing the stroked
              copy first and the filled copy over it leaves the whole stroke
              outside the shape, which is what an outline is supposed to be. */}
          {outline && outline.width > 0 && (
            <Text
              {...common}
              {...halo}
              x={line.x}
              y={line.y}
              text={line.text}
              fill={undefined}
              stroke={outline.color}
              strokeWidth={outline.width * 2}
              fillAfterStrokeEnabled
            />
          )}
          <Text
            {...common}
            {...(outline && outline.width > 0 ? {} : halo)}
            x={line.x}
            y={line.y}
            text={line.text}
            fill={ink}
          />
        </React.Fragment>
      ))}
    </Group>
  );
});

TextRenderer.displayName = 'TextRenderer';
