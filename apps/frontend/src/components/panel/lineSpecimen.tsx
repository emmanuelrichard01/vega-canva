import React from 'react';
import { linePoints, type LineProfile } from '../../engine/model/linePath';
import { endCapShape, trimPolyline, type EndCapKind } from '../../engine/model/connectorEnds';

/**
 * A whole line, drawn as it would be: profile, and both ends.
 *
 * ## Why one specimen instead of an icon per combination
 *
 * A line now has two independent dimensions — five profiles and six end styles
 * at each end — which is a set no hand-drawn icon library can cover. Generating
 * it from `linePoints` and `endCapShape`, the same two functions the canvas
 * draws with, means one component covers every combination and none of them
 * can drift from what it produces.
 *
 * ## Where it earns its place
 *
 * On the dock's Line seat, so the button shows the line you are about to draw
 * rather than a generic dash — the seat already changed glyph for line versus
 * arrow, and the profile is the same kind of fact about the same gesture.
 *
 * And on the contextual toolbar's shape swapper, where it solves a real
 * collision: on a line object that button, the stroke button and the sketch
 * button were three straight dashes in a row. A specimen of *this* line is
 * unmistakable next to a weight and a nib.
 */
const W = 22;
const H = 16;

export const LineSpecimen: React.FC<{
  profile?: LineProfile;
  endStart?: EndCapKind;
  endEnd?: EndCapKind;
}> = ({ profile = 'straight', endStart = 'none', endEnd = 'none' }) => {
  const a = { x: 2, y: H / 2 };
  const b = { x: W - 2, y: H / 2 };
  // Two repeats, not the default six: at this size six is a blur, and the
  // glyph's job is to say *what shape* the run makes, not how often.
  const pts = linePoints(a, b, profile, 2);

  /**
   * The direction the run *arrives* at each end, from its last segment.
   *
   * Not the overall left-to-right direction. This is the same mistake the
   * canvas renderer made and had fixed: on a wave or a coil the run reaches
   * its endpoint travelling at an angle, so a head drawn along the horizontal
   * sits visibly crooked on the line it is supposed to terminate — which is
   * exactly the "weird and broken" arrow specimens.
   */
  const outAt = pts[Math.min(1, pts.length - 1)];
  const inAt = pts[Math.max(0, pts.length - 2)];
  const startAngle = Math.atan2(a.y - outAt.y, a.x - outAt.x);
  const endAngle = Math.atan2(b.y - inAt.y, b.x - inAt.x);

  // Small enough that a head never swallows the profile it sits on the end of.
  const capSize = 4.5;
  const start = endCapShape(endStart, a, startAngle, capSize);
  const end = endCapShape(endEnd, b, endAngle, capSize);

  /**
   * The run pulled back under each head.
   *
   * Without it the line runs on through the arrowhead and out the other side —
   * a dark spike past the tip, which at 22px is most of what the glyph looks
   * like. The canvas does this too, and for the same reason.
   */
  const trimmed = trimPolyline(
    trimPolyline(pts.flatMap((p) => [p.x, p.y]), start?.inset ?? 0, true),
    end?.inset ?? 0,
    false
  );
  const run: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < trimmed.length; i += 2) run.push({ x: trimmed[i], y: trimmed[i + 1] });
  const d = run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  const marker = (cap: ReturnType<typeof endCapShape>, key: string) => {
    if (!cap) return null;
    if (cap.circle) {
      return (
        <circle key={key} cx={cap.circle.x} cy={cap.circle.y} r={cap.circle.radius} fill="currentColor" />
      );
    }
    const pointsAttr = (cap.points ?? [])
      .reduce<string[]>((acc, n, i) => {
        if (i % 2 === 0) acc.push(`${n.toFixed(2)}`);
        else acc[acc.length - 1] += `,${n.toFixed(2)}`;
        return acc;
      }, [])
      .join(' ');
    return (
      <polygon
        key={key}
        points={pointsAttr}
        fill={cap.filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    );
  };

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {marker(start, 'start')}
      {marker(end, 'end')}
    </svg>
  );
};
