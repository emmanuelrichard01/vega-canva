export interface Point {
  x: number;
  y: number;
}

// Ramer-Douglas-Peucker algorithm to simplify raw freehand mouse points
export const simplifyPoints = (points: Point[], epsilon = 2.0): Point[] => {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;

  const end = points.length - 1;
  const lineStart = points[0];
  const lineEnd = points[end];

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], lineStart, lineEnd);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = simplifyPoints(points.slice(0, index + 1), epsilon);
    const recResults2 = simplifyPoints(points.slice(index), epsilon);

    return [...recResults1.slice(0, recResults1.length - 1), ...recResults2];
  } else {
    return [points[0], points[end]];
  }
};

const perpendicularDistance = (pt: Point, lineStart: Point, lineEnd: Point): number => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  const mag = Math.hypot(dx, dy);
  if (mag === 0) {
    return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  }

  const u = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / (mag * mag);
  const clampU = Math.max(0, Math.min(1, u));

  const nearestX = lineStart.x + clampU * dx;
  const nearestY = lineStart.y + clampU * dy;

  return Math.hypot(pt.x - nearestX, pt.y - nearestY);
};

// Convert simplified point array into smooth SVG path string (d="M ... Q ...")
export const pointsToSVGPath = (points: Point[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
  }

  if (points.length > 1) {
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
  }

  return d;
};
