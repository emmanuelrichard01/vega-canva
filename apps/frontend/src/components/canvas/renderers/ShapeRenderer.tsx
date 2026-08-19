import React from 'react';
import { Circle, Ellipse, Group, Label, Line, Path, Rect, RegularPolygon, Star, Tag, Text } from 'react-konva';
import { ARROW_HEAD_SCALE, DEFAULT_INK, isOpenShape, type ShapeNode } from '../../../engine/model/schema';
import { konvaFontStyle, konvaTextDecoration, shadowProps, shadowSpreadProps, strokeColor, strokeDashProps, strokeWidth } from './shared';
import { useFillProps } from './useFillProps';
import { AlignedStroke, BackdropBlur, InnerShadow } from './ShapeEffects';
import { shapePath2D } from './shapePath2D';
import { shapeToPath } from '../../../engine/model/shapeToPath';
import { linePoints } from '../../../engine/model/linePath';
import { trimPolyline } from '../../../engine/model/connectorEnds';
import { pathData } from '../../../engine/model/pathGeometry';
import { roughShape } from '../../../engine/model/roughShape';
import { roughEllipse, roughPolyline, seedFrom } from '../../../engine/model/rough';
import { endCapShape } from '../../../engine/model/connectorEnds';
import { ThemeService } from '../../../engine/ThemeService';
import { readableOn } from '../../../engine/model/color';

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
 */
export const ShapeRenderer: React.FC<Props> = React.memo(({ node, showLabel }) => {
  const w = node.width;
  const h = node.height;
  // Gradient geometry is unit-space against the shape's *own* box, and the
  // three primitives here do not share an origin: a Rect is drawn from its
  // top-left, an Ellipse and a RegularPolygon from their centre. Passing the
  // right box per branch is what keeps a top-to-bottom gradient running
  // top-to-bottom on all three rather than starting halfway down the ellipse.
  // Konva's polygon primitives take a single radius, so they are built on a
  // square of the smaller dimension and stretched to the box; their gradient
  // is measured against that square and stretched with them.
  const base = Math.min(w, h) || 1;
  const rectFill = useFillProps(node.appearance, { x: 0, y: 0, width: w, height: h }, '#4F46E5');
  const ellipseFill = useFillProps(node.appearance, { x: -w / 2, y: -h / 2, width: w, height: h }, '#4F46E5');
  const polygonFill = useFillProps(node.appearance, { x: -base / 2, y: -base / 2, width: base, height: base }, '#4F46E5');
  const stroke = strokeColor(node.appearance);
  const sw = strokeWidth(node.appearance);
  const radius = node.appearance?.cornerRadius ?? 0;
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
  // Built once and shared by both effects: `ctx.clip(path)` and
  // `ctx.fill(path, 'evenodd')` each take a path *object*, and building it
  // twice is how a clip and a fill end up describing marginally different
  // shapes. Only built when something needs it.
  const path = React.useMemo(
    () => (offCentre || innerShadow || backdropBlur > 0 ? shapePath2D(node) : null),
    // The outline depends on the node's form and box, not on its paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offCentre, Boolean(innerShadow), backdropBlur > 0, node.geometry, w, h, node.appearance?.cornerRadius]
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
   * The label, however this shape is drawn.
   *
   * Declared once and used by both branches. The sketch branch returns before
   * the crisp one, so it had grown its own copy — a box-centred `Text`, which
   * is right for a rectangle and wrong for a line, whose box is a diagonal with
   * no interior. A sketched arrow's label therefore sat in empty space beside
   * the run rather than on it, and only when sketched.
   */
  const plateFill = ThemeService.getCanvasPlateFill();
  const label =
    showLabel && node.text && node.typography ? (
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
          x={w / 2}
          y={h / 2}
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
          <Text
            text={node.text}
            padding={2}
            // A step down from the shape default. A line's label is a word or
            // two riding a hairline, and at the body size it outweighed the
            // run it belongs to — the label became the object and the line
            // became its underline.
            fontSize={Math.max(9, Math.round(node.typography.fontSize * 0.8))}
            fontFamily={node.typography.fontFamily}
            fontStyle={konvaFontStyle(node.typography)}
            fill={readableOn(node.typography.color, ThemeService.isDarkMode(), 3.2)}
          />
        </Label>
      ) : (
        <Text
          width={w}
          height={h}
          text={node.text}
          fontSize={node.typography.fontSize}
          fontFamily={node.typography.fontFamily}
          fontStyle={konvaFontStyle(node.typography)}
          textDecoration={konvaTextDecoration(node.typography)}
          fill={node.typography.color}
          align={node.typography.align}
          verticalAlign={node.typography.verticalAlign}
          lineHeight={node.typography.lineHeight}
          letterSpacing={node.typography.letterSpacing}
          listening={false}
        />
      )
    ) : null;

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
      const a = { x: 0, y: 0 };
      const b = { x: w, y: h };
      const along = Math.atan2(b.y - a.y, b.x - a.x);
      const size = (Math.max(6, nib * ARROW_HEAD_SCALE) / 2) * (node.geometry.endScale ?? 1);
      const seed = seedFrom(node.id);
      ([
        [node.geometry.endStart ?? 'none', a, along + Math.PI, seed ^ 0x11] as const,
        [node.geometry.endEnd ?? 'none', b, along, seed ^ 0x22] as const,
      ]).forEach(([kind, tip, angle, capSeed]) => {
        const cap = endCapShape(kind, tip, angle, size);
        if (!cap) return;
        if (cap.circle) {
          sketchCaps.push(
            roughEllipse(cap.circle.x, cap.circle.y, cap.circle.radius, cap.circle.radius, {
              seed: capSeed,
              level: node.appearance?.sketch,
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
        {/* A solid fill paints the true silhouette, not the sketch: the drawn
            strokes are disjoint by design, so filling them would leave bites
            taken out of the shape wherever two failed to meet. */}
        {sketch.silhouette && hachureColor && (
          <Path
            data={sketch.silhouette}
            fill={hachureColor}
            opacity={fillPaint?.opacity ?? 1}
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
        {/* Pen shading — one set of strokes, or two crossed. Thinner than the
            outline, because a hand shades with the side of the nib and presses
            harder on the line that defines the shape. */}
        {sketch.fill && hachureColor && (
          <Path
            data={sketch.fill}
            stroke={hachureColor}
            strokeWidth={Math.max(0.8, nib * 0.7)}
            lineCap="round"
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
    /**
     * The run, as the profile draws it.
     *
     * Straight gives back exactly `[0, 0, w, h]`, so the ordinary line is
     * unchanged and everything below — the caps, the trim, the sketcher —
     * carries on working on a two-point list without knowing profiles exist.
     */
    const profile = linePoints(
      { x: 0, y: 0 },
      { x: w, y: h },
      node.geometry.lineProfile,
      node.geometry.lineWaves
    );
    const points = profile.flatMap((p) => [p.x, p.y]);
    const headSize = Math.max(6, (sw || 2) * ARROW_HEAD_SCALE) * (node.geometry.endScale ?? 1);
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
     * The ends, and the direction the run is actually travelling at each.
     *
     * From the first and last *segments*, not from the two corners of the box.
     * On a straight line they are the same thing; on a wavy or coiled one they
     * are not, and taking the box diagonal would point an arrowhead along the
     * overall run while the line arrives at it from a different angle — the
     * head would sit visibly crooked on its own line.
     */
    const a = profile[0];
    const b = profile[profile.length - 1];
    const outAt = profile[Math.min(1, profile.length - 1)];
    const inAt = profile[Math.max(0, profile.length - 2)];
    const startAngle = Math.atan2(a.y - outAt.y, a.x - outAt.x);
    const along = Math.atan2(b.y - inAt.y, b.x - inAt.x);
    const startCap = endCapShape(startKind, a, startAngle, headSize / 2);
    const endCap = endCapShape(endKind, b, along, headSize / 2);

    // Pull the run back under each marker, so a solid head does not have the
    // line poking through its tip — the same trim `ConnectorRenderer` makes,
    // and through the same function, so a wavy line's trim walks back across
    // its samples instead of only shortening one of them.
    const trimmedRun = trimPolyline(
      trimPolyline(points, startCap?.inset ?? 0, true),
      endCap?.inset ?? 0,
      false
    );
    const run = trimmedRun;

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
    shape = <Rect width={w} height={h} {...rectFill} {...shadow} stroke={primitiveStroke} strokeWidth={sw} {...dashProps} cornerRadius={Math.max(0, radius)} />;
  } else if (
    node.geometry.kind === 'heart' ||
    // A rounded polygon or star is no longer a Konva primitive: its corners
    // have been filleted into real curves, so it is drawn from the path the
    // outline describes. Konva's own `cornerRadius` exists on `Rect` alone,
    // which is why every other shape's radius did nothing before.
    ((node.geometry.kind === 'polygon' || node.geometry.kind === 'star') && radius > 0)
  ) {
    // Drawn as a real path rather than as a dense polygon, so it stays smooth
    // at any zoom — the reason `shapeOutline` grew a `bezier` kind. The data
    // comes from the same `shapeToPath` the effects and the exporter read, so
    // the three cannot draw three different hearts.
    shape = (
      <Path
        data={pathData(shapeToPath(node))}
        {...polygonFill}
        {...shadow}
        stroke={primitiveStroke}
        strokeWidth={sw}
        {...dashProps}
      />
    );
  } else if (node.geometry.kind === 'ellipse') {
    // Independent radii, so a non-square ellipse stays elliptical.
    shape = <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...ellipseFill} {...shadow} stroke={primitiveStroke} strokeWidth={sw} {...dashProps} />;
  } else {
    // Build on the smaller dimension and stretch the node itself to fill the
    // w x h box. `strokeScaleEnabled={false}` keeps the outline an even weight
    // despite that non-uniform stretch, which would otherwise make the
    // vertical edges of a widened hexagon visibly thicker than the horizontal
    // ones.
    const scaleX = w / base;
    const scaleY = h / base;
    const common = {
      x: w / 2,
      y: h / 2,
      scaleX,
      scaleY,
      ...polygonFill,
      ...shadow,
      stroke: primitiveStroke,
      strokeWidth: sw,
      strokeScaleEnabled: false,
      ...dashProps,
    };

    shape =
      node.geometry.kind === 'star' ? (
        <Star
          {...common}
          numPoints={node.geometry.points ?? 5}
          innerRadius={(base / 2) * (node.geometry.innerRatio ?? 0.5)}
          outerRadius={base / 2}
        />
      ) : (
        // One primitive for every regular polygon. Triangle and hexagon used
        // to be separate kinds with the side count written into this line.
        <RegularPolygon {...common} sides={node.geometry.points ?? 3} radius={base / 2} />
      );
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
