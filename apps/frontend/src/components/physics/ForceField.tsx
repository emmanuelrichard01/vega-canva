import React, { useEffect, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Group, Shape } from 'react-konva';
import { FORCE_SPECS, falloffAt, type FalloffId, type ForceId } from '../../engine/physics/forces';
import { fieldArt } from '../../engine/physics/fieldArt';
import { physicsRuntime } from '../../engine/physics/settings';

/**
 * The field a force will apply, drawn where it will apply it.
 *
 * A soft disc whose brightness follows the falloff curve, a hairline ring at
 * exactly the simulated radius, and marks that move the way the force does:
 * pull streams in, push streams out, drop and wind run along their direction,
 * swirl turns, shockwave expands. Under reduced motion the marks hold still at
 * a phase that still shows direction.
 *
 * Mount it only while a force is armed. Canvas positions and shows the group
 * through `groupRef`; this component owns what is drawn inside it. Drawn in
 * the export-chrome layer, so it never reaches a file.
 */

interface ForceFieldProps {
  mode: ForceId;
  /** Multiplier from the Area control. */
  radiusScale: number;
  falloff: FalloffId;
  /** Direction of Drop, in degrees. */
  gravityAngle: number;
  groupRef: React.RefObject<Konva.Group | null>;
  /** The `name` that keeps this out of exports. */
  chromeName: string;
}

const CYCLE_MS = 2200;
/** A phase at which every mark is mid-travel and still points the right way. */
const STILL_PHASE = 0.42;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Resolve a CSS custom property to a colour canvas can paint.
 *
 * Canvas takes no `var()`; reading the property through an element lets the
 * browser resolve nested tokens, and the theme with them.
 */
function resolveColor(token: string, probe: HTMLElement): string {
  probe.style.color = '';
  probe.style.color = token;
  return getComputedStyle(probe).color || '#888';
}

const rgba = (color: string, alpha: number) => {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b] = m[1].split(/[ ,/]+/).filter(Boolean);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
};

export const ForceField: React.FC<ForceFieldProps> = ({
  mode, radiusScale, falloff, gravityAngle, groupRef, chromeName,
}) => {
  const spec = FORCE_SPECS[mode];
  const radius = spec.radius * radiusScale;
  const shapeRef = useRef<Konva.Shape>(null);
  const colorRef = useRef('#888');
  const reduced = useMemo(prefersReducedMotion, []);

  // Colour follows the force and the theme.
  useEffect(() => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const refresh = () => {
      colorRef.current = resolveColor(spec.colorToken, probe);
      shapeRef.current?.getLayer()?.batchDraw();
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-contrast'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-contrast'] });
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, [spec.colorToken]);

  // Animate only while there is something to animate.
  useEffect(() => {
    const shape = shapeRef.current;
    const layer = shape?.getLayer();
    if (!shape || !layer || reduced) return;
    const anim = new Konva.Animation(() => undefined, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [reduced, mode]);

  const draw = (ctx: Konva.Context, shape: Konva.Shape) => {
    const c = ctx._context;
    const color = colorRef.current;
    const zoom = Math.max(0.05, shape.getAbsoluteScale().x);
    const hair = 1.25 / zoom;
    const phase = reduced ? STILL_PHASE : (performance.now() % CYCLE_MS) / CYCLE_MS;
    const heading = mode === 'wind' ? physicsRuntime.windAngle : gravityAngle;

    // The disc: brightness follows the falloff, so the edge you feel is the
    // edge you see. Hard falloff shows a flat disc with a visible rim.
    const grad = c.createRadialGradient(0, 0, 0, 0, 0, radius);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const strength = falloff === 'constant' ? 1 : falloffAt(falloff, t * radius, radius);
      grad.addColorStop(t, rgba(color, 0.04 + 0.12 * strength));
    }
    c.beginPath();
    c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fillStyle = grad;
    c.fill();

    c.lineWidth = hair;
    c.strokeStyle = rgba(color, 0.7);
    c.stroke();

    const art = fieldArt({ mode, radius, falloff, heading, phase });
    c.lineCap = 'round';
    c.lineWidth = 2.25 / zoom;
    for (const s of art.segments) {
      c.strokeStyle = rgba(color, 0.85 * s.alpha);
      c.beginPath();
      c.moveTo(s.x1, s.y1);
      c.lineTo(s.x2, s.y2);
      c.stroke();
    }
    c.lineWidth = hair * 1.4;
    for (const ring of art.rings) {
      c.strokeStyle = rgba(color, ring.alpha);
      c.beginPath();
      c.arc(0, 0, ring.radius, 0, Math.PI * 2);
      c.stroke();
    }

    // The origin: a dot with a halo, so the point of application survives a
    // ring that runs off screen.
    c.fillStyle = rgba(color, 0.22);
    c.beginPath();
    c.arc(0, 0, 11 / zoom, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 0, 4.5 / zoom, 0, Math.PI * 2);
    c.fill();
  };

  return (
    <Group ref={groupRef} listening={false} visible={false} name={chromeName}>
      <Shape ref={shapeRef} listening={false} sceneFunc={(ctx, shape) => draw(ctx, shape)} />
    </Group>
  );
};

