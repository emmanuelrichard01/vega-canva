import React, { useMemo } from 'react';
import { loadPreview, previewPolygonPoints, type BoardPreview } from '../engine/model/boardPreview';

interface Props {
  workspaceId: string;
  name: string;
  /**
   * A preview to draw instead of loading one.
   *
   * Boards keep a summary of themselves in storage and are looked up by id.
   * A *template* has no id and no history — it is a board that does not exist
   * yet — so its picture is computed from the same builder that will make it.
   * Supplying it here means the gallery draws through this exact component,
   * rather than growing a second, slightly different thumbnail renderer that
   * would drift from what the board actually looks like.
   */
  preview?: BoardPreview | null;
}

/**
 * The picture on a board's card.
 *
 * It used to hash the room id into one of three abstract glyphs — a circle, a
 * rectangle or a triangle, in two of four colours. Deterministic, and that was
 * the whole of its relationship to the board: two rooms full of entirely
 * different work could draw the identical picture, and a room holding two
 * hundred objects drew a single circle. A thumbnail that cannot tell your
 * boards apart is decoration shaped like information.
 *
 * It now draws the **actual board** — real object positions, sizes, silhouettes
 * and colours — from the summary the room keeps as you work
 * (`engine/model/boardPreview`). The generative glyph survives as the fallback
 * for a board this device has never opened, which is the one case where there
 * is genuinely nothing to show and a placeholder is the honest answer.
 */
export const WorkspaceCover: React.FC<Props> = ({ workspaceId, name, preview: supplied }) => {
  const loaded = useMemo(() => loadPreview(workspaceId), [workspaceId]);
  const preview = supplied ?? loaded;

  if (preview && preview.items.length > 0) {
    /**
     * The content box is fitted into the cover rather than stretched to it, so
     * a wide board and a tall one both keep their proportions and the drawing
     * stays a picture of the board instead of a distortion of one.
     */
    const VIEW_W = 100;
    const VIEW_H = 62;
    /**
     * The board is drawn inside a margin, not bled to the edges.
     *
     * Fitted edge to edge, a board whose content is one large object becomes a
     * solid rectangle of that object's colour filling the whole card — which
     * is arithmetically the correct fit and tells you nothing. Nothing about
     * it reads as a canvas: no ground, no sense of scale, no indication that
     * the colour is an object sitting *on* something.
     *
     * Holding the drawing to 84% and letting the dot field show around it
     * gives every cover the same frame of reference, so a board with one
     * shape and a board with three hundred are recognisably the same kind of
     * picture.
     */
    const PAD = 0.84;
    const scale = (Math.min(VIEW_W / preview.ratio, VIEW_H) / VIEW_H) * PAD;
    const drawW = VIEW_H * preview.ratio * scale;
    const drawH = VIEW_H * scale;
    const offX = (VIEW_W - drawW) / 2;
    const offY = (VIEW_H - drawH) / 2;

    return (
      <div className="cover">
        <svg
          className="cover__art"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${name}, ${preview.total} object${preview.total === 1 ? '' : 's'}`}
        >
          {preview.items.map((item, i) => {
            const x = offX + item.x * drawW;
            const y = offY + item.y * drawH;
            const w = Math.max(0.6, item.w * drawW);
            const h = Math.max(0.6, item.h * drawH);

            /**
             * Turned the way the object is turned.
             *
             * Applied around the object's own centre, which is where Konva
             * rotates it, so the silhouette matches the board rather than
             * swinging about a corner. Omitted entirely when there is no
             * rotation — an identity transform on every node is a transform
             * the browser still has to consider.
             */
            const spin = item.rot
              ? { transform: `rotate(${item.rot} ${x + w / 2} ${y + h / 2})` }
              : undefined;

            /**
             * An outline is stroked, not filled.
             *
             * A shape with a stroke and no fill resolved to its stroke colour
             * and was then filled with it, so an outlined rectangle drew as a
             * solid one — the same mistake as a star drawing as a block.
             */
            const paint = item.no
              ? { fill: 'none', stroke: item.c, strokeWidth: 0.8 }
              : { fill: item.c };
            // A route, not a box. Stroked at a hairline that stays visible at
            // cover size without pretending to be a real stroke weight.
            if (item.l && item.l.length >= 4) {
              const pts: string[] = [];
              for (let k = 0; k < item.l.length; k += 2) {
                pts.push(`${offX + item.l[k] * drawW},${offY + item.l[k + 1] * drawH}`);
              }
              return (
                <polyline
                  key={i}
                  points={pts.join(' ')}
                  fill="none"
                  stroke={item.c}
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }
            /**
             * Words, ruled.
             *
             * A text node's colour is its ink and its box is the area the
             * words cover, so the ordinary filled-rect path drew a solid slab
             * of near-black across the top of every template that titled
             * itself. It read as a broken image, which is the one thing a
             * thumbnail must never do.
             *
             * Glyphs are not available at this size — a 36px heading lands
             * around two pixels tall — so the lines are ruled instead, spaced
             * off the node's real type size so a title and a paragraph still
             * look different. The last line is short, because that is what
             * makes a stack of bars read as prose rather than as a barcode,
             * and the whole thing is drawn at partial opacity so text never
             * outweighs the actual objects on the board.
             */
            if (item.t) {
              const lineH = item.fs ? Math.max(0.9, item.fs * drawH * 1.35) : Math.max(0.9, h);
              const rules = Math.max(1, Math.min(6, Math.round(h / lineH)));
              const weight = Math.max(0.55, lineH * 0.42);
              return (
                <g key={i} fill={item.c} opacity={0.55} {...spin}>
                  {Array.from({ length: rules }).map((_, k) => (
                    <rect
                      key={k}
                      x={x}
                      y={y + k * lineH + (lineH - weight) / 2}
                      // The closing line runs short, the way a paragraph ends.
                      width={Math.max(0.8, k === rules - 1 && rules > 1 ? w * 0.62 : w)}
                      height={weight}
                      rx={weight / 2}
                    />
                  ))}
                </g>
              );
            }
            /**
             * A frame is paper: a fill and a hairline.
             *
             * Without the stroke a white frame on a near-white card is
             * invisible, and the boards made *of* frames — lanes, quadrants,
             * artboards — would lose the structure that is the whole point of
             * them. The stroke matches the one `FrameRenderer` draws, at the
             * same neutral and alpha, so the card and the board agree.
             */
            if (item.k) {
              return (
                <rect
                  key={i}
                  x={x} y={y} width={w} height={h}
                  rx={item.r ? item.r * Math.min(w, h) : 0}
                  fill={item.c}
                  stroke="rgba(115,115,115,0.28)"
                  strokeWidth={0.4}
                  {...spin}
                />
              );
            }
            if (item.o) {
              return <ellipse key={i} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...paint} {...spin} />;
            }

            /**
             * Stars, polygons and lines — everything that is not a box.
             *
             * These all fell through to the filled rectangle below, so a board
             * holding a single star had a thumbnail that was a solid block of
             * the star's colour. The vertices are generated here from the two
             * numbers the summary carries, rather than stored: a star is ten
             * points and a polygon can be many more.
             *
             * Both start at twelve o'clock, which is where the shape tool
             * draws them, so the picture matches the board rather than being
             * the same shape at some other rotation.
             */
            if (item.s === 'line') {
              /**
               * The run the line actually draws, when the summary carries one.
               *
               * This used to be a single horizontal rule from the left of the
               * box to the right, which was wrong twice: a line running corner
               * to corner drew flat, and a line with a **profile** — wavy,
               * zigzag, curved, or the coil — lost the whole thing that makes
               * it that profile. A board of loops had a thumbnail of plain
               * rules, which is a confidently wrong picture rather than a
               * simplified one.
               *
               * The straight fallback stays for summaries written before the
               * points were carried. It is honest about being approximate,
               * where the old one was not.
               */
              const stroke = Math.max(0.5, Math.min(1.4, h || 1));
              if (item.l && item.l.length >= 4) {
                // Same mapping the connector polyline above uses: the points
                // are normalised into the board's box, exactly like `x`/`y`.
                const pts: string[] = [];
                for (let p = 0; p + 1 < item.l.length; p += 2) {
                  pts.push(`${offX + item.l[p] * drawW},${offY + item.l[p + 1] * drawH}`);
                }
                return (
                  <polyline
                    key={i}
                    points={pts.join(' ')}
                    {...spin}
                    fill="none"
                    stroke={item.c}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              }
              return (
                <line
                  key={i}
                  x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                  {...spin}
                  stroke={item.c}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                />
              );
            }

            if (item.s === 'polygon' || item.s === 'star') {
              // The maths lives in the pure module so it can be asserted; a
              // shape that draws wrongly is otherwise findable only by
              // looking at a thumbnail, which nobody does before shipping.
              const pts = previewPolygonPoints(item, x, y, w, h)
                .map(([px, py]) => `${px},${py}`)
                .join(' ');
              return <polygon key={i} points={pts} {...paint} {...spin} />;
            }
            return (
              <rect
                key={i}
                x={x} y={y} width={w} height={h}
                rx={item.r ? item.r * Math.min(w, h) : 0}
                {...paint}
                {...spin}
              />
            );
          })}
        </svg>
      </div>
    );
  }

  /**
   * Nothing to draw — and *which* nothing matters.
   *
   * A stored record with no items means the board has been opened and is
   * empty. No record at all means this device has never opened it. They were
   * one state, captioned "Not opened on this device", which was wrong for
   * every empty board anyone had made themselves.
   *
   * The hue-hashed square that used to sit here is gone with it. It was a
   * random colour standing in for information — the same objection this
   * component's own header makes about the three abstract glyphs it
   * replaced — and two boards with nothing on them should look alike, because
   * they are alike.
   */
  const seen = preview !== null;

  return (
    <div className="cover cover--empty" role="img" aria-label={seen ? `${name}, an empty board` : `${name}, not opened on this device`}>
      <span className="cover__hint">
        {seen ? 'Nothing on it yet' : 'Not opened on this device'}
      </span>
    </div>
  );
};
