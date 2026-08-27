import React from 'react';
import { defaultEndAlign, linePoints, type LineProfile } from '../../engine/model/linePath';
import { endCapShape, endCapSize, terminateRun, type EndCapKind } from '../../engine/model/connectorEnds';
import { polylinePoints } from '../../engine/model/polyline';

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
  /**
   * Which of the two things a line can be, drawn as itself.
   *
   * `two-point` is the profiled run this has always shown. The other two are a
   * *run of corners* — sharp or rounded — which no profile can describe and
   * which is therefore the only honest way to put "a line with corners" on a
   * button. Through `polylinePoints`, the same function the canvas draws with,
   * so the tile and the result cannot disagree about what rounding looks like.
   */
  run?: 'two-point' | 'corners' | 'rounded';
}> = ({ profile = 'straight', endStart = 'none', endEnd = 'none', run: shape = 'two-point' }) => {
  const a = { x: 2, y: H / 2 };
  const b = { x: W - 2, y: H / 2 };
  /**
   * A step, not a zigzag: two corners turning the same way read as *corners*
   * at sixteen pixels, where a symmetric zigzag reads as a wave and collides
   * with the profile glyph sitting next to it.
   */
  const corners = [
    { x: 2, y: H - 3 },
    { x: W / 2 - 2, y: H - 3 },
    { x: W / 2 + 2, y: 3 },
    { x: W - 2, y: 3 },
  ];
  const pts =
    shape === 'two-point'
      // Two repeats, not the default six: at this size six is a blur, and the
      // glyph's job is to say *what shape* the run makes, not how often.
      ? linePoints(a, b, profile, 2)
      : polylinePoints(corners, undefined, shape === 'rounded');

  /**
   * The direction the run *arrives* at each end, from its last segment.
   *
   * Not the overall left-to-right direction. This is the same mistake the
   * canvas renderer made and had fixed: on a wave or a coil the run reaches
   * its endpoint travelling at an angle, so a head drawn along the horizontal
   * sits visibly crooked on the line it is supposed to terminate — which is
   * exactly the "weird and broken" arrow specimens.
   */
  // Small enough that a head never swallows the profile it sits on the end of.
  const capSize = 4.5;

  /**
   * The same placement the canvas uses, through the same function.
   *
   * The specimen has to show the *alignment* too: with `extend` the run keeps
   * its full length and the head grows out past it, which on a wavy glyph is
   * visibly a different picture from the head eating the last crest. A
   * specimen that showed only one of the two modes would be advertising the
   * wrong one half the time.
   */
  const { run: trimmedFlat, start, end } = terminateRun(
    pts.flatMap((p) => [p.x, p.y]),
    {
      start: endStart,
      end: endEnd,
      strokeWidth: 1.5,
      // The glyph's own head size, not one derived from a 1.5px stroke.
      scale: capSize / endCapSize(1.5, 1),
      align: defaultEndAlign(profile),
    }
  );
  const run: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < trimmedFlat.length; i += 2) {
    run.push({ x: trimmedFlat[i], y: trimmedFlat[i + 1] });
  }
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
