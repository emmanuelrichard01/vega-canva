import React, { useMemo } from 'react';
import { loadPreview, type BoardPreview } from '../engine/model/boardPreview';

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

/** Deterministic seed, for the boards we have never opened on this device. */
const cyrb53 = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

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
    const scale = Math.min(VIEW_W / preview.ratio, VIEW_H) / VIEW_H;
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
          aria-label={`${name} — ${preview.total} object${preview.total === 1 ? '' : 's'}`}
        >
          {preview.items.map((item, i) => {
            const x = offX + item.x * drawW;
            const y = offY + item.y * drawH;
            const w = Math.max(0.6, item.w * drawW);
            const h = Math.max(0.6, item.h * drawH);
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
            if (item.o) {
              return <ellipse key={i} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={item.c} />;
            }
            return (
              <rect
                key={i}
                x={x} y={y} width={w} height={h}
                rx={item.r ? item.r * Math.min(w, h) : 0}
                fill={item.c}
              />
            );
          })}
        </svg>
      </div>
    );
  }

  // Never opened here: a quiet mark rather than a picture of a board we have
  // not got. Deliberately calmer than the drawing above, so a real preview
  // always outranks a placeholder at a glance.
  const hash = cyrb53(workspaceId);
  const hue = hash % 360;

  return (
    <div className="cover cover--empty">
      <span
        className="cover__seed"
        style={{ background: `hsl(${hue} 45% 55% / 0.28)` }}
        aria-hidden="true"
      />
      <span className="cover__hint">Not opened on this device</span>
    </div>
  );
};
