/**
 * A frame's four corners in world space, rotated about its centre, or `null`
 * when `point` lies outside them.
 */
export function frameClipCorners(
  frame: { x: number; y: number; width: number; height: number; rotation: number },
  point: { x: number; y: number }
): Array<{ x: number; y: number }> | null {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const rad = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The point in the frame's unrotated space.
  const px = point.x - cx;
  const py = point.y - cy;
  const lx = px * cos + py * sin;
  const ly = -px * sin + py * cos;
  const hw = frame.width / 2;
  const hh = frame.height / 2;
  if (Math.abs(lx) > hw || Math.abs(ly) > hh) return null;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([ox, oy]) => ({ x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos }));
}
