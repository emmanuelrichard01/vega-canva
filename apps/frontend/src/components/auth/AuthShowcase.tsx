import React, { useEffect, useState } from 'react';
import { THEMES } from '../../engine/model/stickyThemes';

/**
 * A board with people on it, while somebody types their name.
 *
 * ## Why a live board and not a slideshow
 *
 * This half used to rotate four beats of copy over a blurred gradient: claims
 * about the product, each with a small drawing. On a large screen most of it
 * was gradient, and a carousel of claims is the register of a landing page,
 * not of the tool you are about to walk into.
 *
 * So it shows the thing itself, in the board's own vocabulary: a design
 * review — a frame of review notes, the service under discussion, two connected services, and three named cursors doing
 * the three things collaborators are seen doing — one places a note, one draws
 * a connector, one has a shape selected. Nothing has to be read to get it.
 *
 * ## Why it is CSS and not a canvas
 *
 * A few vectors and keyframes, transform and opacity only (plus the
 * connector's dash offset), so it costs nothing while the app mounts behind
 * it. The loop is twelve seconds and slow. It pauses when the tab is hidden,
 * and under reduced motion it is one composed still: every animated piece has
 * its finished position as its resting one.
 */

interface CursorProps {
  name: string;
  color: string;
  ink: string;
  /** The resting position: the still frame under reduced motion. */
  x: number;
  y: number;
  className: string;
}

/** A collaborator's pointer with their name, drawn the way the board draws one. */
const Cursor: React.FC<CursorProps> = ({ name, color, ink, x, y, className }) => {
  const width = 16 + name.length * 7.4;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className}>
        <path
          d="M0 0 L0 19 L4.8 13.8 L8.6 21.4 L12.4 19.4 L8.6 12 L15 12 Z"
          fill={color}
          stroke="var(--sc-board)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <rect x="12" y="17" width={width} height="20" rx="10" fill={color} />
        <text x={12 + width / 2} y="31" textAnchor="middle" fill={ink} fontSize="11.5" fontWeight="600" fontFamily="var(--font-sans)">
          {name}
        </text>
      </g>
    </g>
  );
};

interface NoteProps {
  x: number;
  y: number;
  rot: number;
  theme: keyof typeof THEMES;
  lines: readonly string[];
}

/** A sticky note: paper, a hairline edge, a soft cast, and its words. */
const Note: React.FC<NoteProps> = ({ x, y, rot, theme, lines }) => {
  const t = THEMES[theme];
  return (
    <g transform={`rotate(${rot} ${x + 39} ${y + 39})`}>
      <rect x={x + 1.5} y={y + 4} width="78" height="78" rx="4" className="sc-cast" />
      <rect x={x} y={y} width="78" height="78" rx="4" fill={t.bg} stroke={t.edge} strokeWidth="1" />
      {lines.map((line, i) => (
        <text key={line} x={x + 10} y={y + 24 + i * 16} fill={t.text} fontSize="11.5" fontWeight="550" fontFamily="var(--font-sans)">
          {line}
        </text>
      ))}
    </g>
  );
};

// The connector Kai draws, from "Orders" to "Postgres".
const LINK = 'M214 352 C 300 352, 300 302, 384 302';

const MiniBoard: React.FC = () => (
  <svg viewBox="0 0 600 440" className="sc-board" aria-hidden="true">
    <defs>
      <pattern id="scDots" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="1.2" fill="var(--sc-dot)" />
      </pattern>
    </defs>
    <rect width="600" height="440" fill="url(#scDots)" />

    {/* Who is here, the way the board's header shows it. */}
    <g className="sc-stack" fontFamily="var(--font-sans)" fontSize="11" fontWeight="650" textAnchor="middle">
      {[
        { c: '#F3A024', ink: '#161616', l: 'A', x: 516 },
        { c: '#3D7BEA', ink: '#fff', l: 'K', x: 538 },
        { c: '#16936A', ink: '#fff', l: 'N', x: 560 },
      ].map((p) => (
        <g key={p.l}>
          <circle cx={p.x} cy="34" r="13" fill={p.c} stroke="var(--sc-board)" strokeWidth="2.5" />
          <text x={p.x} y="38" fill={p.ink}>{p.l}</text>
        </g>
      ))}
    </g>

    {/* A frame of notes. */}
    <text x="48" y="70" className="sc-label" fontSize="12" fontWeight="600" fontFamily="var(--font-sans)">Design review</text>
    <rect x="48" y="80" width="272" height="206" rx="10" className="sc-frame" />
    <Note x={68} y={100} rot={-2} theme="yellow" lines={['Retry', 'on 5xx?']} />
    <Note x={160} y={98} rot={2} theme="sky" lines={['Cache', 'p95 210ms']} />
    <Note x={70} y={190} rot={1.5} theme="mint" lines={['Rate', 'limits']} />

    {/* The note Ada is placing, resting where it lands. */}
    <g transform="rotate(-2 199 229)">
      <g className="sc-placed">
        <Note x={160} y={190} rot={0} theme="pink" lines={['Add a', 'queue']} />
      </g>
    </g>

    {/* A solid shape, selected by Noor. */}
    <rect x="364" y="92" width="188" height="112" rx="14" className="sc-hero" />
    <text x="388" y="136" className="sc-hero-ink" fontSize="15" fontWeight="650" fontFamily="var(--font-sans)">API gateway</text>
    <rect x="388" y="152" width="96" height="6" rx="3" className="sc-hero-rule" />
    <rect x="388" y="166" width="64" height="6" rx="3" className="sc-hero-rule" />
    <rect x="358" y="86" width="200" height="124" rx="18" fill="none" stroke="#16936A" strokeWidth="2" />
    <rect x="354" y="82" width="8" height="8" rx="2" fill="#16936A" />
    <rect x="554" y="202" width="8" height="8" rx="2" fill="#16936A" />

    {/* Two shapes, and the connector being drawn between them. */}
    <rect x="60" y="326" width="152" height="52" rx="12" fill={THEMES.lavender.bg} stroke={THEMES.lavender.edge} />
    <text x="136" y="357" textAnchor="middle" fill={THEMES.lavender.text} fontSize="13" fontWeight="600" fontFamily="var(--font-sans)">Orders</text>
    <ellipse cx="462" cy="302" rx="76" ry="32" fill={THEMES.peach.bg} stroke={THEMES.peach.edge} />
    <text x="462" y="307" textAnchor="middle" fill={THEMES.peach.text} fontSize="13" fontWeight="600" fontFamily="var(--font-sans)">Postgres</text>
    <path d={LINK} pathLength={1} className="sc-link" />
    <polygon points="386,302 376,296.5 376,307.5" className="sc-link-head" />

    <Cursor name="Noor" color="#16936A" ink="#fff" x={338} y={214} className="sc-hand sc-hand--noor" />
    <Cursor name="Kai" color="#3D7BEA" ink="#fff" x={384} y={302} className="sc-hand sc-hand--kai" />
    <Cursor name="Ada" color="#F3A024" ink="#161616" x={222} y={250} className="sc-hand sc-hand--ada" />
  </svg>
);

export const AuthShowcase: React.FC = () => {
  // A loop nobody can see is work for nothing: it stops with the tab.
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return (
    <section className="showcase" aria-label="What Vega Studio is" data-paused={hidden || undefined}>
      <div className="showcase__board">
        <MiniBoard />
      </div>
      <div className="showcase__caption">
        <h2 className="showcase__title">Design the system together</h2>
        <p className="showcase__body">Draw the architecture, review it where it is drawn, and keep the Mermaid and code beside it. Send the link and they are in.</p>
      </div>
    </section>
  );
};
