import React, { useEffect, useRef } from 'react';
import { spinSpeed } from './spin';

/**
 * A small record: disc, fine grooves, a conic sheen, a label and a spindle
 * hole, drawn so it stays crisp at 1×. The disc takes the text colour; grooves
 * and label are cut from the surface colour, so it reads in light, dark and
 * increased contrast alike.
 *
 * It turns at 33⅓ rpm: winding up when music starts and coasting to rest when
 * it stops (transform only, written from one rAF loop that sleeps once the
 * disc is still). The optional tonearm lowers onto the record while playing.
 * Under reduced motion nothing moves; the arm just sits where it belongs.
 *
 * Colours resolve on the glyph itself, so they follow the theme class.
 */
export const VinylGlyph: React.FC<{ spinning: boolean; size?: number; arm?: boolean; tint?: string | null }> = ({ spinning, size = 16, arm = false, tint = null }) => {
  const disc = useRef<SVGGElement>(null);
  const live = useRef(spinning);
  live.current = spinning;

  useEffect(() => {
    const el = disc.current;
    if (!el) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    let frame = 0;
    let last = 0;
    let speed = Number(el.dataset.speed ?? 0);
    let angle = Number(el.dataset.angle ?? 0);
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      speed = spinSpeed(speed, dt, live.current);
      angle = (angle + speed * dt) % 360;
      el.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      el.dataset.speed = String(speed);
      el.dataset.angle = String(angle);
      if (speed === 0 && !live.current) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    if (spinning || speed > 0) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spinning]);

  return (
    <svg className={`vinyl-glyph${spinning ? ' is-playing' : ''}${arm ? ' has-arm' : ''}`} viewBox="0 0 20 20" width={size * 1.25} height={size * 1.25} aria-hidden="true" style={{ margin: `${-size * 0.125}px`, ...(tint ? ({ '--vinyl-label': tint } as React.CSSProperties) : null) }}>
      <g ref={disc} className="vinyl-glyph__disc">
        <circle cx={9} cy={10} r={7.5} fill="currentColor" />
        <circle cx={9} cy={10} r={6.1} fill="none" className="vinyl-glyph__groove" strokeWidth={0.5} />
        <circle cx={9} cy={10} r={4.9} fill="none" className="vinyl-glyph__groove" strokeWidth={0.4} />
        <circle cx={9} cy={10} r={3.2} className="vinyl-glyph__label" />
        <rect x={8.5} y={7.4} width={1} height={1.3} rx={0.3} fill="currentColor" />
        <circle cx={9} cy={10} r={0.7} fill="currentColor" />
      </g>
      {/* The sheen does not turn: a fixed highlight over a turning disc is what makes the spin read. */}
      <path className="vinyl-glyph__sheen" d="M 4.6 6.2 A 5.8 5.8 0 0 1 8 4.2 M 13.4 13.8 A 5.8 5.8 0 0 1 10 15.8" />
      {arm && (
        <g className="vinyl-glyph__arm">
          <circle cx={17} cy={3.4} r={1.5} fill="currentColor" />
          <path d="M17 3.4 L16.4 11.5 L13.6 13.6" fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
};
