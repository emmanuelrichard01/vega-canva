import React, { useEffect, useRef } from 'react';
import type { LaserTrail } from '../../engine/slides/laser';

/**
 * Draws the laser: a soft red dot with a short tail that thins and fades.
 *
 * One canvas over the whole screen, drawn by a frame loop that runs only while
 * there is a dot or a tail to draw and parks itself the moment there is not.
 * `wake` is called by whoever feeds the trail, to restart a parked loop. Under
 * reduced motion there is no tail, only the dot.
 */
export const LaserLayer: React.FC<{ trail: LaserTrail; wakeRef: React.MutableRefObject<() => void> }> = ({ trail, wakeRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    let raf = 0;
    let running = false;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    const draw = () => {
      const now = performance.now();
      trail.prune(now);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!reduce) {
        ctx.lineCap = 'round';
        for (const { a, b, age } of trail.segments(now)) {
          const k = 1 - age;
          ctx.strokeStyle = `rgba(255, 64, 48, ${0.55 * k})`;
          ctx.lineWidth = 2 + 8 * k;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const head = trail.points[trail.points.length - 1];
      if (trail.on && head) {
        const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 22);
        glow.addColorStop(0, 'rgba(255, 70, 50, 0.55)');
        glow.addColorStop(1, 'rgba(255, 70, 50, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FF3B2F';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 236, 230, 0.9)';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (trail.alive) raf = requestAnimationFrame(draw);
      else running = false;
    };

    const wake = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(draw);
    };
    wakeRef.current = wake;
    window.addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      wakeRef.current = () => {};
    };
  }, [trail, wakeRef]);

  return <canvas ref={canvasRef} className="fp-laser" aria-hidden="true" />;
};
