import { withAlpha, type GradientPaint } from './paint';

/**
 * A gradient drawn in CSS the way the canvas draws it, at a given pixel size.
 *
 * ## Why not `paintToCss`
 *
 * That string is for a 24px swatch, where close enough is exact enough, and it
 * takes two shortcuts that stop being invisible the moment the preview is the
 * thing you are dragging handles on:
 *
 * - A radial gradient ignores `radius` — `circle at x y` sizes itself to the
 *   farthest corner — so dragging the radius handle changed nothing on screen.
 * - A linear gradient's stops are placed along the CSS gradient line, which
 *   spans the whole box, while the canvas places them between the two stored
 *   endpoints. Move an endpoint inward and the canvas compresses the blend;
 *   the swatch did not.
 *
 * Here the linear stops are projected from the stored segment onto the CSS
 * line in pixels, and the radial takes its real radius, so the handles and the
 * paint under them agree.
 */
export function gradientPreviewCss(paint: GradientPaint, width: number, height: number): string {
  const ordered = [...paint.stops].sort((a, b) => a.offset - b.offset);
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;

  switch (paint.type) {
    case 'linear': {
      const x0 = paint.from.x * width;
      const y0 = paint.from.y * height;
      const x1 = paint.to.x * width;
      const y1 = paint.to.y * height;
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (dx === 0 && dy === 0) return withAlpha(ordered[0]?.color ?? '#000', ordered[0]?.opacity);
      const angle = Math.atan2(dx, -dy);
      const ux = Math.sin(angle);
      const uy = -Math.cos(angle);
      // The CSS gradient line runs through the centre, long enough that its
      // perpendiculars through the ends touch the far corners.
      const length = Math.abs(width * ux) + Math.abs(height * uy);
      const cx = width / 2;
      const cy = height / 2;
      const stops = ordered
        .map((s) => {
          const x = x0 + dx * s.offset;
          const y = y0 + dy * s.offset;
          const at = (x - cx) * ux + (y - cy) * uy + length / 2;
          return `${withAlpha(s.color, s.opacity)} ${px(at)}`;
        })
        .join(', ');
      return `linear-gradient(${Math.round((angle * 180) / Math.PI * 100) / 100}deg, ${stops})`;
    }
    case 'radial': {
      const r = Math.max(1, (paint.radius * Math.max(width, height)) / 2);
      const stops = ordered.map((s) => `${withAlpha(s.color, s.opacity)} ${px(s.offset * r)}`).join(', ');
      return `radial-gradient(circle ${px(r)} at ${px(paint.center.x * width)} ${px(paint.center.y * height)}, ${stops})`;
    }
    case 'conic': {
      const stops = ordered.map((s) => `${withAlpha(s.color, s.opacity)} ${Math.round(s.offset * 10000) / 100}%`).join(', ');
      return `conic-gradient(from ${paint.angle}deg at ${px(paint.center.x * width)} ${px(paint.center.y * height)}, ${stops})`;
    }
    case 'diamond': {
      // CSS has no diamond; an ellipse inscribed in the same box is the
      // nearest honest impression, and the handles still say where it ends.
      const rx = Math.max(1, (paint.radius * width) / 2);
      const ry = Math.max(1, (paint.radius * height) / 2);
      const stops = ordered.map((s) => `${withAlpha(s.color, s.opacity)} ${Math.round(s.offset * 10000) / 100}%`).join(', ');
      return `radial-gradient(ellipse ${px(rx)} ${px(ry)} at ${px(paint.center.x * width)} ${px(paint.center.y * height)}, ${stops})`;
    }
  }
}
