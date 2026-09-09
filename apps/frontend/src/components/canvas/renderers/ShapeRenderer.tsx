import React from 'react';
import { labelInk } from '../../../engine/model/labelInk';
import { Circle, Ellipse, Group, Label, Line, Path, Rect, Tag, Text } from 'react-konva';
import { DEFAULT_INK, isOpenShape, type ShapeNode } from '../../../engine/model/schema';
import { canvasFontFamily, konvaFontStyle, konvaTextDecoration, shadowProps, shadowSpreadProps, strokeColor, strokeDashProps, strokeWidth } from './shared';
import { useFillProps } from './useFillProps';
import { AlignedStroke, BackdropBlur, InnerShadow } from './ShapeEffects';
import { shapePath2D } from './shapePath2D';
import { shapeToPath } from '../../../engine/model/shapeToPath';
import { defaultEndAlign } from '../../../engine/model/linePath';
import { runPoints } from '../../../engine/model/lineEnds';
import { terminateRun } from '../../../engine/model/connectorEnds';
import { contourData } from '../../../engine/model/pathGeometry';
import { shapeFeaturePaths } from '../../../engine/model/shapeOutline';
import { roughShape } from '../../../engine/model/roughShape';
import { fillsInterior, roughEllipse, roughPolyline, seedFrom } from '../../../engine/model/rough';
import { ThemeService } from '../../../engine/ThemeService';
import { readableOnSurface } from '../../../engine/model/color';
import { useLiveTransform } from '../../../engine/model/liveTransformStore';
import { fontEpoch } from '../../../engine/text/fontEpoch';
import { ensureFontLoaded } from '../../../engine/text/measure';
import { cornerRadiiOf, fitRadii } from '../../../engine/model/cornerRadii';

interface Props {
  node: ShapeNode;
  /** Hidden while the DOM textarea overlay is active, to avoid double text. */
  showLabel: boolean;
}

/**
 * Shapes.
 *
 * Size comes exclusively from `node.width`/`node.height`; `geometry` says only
 * what form to draw. Previously `<Circle radius={w/2}>` was used for ellipses
 * and a single-radius `RegularPolygon`/`Star` for the rest, so height was
 * ignored outright — a wide ellipse snapped to a circle the moment the drag
 * committed, and resizing a hexagon on one axis did nothing at all.
 *
 * There are three primitives left: a `Rect`, an `Ellipse`, and a `Path` for
 * everything else. The polygon and star primitives were the last two that
 * rebuilt a shape rather than drawing the one `shapeOutline` describes, and
 * they went when polygons started filling their box — see the branch below.
 */
export const ShapeRenderer: React.FC<Props> = React.memo(({ node, showLabel }) => {
  const liveTransform = useLiveTransform(node.id);

  /**
   * Redraw the label when its real font arrives.
   *
   * A shape's label is a Konva `<Text>`, and Konva measures the string once
   * and keeps the result: line breaks, `textWidth`, and the offsets that
   * `align: 'center'` is computed from. Measure it while the webfont is still
   * loading and every one of those numbers describes the *fallback* face, so
   * the words sit slightly off-centre -- and nothing re-measures them when the
   * real face lands, because none of the props Konva watches has changed.
   *
   * That is the "text drifts left, and a reload fixes it" report: after a
   * reload the font is in the browser cache and wins the race, so the first
   * measurement is already the right one.
   *
   * `StickyRenderer` and `TextRenderer` both already do this; shape labels
   * were the third caller of the same measurement and the one that never got
   * the subscription. Diagrams generated from mermaid are made almost entirely
   * of shape labels, which is why they showed it most.
   */
  const epoch = React.useSyncExternalStore(fontEpoch.subscribe, fontEpoch.get, fontEpoch.get);
  const labelFamily = 'typography' in node ? node.typography?.fontFamily : undefined;
  // The weight travels with the family: a static face ships one file per
  // weight, so asking for the family alone fetches its Regular and measures a
  // label that is about to be drawn in Bold. See `ensureFontLoaded`.
  const labelWeight = 'typography' in node ? node.typography?.fontWeight : undefined;
  const labelItalic = 'typography' in node ? node.typography?.italic : undefined;
  React.useEffect(() => {
    // Ask for the face. Without this nothing requests it, so `document.fonts`
    // may never load it and the epoch never bumps -- the subscription above
    // would then be waiting for an event that no one had asked to happen.
    ensureFontLoaded(labelFamily, labelWeight, labelItalic);
  }, [labelFamily, labelWeight, labelItalic]);
  const w = node.width;
  const h = node.height;
  // Gradient geometry is unit-space against the shape's *own* box, and the two
  // primitives left here do not share an origin: a Rect and a Path are drawn
  // from the node's top-left, an Ellipse from its centre. Passing the right box
  // per branch is what keeps a top-to-bottom gradient running top to bottom on
  // both rather than starting halfway down the ellipse.
  const rectFill = useFillProps(node.appearance, { x: 0, y: 0, width: w, height: h }, '#4F46E5');
  const ellipseFill = useFillProps(node.appearance, { x: -w / 2, y: -h / 2, width: w, height: h }, '#4F46E5');
  const stroke = strokeColor(node.appearance);
  const sw = strokeWidth(node.appearance);
  const radius = liveTransform?.cornerRadius ?? node.appearance?.cornerRadius ?? 0;
  // Dash pattern and the cap that goes with it. Spread rather than passed as
  // two props, because a dotted pattern draws nothing without its round cap.
  const dashProps = strokeDashProps(node.appearance);
  // The shadow rides on the shape itself unless it has spread, which Konva has
  // no property for — then it rides on a copy drawn behind, and the shape
  // itself casts none.
  const spread = shadowSpreadProps(node.appearance);
  const shadow = spread ? {} : shadowProps(node.appearance);

  // An inside or outside stroke is not something a Konva primitive can draw,
  // so the primitive draws no stroke at all and `AlignedStroke` draws it
  // clipped to one side. Centred strokes take the ordinary path and cost
  // nothing extra, which is the case every existing document is in.
  // A line has no interior to clip to, so the two edge effects are simply not
  // available on one — the same rule the panel gates them by.
  const open = isOpenShape(node.geometry.kind);
  const align = node.appearance?.stroke?.align ?? 'center';
  const offCentre = !open && align !== 'center' && Boolean(stroke) && sw > 0;
  const innerShadow = open ? undefined : node.appearance?.innerShadow;
  const backdropBlur = open ? 0 : (node.appearance?.backdropBlur ?? 0);

  const effectiveNode = React.useMemo(() => {
    if (liveTransform?.cornerRadius === undefined) return node;
    return {
      ...node,
      appearance: {
        ...(node.appearance ?? {}),
        cornerRadius: radius,
      },
    };
  }, [node, liveTransform?.cornerRadius, radius]);

  // Built once and shared by both effects: `ctx.clip(path)` and
  // `ctx.fill(path, 'evenodd')` each take a path *object*, and building it
  // twice is how a clip and a fill end up describing marginally different
  // shapes. Only built when something needs it.
  const path = React.useMemo(
    () => (offCentre || innerShadow || backdropBlur > 0 ? shapePath2D(effectiveNode) : null),
    // The outline depends on the node's form and box, not on its paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offCentre, Boolean(innerShadow), backdropBlur > 0, effectiveNode.geometry, w, h, radius]
  );
  const primitiveStroke = offCentre ? undefined : stroke;

  /**
   * The hand-drawn branch.
   *
   * Taken instead of the primitive rather than on top of it: a sketched shape
   * is not a crisp shape with texture added, it is a different set of strokes,
   * and drawing both would show the ruled edge underneath the sketch. The
   * geometry is untouched, so turning roughness back off returns the exact
   * rectangle rather than an approximation of the one that was there.
   *
   * Memoised on the node's id, its box, its form and the roughness only —
   * everything the sketch is generated from. Re-running it on a colour change
   * would cost nothing visually and a lot per frame on a board full of them.
   */
  /**
   * The sketch, regenerated only when something it is generated *from* changes.
   *
   * The dependency list is load-bearing and was wrong: it carried `isSketch`, a
   * **boolean**, so switching a shape between Light, Medium and Heavy — or
   * between solid, hachure and cross-hatch — changed nothing the memo could
   * see, and it kept serving the geometry it had built the first time. Turning
   * the feature on and off worked, which is exactly what made it look like the
   * levels were unimplemented rather than uncached.
   *
   * The level and the fill style are named individually rather than depending
   * on `node.appearance`, which is a fresh object on every write and would
   * rebuild the sketch on every colour nudge.
   */
  const level = node.appearance?.sketch;
  const fillStyle = node.appearance?.fillStyle;
  const hasFill = Boolean(node.appearance?.fill?.length);
  const sketch = React.useMemo(
    () => (level ? roughShape(node, hasFill && !open) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, level, fillStyle, hasFill, w, h, node.geometry, open]
  );

  /**
   * The sketched silhouette as a `Path2D`, for the effects that need to clip.
   *
   * Built from the same string the solid fill paints, so an inner shadow falls
   * across the *drawn* edge rather than the ruled one underneath it.
   *
   * Only where the style fills its interior. That used to be carried by the
   * silhouette being empty for a pen-shaded shape, which is no longer true —
   * the hit region needs it for every filled shape — so the rule is now
   * stated. It matters because the panel withdraws the control rather than
   * disabling the field: a shape that was solid, given an inner shadow, and
   * then switched to hachure still has the value in its document, and this is
   * the thing that decides not to draw it.
   */
  const sketchPath = React.useMemo(
    () =>
      innerShadow && fillsInterior(fillStyle) && sketch?.silhouette
        ? new Path2D(sketch.silhouette)
        : null,
    [innerShadow, fillStyle, sketch?.silhouette]
  );

  /**
   * The label, however this shape is drawn.
   *
   * Declared once and used by both branches. The sketch branch returns before
   * the crisp one, so it had grown its own copy — a box-centred `Text`, which
   * is right for a rectangle and wrong for a line, whose box is a diagonal with
   * no interior. A sketched arrow's label therefore sat in empty space beside
   * the run rather than on it, and only when sketched.
   */
/**
   * The run, as the profile draws it.
   *
   * Straight gives back exactly `[0, 0, w, h]`, so the ordinary line is
   * unchanged and everything below — the caps, the trim, the sketcher —
   * carries on working on a two-point list without knowing profiles exist.
   *
   * `runPoints` is also where a *multi-point* line resolves into the same flat
   * list, bends sampled, so none of that machinery had to learn about vertices
   * either. One reader, one shape — see `lineEnds.localVertices`.
   */
  const profile = runPoints(node);
  const points = profile.flatMap((p) => [p.x, p.y]);

  /**
   * Where a line's label rides: the midpoint of the run it belongs to.
   *
   * Taken from the profile's own points, so it follows a wave or a coil rather
   * than floating at the centre of the rectangle that contains one.
   */
  const labelAt = ((): { x: number; y: number } => {
    if (!open || profile.length === 0) return { x: w / 2, y: h / 2 };
    // Interpolated rather than indexed. A straight line is *two* points, so
    // `points[length / 2]` is its second one — the label sat on the far end,
    // past the arrowhead. Halfway along the indices lands in the middle of a
    // two-point run and on the middle sample of a hundred-point one.
    const mid = (profile.length - 1) / 2;
    const lo = profile[Math.floor(mid)];
    const hi = profile[Math.ceil(mid)];
    const t = mid - Math.floor(mid);
    return { x: lo.x + (hi.x - lo.x) * t, y: lo.y + (hi.y - lo.y) * t };
  })();

  const plateFill = ThemeService.getCanvasPlateFill();
  const label =
    showLabel && node.text ? (
      open ? (
        /**
         * A label on a line sits on a plate the colour of the board, so it cuts
         * the stroke it crosses rather than fighting it.
         *
         * The ink is **checked against that plate rather than taken on trust**.
         * A line's label inherits the shape's typography colour, which is
         * arbitrary user colour, and a pale label on a light board is invisible
         * — the plate solves the *line* crossing the words and does nothing
         * about the words themselves. `readableOn` lifts the author's colour
         * toward legibility while keeping its hue, so a dark red label stays
         * recognisably red instead of being replaced with black.
         */
        <Label
          /**
           * The middle of the **run**, not the middle of the box.
           *
           * These were the same thing while a line's box was its endpoint
           * diagonal. They stopped being the same when the box became the
           * extent of what is drawn: a coil's box is as tall as its loops, so
           * the box centre is up among them, and a straight line's box is now
           * barely thicker than its stroke, so the centre is fine there and
           * nowhere else. Halfway along the drawn points is what "the middle
           * of this line" has always meant.
           */
          x={labelAt.x}
          y={labelAt.y}
          listening={false}
          // Counter-rotated so the words stay upright whatever the object does.
          // A label inherits the node's rotation and flips, and a line flipped
          // on both axes — which is simply a line drawn up-and-left — arrives
          // rotated 180°, so its label read upside down. Nobody wants a label
          // that tracks the geometry; a label is for reading.
          rotation={-(node.rotation ?? 0)}
          scaleX={node.scaleX < 0 ? -1 : 1}
          scaleY={node.scaleY < 0 ? -1 : 1}
          offsetX={0}
          offsetY={0}
        >
          <Tag fill={plateFill} cornerRadius={3} />
          {/*
            A tag, not a text block.

            This used to take its size, family, weight and colour from the
            node's full typography — the same machinery a paragraph uses. A
            line's label is not a paragraph. It is one or two words riding a
            hairline to say what the edge *means*: yes, no, retry, 40ms. Giving
            it a font picker, a weight, an alignment, a line height, a list
            style and a colour ramp offers a dozen decisions for a thing with
            one right answer, and every one of them is a way to make the label
            outweigh the line it belongs to.

            So it is fixed: small, semibold, upper case, on a plate. Upper case
            because at this size it is what reads as a *label* rather than as
            stray prose, and because it makes a two-letter tag hold its own
            against the run crossing behind it.

            The ink still tracks the line's own colour so the tag belongs to
            it, and is still lifted by `readableOn` — the plate solves the line
            crossing the words and does nothing about the words themselves, so
            a pale stroke's label would otherwise be invisible on a light
            board. Hue is kept; only lightness moves.
          */}
          <Text
            text={node.text.toUpperCase()}
            padding={3}
            fontSize={11}
            fontStyle="600"
            letterSpacing={0.4}
            // Against the *plate*, not against the board. `readableOn` assumes
            // a near-white or near-black surface; the plate is a mid-tone
            // panel, and a colour that clears 3:1 on white can be nearly
            // invisible on it. 4.5 rather than 3.2 because this is small text
            // now — 11px semibold is not the "large text" the lower bar is for.
            fill={readableOnSurface(stroke ?? DEFAULT_INK, plateFill)}
          />
        </Label>
      ) : node.typography ? (
        <Text
          /**
           * Keyed on the epoch so the node is rebuilt when the font changes.
           *
           * Konva only re-measures when an attribute it watches is set, and on
           * a font swap none of them has: same string, same family name, same
           * size. Re-creating the node is what forces the measurement to be
           * taken again, and it happens once or twice per session rather than
           * per frame.
           */
          key={`label-${epoch}`}
          width={w}
          height={h}
          text={node.text}
          fontSize={node.typography.fontSize}
          fontFamily={canvasFontFamily(node.typography.fontFamily)}
          fontStyle={konvaFontStyle(node.typography)}
          textDecoration={konvaTextDecoration(node.typography)}
          /* Derived from the node's own fill when nobody chose a colour, so
             a label on a dark shape is legible. Same input for every viewer,
             so this stays a document value -- see `labelInk`. */
          fill={labelInk(node) ?? node.typography.color}
          align={node.typography.align}
          verticalAlign={node.typography.verticalAlign}
          lineHeight={node.typography.lineHeight}
          letterSpacing={node.typography.letterSpacing}
          listening={false}
        />
      ) : null
    ) : null;

  /**
   * The run and its two markers, computed once for **both** branches.
   *
   * This lived inside the crisp branch, and the sketch branch had a second
   * copy of the cap placement that had never been updated: it took the box
   * corners as the endpoints and `atan2(h, w)` as the facing, so a sketched
   * wavy arrow put its head at the corner of the bounding box, pointing along
   * the diagonal, while the line it belonged to arrived somewhere else
   * entirely at some other angle.
   *
   * That is the same defect the exporter had, for the same reason — a third
   * place doing the arithmetic itself — and it is why this is hoisted rather
   * than fixed in place. One computation, two renderings of it.
   */

  const common = {
    points,
    stroke: stroke ?? DEFAULT_INK,
    strokeWidth: sw || 2,
    /**
     * No cap or join defaults here.
     *
     * These two lines used to sit above the spread and set `'round'` — but
     * `dashProps` always carries both keys, so an unset stroke spread
     * `undefined` straight over them and the line drew with butt caps and a
     * mitred join regardless. They had never once taken effect.
     *
     * Removing them rather than moving them below the spread is deliberate:
     * `PathRenderer` already settled that an absent cap means `butt` and an
     * absent join means `miter`, the way Canvas2D and SVG define them, and a
     * renderer that quietly disagreed was how flattening a rectangle used to
     * round its corners. Now the Cap and Join controls say what a stroke
     * does, and absent means absent everywhere.
     */
    ...dashProps,
    ...shadow,
    // The grab area for a hairline is otherwise the hairline itself.
    hitStrokeWidth: Math.max(20, sw),
  };
  /**
   * Six end styles, drawn the way a connector draws them.
   *
   * This was Konva's `Arrow` with two booleans, which can only ever produce
   * one shape of head — while a connector, made of the same two ends, offered
   * arrow, triangle, circle, diamond and bar. The style you could reach
   * depended on which tool had happened to make the run, and the properties
   * panel carried two different controls for the same question: a pair of raw
   * checkboxes on one, a proper picker on the other.
   *
   * `endCapShape` is that picker's geometry, and it is shared rather than
   * reimplemented — so a triangle on a line and a triangle on a connector are
   * the same triangle, at the same size, inset by the same amount.
   */
  const startKind = node.geometry.endStart ?? 'none';
  const endKind = node.geometry.endEnd ?? 'none';
  /**
   * The ends, placed by the alignment the line asks for.
   *
   * `terminateRun` owns both modes and the terminal tangent they share, so
   * the canvas, the SVG exporter and the toolbar specimen cannot disagree
   * about where a head sits or which way it faces — which they already did
   * once, when the exporter oriented its heads along the box diagonal.
   */
  const {
    run,
    start: startCap,
    end: endCap,
  } = terminateRun(points, {
    start: startKind,
    end: endKind,
    strokeWidth: sw || 2,
    scale: node.geometry.endScale,
    align: node.geometry.endAlign ?? defaultEndAlign(node.geometry.lineProfile),
  });

  if (sketch) {
    // The nib is the stroke weight, floored — a hairline sketch reads as a
    // rendering artefact rather than as a drawing, and the style's whole point
    // is a visible pen.
    const nib = Math.max(1.2, sw || 2);
    const inkColor = stroke ?? DEFAULT_INK;
    const fillPaint = node.appearance?.fill?.[0];

    /**
     * The end caps, drawn by hand like everything else in this branch.
     *
     * Built from `endCapShape`'s own points so a sketched head is the same
     * shape and size as a crisp one — only the strokes differ. Seeded off the
     * node's own seed plus the end, so the two ends of one line wander
     * differently while both staying stable across renders.
     */
    const sketchCaps: string[] = [];
    if (open) {
      const seed = seedFrom(node.id);
      // The very same two markers the crisp branch draws — position, facing,
      // size and alignment — only rendered by hand. Seeded off the node's seed
      // plus the end, so the two ends of one line wander differently while
      // both stay stable across renders.
      ([
        [startCap, seed ^ 0x11] as const,
        [endCap, seed ^ 0x22] as const,
      ]).forEach(([cap, capSeed]) => {
        if (!cap) return;
        if (cap.circle) {
          sketchCaps.push(
            roughEllipse(cap.circle.x, cap.circle.y, cap.circle.radius, cap.circle.radius, {
              seed: capSeed,
              level: node.appearance?.sketch,
              width: nib,
            })
          );
          return;
        }
        const pts = cap.points ?? [];
        const ring: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) ring.push({ x: pts[i], y: pts[i + 1] });
        if (ring.length < 2) return;
        sketchCaps.push(
          roughPolyline(ring, {
            seed: capSeed,
            // A filled head is a closed triangle; a bar or a plain arrow is an
            // open run and must not have its two ends joined.
            closed: Boolean(cap.filled),
            level: node.appearance?.sketch,
            width: nib,
          })
        );
      });
    }
    // Hachure takes the fill's *colour* and draws it as strokes. A gradient
    // has no single colour to shade with, so it keeps the ordinary fill and
    // only the outline is sketched.
    const hachureColor =
      fillPaint && fillPaint.type === 'solid' ? fillPaint.color : undefined;

    return (
      <Group>
        {/**
          * The hit region: the silhouette, painted in nothing.
          *
          * Every visible layer in this branch is `listening={false}` -- the
          * fill, the hachure strokes, the caps -- so the *only* thing that
          * could be clicked was the outline path and its `hitStrokeWidth`
          * band. A sketched shape was therefore live near its edge and dead
          * through the middle, where the crisp branch is live throughout,
          * because Konva takes a shape's hit area from what it fills and a
          * crisp shape fills its interior.
          *
          * Hachure and cross-hatch are where it bites hardest: those styles
          * paint the inside as *strokes*, so there is no filled area anywhere
          * and clicking the middle of a shape that plainly looks filled hits
          * the stage instead. The click then lands on empty canvas, which
          * clears the selection -- so the object appears to refuse selection
          * and refuse to move, rather than appearing to be missed.
          *
          * `fill="transparent"` is the whole trick. Konva paints the scene
          * with the declared fill (nothing, invisibly) but paints the *hit*
          * canvas with the shape's own colour key, so the interior becomes a
          * target without becoming a mark. Gated on `hasFill` so a hollow
          * sketched shape stays edge-only, which is what a hollow crisp one
          * does and what anyone would expect of an outline.
          *
          * **This did nothing for its own bug report for one commit.** The
          * element was right and `sketch.silhouette` was `''` for every style
          * except `solid` — so the one gate that could not pass was the one
          * standing between a hachured shape and its hit region. The test
          * beside it read the source and asserted this JSX existed, which it
          * did, so a vacuous check passed over an inert fix. `roughShape` now
          * produces the region for any filled shape and `sketchHitArea.test.ts`
          * asserts that against the real function rather than against the
          * markup that consumes it.
          */}
        {!open && hasFill && sketch.silhouette && (
          <Path data={sketch.silhouette} fill="transparent" perfectDrawEnabled={false} />
        )}
        {/* A solid fill paints the true silhouette, not the sketch: the drawn
            strokes are disjoint by design, so filling them would leave bites
            taken out of the shape wherever two failed to meet.

            `fillsInterior` is what keeps this to a solid fill. It used to be
            implied — the silhouette was only *produced* for a solid style, so
            this test could not fire for any other. The silhouette now exists
            for every filled shape because the hit region above needs it, so
            the condition that was doing this job invisibly has to be written
            down. Without it a hachured shape would paint solid and then draw
            its strokes on top of itself. */}
        {sketch.silhouette && hachureColor && fillsInterior(fillStyle) && (
          <Path
            data={sketch.silhouette}
            fill={hachureColor}
            opacity={fillPaint?.opacity ?? 1}
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
        {/*
          An inner shadow on a sketched shape, which used to be offered and
          then dropped.

          This branch returns before the crisp renderer's effects, so a
          sketched shape with an inner shadow set showed **nothing** — the
          control was in the panel, the value was in the document, and the one
          thing that had to honour it never ran. Exactly the failure the object
          registry exists to prevent, arrived at from the other direction.

          It is clipped to the **sketched silhouette**, not to the geometric
          outline. That distinction is the whole difficulty and it is the same
          one the solid fill already ran into: clip an inner shadow to the true
          rectangle and its edge is a ruled edge, so the shadow quietly redraws
          the crisp shape the sketch was drawn to replace, and the effect gives
          the game away from any normal distance.

          Only where there *is* an interior. Hachure, cross-hatch, zigzag and
          dots leave the shape open — there is no inside for a shadow to fall
          across — so the panel withdraws the control rather than letting it do
          nothing. See `supportsInnerShadow` in the appearance rules.
        */}
        {innerShadow && sketchPath && (
          <InnerShadow path={sketchPath} width={w} height={h} shadow={innerShadow} />
        )}
        {sketch.fill && hachureColor && (
          <Path
            data={sketch.fill}
            stroke={hachureColor}
            strokeWidth={
              node.appearance?.fillStyle === 'dots'
                ? (node.appearance?.sketch === 'heavy' ? 3.6 : node.appearance?.sketch === 'light' ? 2.2 : 2.8)
                : Math.max(0.8, nib * 0.7)
            }
            lineCap="round"
            lineJoin="round"
            opacity={fillPaint?.opacity ?? 1}
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
        {/* Sketched end caps.

            A sketched arrow lost its head entirely: the sketch branch returns
            before the crisp renderer's cap code, so the run was drawn by hand
            and the thing that made it an *arrow* simply was not there. An arrow
            with no head is a line, and silently.

            The caps are drawn by the same `roughPolyline` the outline uses, so
            the head is made of the same marks as the shaft rather than being a
            crisp triangle stuck on the end of a hand-drawn line — which reads
            worse than either treatment on its own. A circle cap is the one
            exception: it is sketched as a ring of samples, because a two-pass
            polyline around six points looks like a scribble, not a dot. */}
        {sketchCaps.map((d, i) => (
          <Path
            key={`cap-${i}`}
            data={d}
            stroke={inkColor}
            strokeWidth={nib}
            lineCap="round"
            lineJoin="round"
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
        <Path
          data={sketch.outline}
          stroke={inkColor}
          strokeWidth={nib}
          lineCap="round"
          lineJoin="round"
          // The dash pattern survives being sketched. Sketch answers "how are
          // the marks made" and dash answers "is the line broken" — they are
          // orthogonal, the panel offers them as two controls on that basis,
          // and a sketched outline that silently ignored the dash would make
          // that pair of controls a lie.
          dash={dashProps.dash}
          {...shadow}
          // The grab area for a set of loose strokes is otherwise the strokes
          // themselves, which is a much worse target than the crisp shape had.
          hitStrokeWidth={Math.max(20, nib * 3)}
          perfectDrawEnabled={false}
        />
        {label}
      </Group>
    );
  }

  let shape: React.ReactElement;

  if (open) {
    // Corner to corner of the box. Konva's `Arrow` is a `Line` that also draws
    // heads, so one branch covers both kinds — and a "line" with a head turned
    // on in the panel becomes an arrow without changing what it is, which is
    // how people actually use the two.
    const marker = (cap: typeof startCap, key: string) => {
      if (!cap) return null;
      const ink = stroke ?? DEFAULT_INK;
      if (cap.circle) {
        return (
          <Circle
            key={key}
            x={cap.circle.x}
            y={cap.circle.y}
            radius={cap.circle.radius}
            fill={cap.filled ? ink : undefined}
            stroke={ink}
            strokeWidth={sw || 2}
            listening={false}
          />
        );
      }
      return (
        <Line
          key={key}
          points={cap.points ?? []}
          closed={cap.filled}
          fill={cap.filled ? ink : undefined}
          stroke={ink}
          strokeWidth={sw || 2}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      );
    };

    /**
     * Round joins on a *sampled* profile.
     *
     * A wave is drawn as a run of short straight segments, and a mitred join
     * between two of them spikes wherever the direction changes quickly —
     * visible as a burr on every crest. A zigzag is exempt: its corners are
     * the shape, and rounding them is rounding the thing itself. The document
     * still decides for a straight line, which is where the cap and join
     * controls apply and where absent has always meant butt and mitre.
     */
    const sampled = (node.geometry.lineProfile ?? 'straight') !== 'straight'
      && node.geometry.lineProfile !== 'zigzag';

    shape = (
      <Group>
        <Line {...common} points={run} {...(sampled ? { lineJoin: 'round' as const, lineCap: 'round' as const } : null)} />
        {marker(startCap, 'start')}
        {marker(endCap, 'end')}
      </Group>
    );
  } else if (node.geometry.kind === 'rect') {
    /**
     * A number when the four agree, the array only when they do not.
     *
     * Konva's `Rect` takes either — but its scene function branches on
     * `if (!cornerRadius)`, and **an array is always truthy**. Handing it
     * `[0, 0, 0, 0]` for an ordinary square-cornered rectangle therefore moves
     * every such rectangle in the product off `context.rect()` and onto the
     * rounded-path walk with four zero-radius arcs. It draws the same shape,
     * and it is a different code path taken by the most common object on the
     * board for no reason at all.
     *
     * Fitted first, because Konva clamps each corner against the whole box
     * rather than against the pair sharing an edge — see `fitRadii`.
     */
    const fitted = fitRadii(cornerRadiiOf(radius), w, h);
    const konvaRadius = fitted.every((r) => r === fitted[0]) ? fitted[0] : fitted;
    shape = (
      <Rect
        width={w}
        height={h}
        {...rectFill}
        {...shadow}
        stroke={primitiveStroke}
        strokeWidth={sw}
        {...dashProps}
        cornerRadius={konvaRadius}
      />
    );
  } else if (node.geometry.kind === 'ellipse') {
    shape = (
      <Ellipse
        x={w / 2}
        y={h / 2}
        radiusX={w / 2}
        radiusY={h / 2}
        {...ellipseFill}
        {...shadow}
        stroke={primitiveStroke}
        strokeWidth={sw}
        {...dashProps}
      />
    );
  } else {
    /**
     * Everything else draws its own outline.
     *
     * Two Konva primitives used to sit here — `RegularPolygon` and `Star` —
     * each rebuilding the shape from a side count and a single radius, on a
     * square, stretched to the box. That was a faithful copy of what
     * `shapeOutline` did at the time and it stopped being one the moment
     * polygons were normalised to *fill* their box: the primitive would have
     * drawn the inscribed hexagon while the inside stroke, the inner shadow,
     * the hit region, the sketch and the exported file all drew the fitted
     * one. A stroke sliding out from under its own shape is precisely the
     * failure `shapeOutline`'s header describes.
     *
     * `Path` costs nothing next to them and removes the branch. It also fixes
     * a smaller thing the primitives forced: their gradient was measured
     * against the intermediate square and stretched with it, so a
     * top-to-bottom gradient on a wide hexagon did not run top to bottom.
     */
    const pathD = contourData(shapeToPath(effectiveNode));
    const mainPath = (
      <Path
        data={pathD}
        fillRule="evenodd"
        {...rectFill}
        {...shadow}
        stroke={primitiveStroke}
        strokeWidth={sw}
        {...dashProps}
      />
    );

    const featurePaths = shapeFeaturePaths(node, 0, 0);
    if (featurePaths.length > 0) {
      shape = (
        <Group>
          {mainPath}
          {featurePaths.map((featD, i) => (
            <Path
              key={`feat-${i}`}
              data={featD}
              stroke={primitiveStroke}
              strokeWidth={sw}
              {...dashProps}
              listening={false}
            />
          ))}
        </Group>
      );
    } else {
      shape = mainPath;
    }
  }

  return (
    <Group>
      {/* Spread is the shadow cast by a *grown* silhouette, so it is the same
          shape drawn once more underneath with a `2 * spread` stroke, in the
          shadow's colour, carrying the shadow props. Cloning rather than
          rebuilding keeps the two silhouettes identical by construction —
          a second hand-written copy is a second place for the star's point
          count to be forgotten. */}
      {spread && React.cloneElement(shape, spread)}
      {/* Beneath the fill, because frosted glass is the board seen *through*
          the shape — drawn on top it would hide the fill instead of sitting
          behind it. */}
      {path && backdropBlur > 0 && (
        <BackdropBlur path={path} width={w} height={h} radius={backdropBlur} />
      )}
      {shape}
      {/* Above the fill, because both effects describe what happens at the
          shape's edge — an inside stroke sits on top of the paint it borders,
          and an inner shadow is cast across it. */}
      {path && offCentre && stroke && (
        <AlignedStroke
          path={path}
          width={w}
          height={h}
          align={align as 'inside' | 'outside'}
          color={stroke}
          strokeWidth={sw}
          dash={dashProps.dash}
          cap={dashProps.lineCap as CanvasLineCap | undefined}
          join={dashProps.lineJoin as CanvasLineJoin | undefined}
          miterLimit={dashProps.miterLimit}
        />
      )}
      {path && innerShadow && (
        <InnerShadow path={path} width={w} height={h} shadow={innerShadow} />
      )}
      {/* A label on an open run rides the middle of the line, on its own plate.
          A line has no interior to centre text in — the shape branch below
          fills the node's whole box, which for a diagonal run puts the words
          nowhere near the line they belong to. The plate is what keeps them
          readable where they cross the stroke, which is exactly where they sit.
          Same construction a connector's label uses, for the same reason. */}
      {label}
    </Group>
  );
});

ShapeRenderer.displayName = 'ShapeRenderer';
