import React from 'react';
import { FO, lerp, PI, prog, RE, SA, SP, standard, TH, TIMES, win, type Pt, type ScriptedId } from '../../engine/learn/demoScript';
import { Bar, f, Face, grow, NameTag, PEOPLE, RemoteCursor, wander, type SceneProps } from './sceneKit';

/**
 * The Collaboration page's scenes: other people on the board, drawn as they
 * look in the product (their colour, their name tag, the real arrow), and the
 * features that make a shared board feel shared.
 *
 * Remote people move on `wander`, a smooth function of the clock, so scrubbing
 * to any moment puts them exactly where the film would have them then.
 */

const SA_RESOLVE = TH.resolve;
const SA_SEND = TH.send;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const Dots: React.FC<{ dx?: number; dy?: number }> = ({ dx = 0, dy = 0 }) => (
  <g>
    {range(6).map((r) =>
      range(10).map((c) => <circle key={`${r}-${c}`} className="sd-dot" cx={((14 + c * 24 + dx) % 240) - 8} cy={((8 + r * 22 + dy) % 140) - 4} r={1.1} />)
    )}
  </g>
);

/** A few stand-in objects to look at, in board units. */
const Objects: React.FC = () => (
  <g>
    {(
      <g>
        <rect className="sd-card" x={22} y={26} width={54} height={36} rx={4} />
        <Bar x={30} y={34} w={22} h={4} fill="var(--text-primary)" o={0.8} />
        <Bar x={30} y={44} w={34} h={3.5} />
      </g>
    )}
    <circle cx={128} cy={44} r={20} fill="var(--accent)" opacity={0.4} />
    <rect x={156} y={66} width={48} height={32} rx={4} className="sd-card" />
    <Bar x={164} y={74} w={26} h={4} fill="var(--text-primary)" o={0.8} />
    <Bar x={164} y={84} w={32} h={3.5} />
    <rect x={44} y={86} width={36} height={24} rx={4} fill="#FFE9A8" stroke="#EED593" strokeWidth={1} />
  </g>
);

/* ============================================================== cursors */

const CursorsScene: React.FC<SceneProps> = ({ t }) => {
  const maya = wander(t, 142, 44, 40, 16, 0.4);
  // Ravi walks to a card, picks it up and carries it across the board.
  const reach = prog(t, 1200, 1800);
  const carry = prog(t, 3600, 1800, standard);
  const card = [lerp(44, 100, carry), lerp(86, 94, carry)] as const;
  const grabbed = prog(t, 3000, 240, (x) => x);
  const raviStart: Pt = [110, 112];
  const ravi: Pt = t < 3200 ? [lerp(raviStart[0], 62, reach), lerp(raviStart[1], 98, reach)] : [card[0] + 18, card[1] + 12];
  const jo = wander(t + 900, 60, 56, 22, 10, 2.1);

  return (
    <g>
      <Dots />
      <g>
        <rect className="sd-card" x={22} y={22} width={54} height={36} rx={4} />
        <Bar x={30} y={30} w={22} h={4} fill="var(--text-primary)" o={0.8} />
        <Bar x={30} y={40} w={34} h={3.5} />
        <circle cx={130} cy={46} r={18} fill="var(--accent)" opacity={0.4} />
        <rect x={160} y={74} width={46} height={30} rx={4} className="sd-card" />
        <Bar x={168} y={82} w={24} h={4} fill="var(--text-primary)" o={0.8} />
      </g>

      {/* The card Ravi carries, with his selection around it. */}
      <rect x={f(card[0])} y={f(card[1])} width={36} height={24} rx={4} fill="#FFE9A8" stroke="#EED593" strokeWidth={1} />
      <rect x={f(card[0] - 3)} y={f(card[1] - 3)} width={42} height={30} rx={6} fill="none" stroke={PEOPLE.ravi.color} strokeWidth={1.5} opacity={grabbed} />

      <RemoteCursor x={f(maya[0])} y={f(maya[1])} name={PEOPLE.maya.name} color={PEOPLE.maya.color} />
      <RemoteCursor x={f(ravi[0])} y={f(ravi[1])} name={PEOPLE.ravi.name} color={PEOPLE.ravi.color} />
      <RemoteCursor x={f(jo[0])} y={f(jo[1])} name={PEOPLE.jo.name} color={PEOPLE.jo.color} o={prog(t, 500, 400)} />
    </g>
  );
};

/* ================================================================ follow */

const Avatars: React.FC<{ ring?: number }> = ({ ring = 0 }) => (
  <g>
    <rect className="sd-card" x={158} y={6} width={58} height={20} rx={10} />
    <Face x={170} y={16} color={PEOPLE.ravi.color} initial="R" />
    <Face x={FO.face[0]} y={FO.face[1]} color={PEOPLE.maya.color} initial="M" />
    <Face x={206} y={16} color={PEOPLE.jo.color} initial="J" />
    {ring > 0.01 && (
      <circle cx={FO.face[0]} cy={FO.face[1]} r={9 + ring * 3} fill="none" stroke={PEOPLE.maya.color} strokeWidth={1.6} opacity={0.9 * (1 - ring)} />
    )}
  </g>
);

const FollowScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.follow;
  const click = prog(t, T.clickAt, 480);
  const frame = prog(t, T.clickAt + 150, 420) * (1 - prog(t, T.escAt + 100, 320));
  const glide = prog(t, T.clickAt + 700, 3000, standard);
  const cam = { x: lerp(0, -62, glide), y: lerp(0, -14, glide), s: lerp(1, 1.32, glide) };
  const maya = wander(t, 130, 58, 36, 12, 0.8);

  return (
    <g>
      <g transform={`translate(${f(cam.x)} ${f(cam.y)}) scale(${f(cam.s)})`}>
        <Dots />
        <Objects />
        <RemoteCursor x={f(maya[0])} y={f(maya[1])} name={PEOPLE.maya.name} color={PEOPLE.maya.color} />
      </g>

      <Avatars ring={click} />

      {frame > 0.01 && (
        <g opacity={frame}>
          <rect x={2} y={2} width={220} height={124} rx={7} fill="none" stroke={PEOPLE.maya.color} strokeWidth={2.4} />
          <rect x={8} y={8} width={72} height={15} rx={7.5} fill={PEOPLE.maya.color} />
          <text className="sd-tag-text" x={15} y={18.2} style={{ fontSize: '7px' }}>
            Following Maya
          </text>
        </g>
      )}
    </g>
  );
};

/* ============================================================ spotlight */

const SpotlightScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.spotlight;
  const pulse = (t % 1500) / 1500;
  const invite = prog(t, 1000, 520) * (1 - prog(t, T.goAt + 200, 320));
  const chip = prog(t, T.goAt + 300, 420);
  const glide = prog(t, T.goAt + 200, 2600, standard);
  const cam = { x: lerp(0, -54, glide), y: lerp(0, -10, glide), s: lerp(1, 1.24, glide) };
  const view = { x: 118, y: 22, w: 96, h: 66 };
  const framed = chip;

  return (
    <g>
      <g transform={`translate(${f(cam.x)} ${f(cam.y)}) scale(${f(cam.s)})`}>
        <Dots />
        <Objects />
        {/* What the presenter is showing: their view, in their colour. */}
        <rect x={view.x} y={view.y} width={view.w} height={view.h} rx={5} fill={PEOPLE.maya.color} opacity={0.07} />
        <rect x={view.x} y={view.y} width={view.w} height={view.h} rx={5} fill="none" stroke={PEOPLE.maya.color} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.85} />
        <rect
          x={view.x - 6 * pulse}
          y={view.y - 6 * pulse}
          width={view.w + 12 * pulse}
          height={view.h + 12 * pulse}
          rx={5 + 4 * pulse}
          fill="none"
          stroke={PEOPLE.maya.color}
          strokeWidth={1.2}
          opacity={0.5 * (1 - pulse)}
        />
        <NameTag x={view.x} y={view.y - 12} name="Maya's view" color={PEOPLE.maya.color} />
      </g>

      {invite > 0.01 && (
        <g opacity={invite} transform={`translate(0 ${f((1 - invite) * -14)})`}>
          <rect className="sd-card" x={44} y={10} width={150} height={32} rx={9} />
          <circle cx={58} cy={26} r={2.6} fill={PEOPLE.maya.color} />
          <circle cx={58} cy={26} r={2.6 + 5 * pulse} fill="none" stroke={PEOPLE.maya.color} strokeWidth={1} opacity={0.7 * (1 - pulse)} />
          <text className="sd-pill-text sd-pill-text--s" style={{ fill: 'var(--text-primary)' }} x={68} y={28.6}>
            Maya is presenting
          </text>
          <rect className="sd-pill" x={SP.go[0] - 17} y={SP.go[1] - 7} width={34} height={14} rx={7} />
          <text className="sd-pill-text sd-pill-text--s" x={SP.go[0]} y={SP.go[1] + 2.6} textAnchor="middle">
            Follow
          </text>
        </g>
      )}

      {framed > 0.01 && (
        <g opacity={framed}>
          <rect x={2} y={2} width={220} height={124} rx={7} fill="none" stroke={PEOPLE.maya.color} strokeWidth={2.4} />
          <rect x={8} y={8} width={72} height={15} rx={7.5} fill={PEOPLE.maya.color} />
          <text className="sd-tag-text" x={15} y={18.2} style={{ fontSize: '7px' }}>
            Following Maya
          </text>
        </g>
      )}
    </g>
  );
};

/* ================================================================== ping */

const Ripple: React.FC<{ t: number; at: number; x: number; y: number; color: string; name: string }> = ({ t, at, x, y, color, name }) => {
  const age = t - at;
  if (age < 0 || age > 2600) return null;
  const tag = win(t, at + 100, at + 2200, 260);
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const p = prog(t, at + i * 240, 1300);
        return p > 0 && p < 1 ? <circle key={i} cx={x} cy={y} r={3 + 30 * p} fill="none" stroke={color} strokeWidth={2.2 - 1.2 * p} opacity={0.85 * (1 - p)} /> : null;
      })}
      <circle cx={x} cy={y} r={3.4 * (1 - prog(t, at + 1700, 500))} fill={color} />
      <NameTag x={x + 6} y={y + 6} name={name} color={color} o={tag} />
    </g>
  );
};

const PingScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.ping;
  return (
    <g>
      <Dots />
      <Objects />
      <Ripple t={t} at={T.pingAt} x={PI.spot[0]} y={PI.spot[1]} color={PEOPLE.ravi.color} name="You" />
      <Ripple t={t} at={T.pingAt + 1900} x={168} y={92} color={PEOPLE.jo.color} name={PEOPLE.jo.name} />
    </g>
  );
};

/* ============================================================ reactions */

const GLYPH_COLOR = ['#E5484D', '#F5A524', '#F5C518', '#8E4EC6', '#F76B15', '#3E63DD'] as const;

const ReactionGlyph: React.FC<{ i: number; s?: number }> = ({ i, s = 1 }) => (
  <g transform={`scale(${s})`}>
    {i === 0 && <path d="M0 5 C-8 -1 -6 -7 -2.4 -6.6 C-1 -6.4 0 -5.2 0 -4.2 C0 -5.2 1 -6.4 2.4 -6.6 C6 -7 8 -1 0 5Z" fill={GLYPH_COLOR[0]} />}
    {i === 1 && <polygon points="0,-7 2,-2.4 7,-2 3.2,1.4 4.4,6.4 0,3.7 -4.4,6.4 -3.2,1.4 -7,-2 -2,-2.4" fill={GLYPH_COLOR[1]} />}
    {i === 2 && (
      <>
        <circle r={6.6} fill={GLYPH_COLOR[2]} />
        <circle cx={-2.3} cy={-1.6} r={0.9} fill="#5C4300" />
        <circle cx={2.3} cy={-1.6} r={0.9} fill="#5C4300" />
        <path d="M-3 1.6 Q0 5 3 1.6" fill="none" stroke="#5C4300" strokeWidth={1} strokeLinecap="round" />
      </>
    )}
    {i === 3 && (
      <>
        <polygon points="-6,6 -1,-5 5,1" fill={GLYPH_COLOR[3]} />
        <circle cx={4} cy={-4} r={1.1} fill="#30A46C" />
        <circle cx={-1} cy={-6} r={1} fill="#F5A524" />
        <circle cx={6} cy={-1} r={1} fill="#E5484D" />
      </>
    )}
    {i === 4 && (
      <>
        <circle r={6.6} fill={GLYPH_COLOR[4]} />
        <circle cx={-2.3} cy={-1.8} r={1.2} fill="#fff" />
        <circle cx={2.3} cy={-1.8} r={1.2} fill="#fff" />
        <ellipse cx={0} cy={2.6} rx={1.7} ry={2.1} fill="#5C2A00" />
      </>
    )}
    {i === 5 && (
      <>
        <rect x={-6} y={-0.5} width={3.4} height={6.5} rx={0.8} fill={GLYPH_COLOR[5]} />
        <path d="M-1.8 6 V0 L1.6 -6 Q3.4 -5.8 2.8 -2.2 H6 Q7.2 -2 6.6 0.4 L5.6 5 Q5.3 6 4.2 6Z" fill={GLYPH_COLOR[5]} />
      </>
    )}
  </g>
);

/** Which glyphs each tap sends, and from which lane. */
const SENDS: ReadonlyArray<ReadonlyArray<{ glyph: number; lane: number; delay: number }>> = [
  [{ glyph: 0, lane: 0, delay: 0 }],
  [
    { glyph: 2, lane: 0, delay: 0 },
    { glyph: 2, lane: 1, delay: 160 },
  ],
  [
    { glyph: 4, lane: 0, delay: 0 },
    { glyph: 0, lane: 1, delay: 140 },
    { glyph: 1, lane: 2, delay: 280 },
  ],
];

const ReactionsScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.reactions;
  const floats: React.ReactNode[] = [];
  SENDS.forEach((group, g) => {
    const startBase = T.taps[g] + 60;
    group.forEach((fl, k) => {
      const at = startBase + fl.delay;
      const p = prog(t, at, 2200);
      if (t < at || p >= 1) return;
      const x0 = RE.btn(g === 0 ? 0 : g === 1 ? 2 : 4)[0] + [-6, 4, 14][fl.lane];
      const y = lerp(104, 26, p);
      const x = x0 + Math.sin(p * 6 + k * 1.7) * 5;
      const o = Math.min(1, (t - at) / 160) * (1 - prog(t, at + 1500, 700, (v) => v));
      const s = 0.4 + 0.6 * prog(t, at, 300);
      floats.push(
        <g key={`${g}-${k}`} transform={`translate(${f(x)} ${f(y)})`} opacity={o}>
          <ReactionGlyph i={fl.glyph} s={f(s * 1.25)} />
        </g>
      );
    });
  });

  return (
    <g>
      <rect className="sd-card" x={26} y={8} width={172} height={88} rx={4} />
      <Bar x={38} y={20} w={54} h={6} fill="var(--text-primary)" o={0.85} />
      <Bar x={38} y={34} w={96} h={4} />
      <Bar x={38} y={43} w={78} h={4} />
      <rect x={140} y={56} width={46} height={30} rx={3} fill="var(--accent)" opacity={0.35} />

      <rect className="sd-card" x={46} y={102} width={132} height={20} rx={10} />
      {range(6).map((i) => {
        const tapAt = i === 0 ? T.taps[0] : i === 2 ? T.taps[1] : i === 4 ? T.taps[2] : -1;
        const age = tapAt >= 0 ? t - tapAt : -1;
        const squash = age >= 0 && age < 320 ? 0.84 + 0.16 * prog(t, tapAt, 320) : 1;
        return (
          <g key={i} transform={`translate(${RE.btn(i)[0]} ${RE.btn(i)[1]}) scale(${f(squash)})`}>
            <ReactionGlyph i={i} s={0.9} />
          </g>
        );
      })}
      {floats}
    </g>
  );
};

/* ================================================================ thread */

const ThreadScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.thread;
  const pin = prog(t, T.pinAt, 360);
  const open = prog(t, T.pinAt + 200, 520) * (1 - prog(t, T.resolveAt + 500, 520));
  const typed = prog(t, T.pinAt + 1000, 1500, (x) => x) * (1 - prog(t, T.sendAt, 80, (x) => x));
  const sent = prog(t, T.sendAt, 420);
  const reply = prog(t, T.sendAt + 800, 460);
  const resolved = prog(t, T.resolveAt, 320);
  const quiet = prog(t, T.resolveAt + 500, 400);
  const pinColor = resolved > 0.5 ? 'var(--text-tertiary)' : PEOPLE.maya.color;
  const caret = Math.floor(t / 480) % 2 === 0;

  return (
    <g>
      <Dots />
      <rect className="sd-card" x={34} y={34} width={64} height={46} rx={4} />
      <Bar x={42} y={44} w={26} h={4.5} fill="var(--text-primary)" o={0.8} />
      <Bar x={42} y={55} w={42} h={3.5} />
      <Bar x={42} y={63} w={32} h={3.5} />

      {open > 0.01 && (
        <g opacity={open} transform={grow(108, 40, 0.84 + 0.16 * open)}>
          <rect className="sd-card" x={108} y={20} width={106} height={90} rx={7} />
          <Face x={120} y={32} r={5.5} color={PEOPLE.maya.color} initial="M" />
          <Bar x={129} y={30} w={24} h={3.5} fill="var(--text-primary)" o={0.8} />
          <circle cx={SA_RESOLVE[0]} cy={SA_RESOLVE[1]} r={6} fill={resolved > 0.01 ? 'var(--text-primary)' : 'none'} stroke="var(--text-primary)" strokeWidth={1.3} opacity={0.9} />
          <path d="M195.2 32.2 L197.4 34.4 L201 30" fill="none" stroke={resolved > 0.01 ? 'var(--surface-primary)' : 'var(--text-tertiary)'} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />

          <g opacity={sent} transform={`translate(0 ${f((1 - sent) * 6)})`}>
            <rect x={116} y={42} width={78} height={17} rx={6} fill="var(--text-tertiary)" opacity={0.2} />
            <Bar x={122} y={48} w={56} h={3.5} fill="var(--text-primary)" o={0.7} />
          </g>
          <g opacity={reply} transform={`translate(${f((1 - reply) * 10)} 0)`}>
            <Face x={124} y={73} r={5.5} color={PEOPLE.ravi.color} initial="R" />
            <rect x={133} y={64} width={72} height={17} rx={6} fill={PEOPLE.ravi.color} opacity={0.14} />
            <Bar x={139} y={70} w={44} h={3.5} fill="var(--text-primary)" o={0.7} />
          </g>

          <rect x={116} y={84} width={72} height={18} rx={9} className="sd-well" />
          <Bar x={123} y={91.5} w={f(56 * typed)} h={3.5} fill="var(--text-primary)" o={0.75} />
          {caret && typed < 1 && typed > 0 && <rect x={f(125 + 56 * typed)} y={88.5} width={1.4} height={9} fill="var(--text-primary)" />}
          <circle cx={SA_SEND[0]} cy={SA_SEND[1] + 2} r={6.5} className="sd-pill" />
          <path d="M195.5 92.2 L201.8 90 L199.6 96.4 L198.4 93.4Z" style={{ fill: 'var(--surface-primary)' }} />
        </g>
      )}

      <g transform={grow(TH.pin[0], TH.pin[1], 0.4 + 0.6 * pin)} opacity={pin}>
        <circle cx={TH.pin[0]} cy={TH.pin[1]} r={7} fill={pinColor} stroke="var(--surface-primary)" strokeWidth={1.5} />
        {quiet < 0.5 ? (
          <text className="sd-tag-text" x={TH.pin[0]} y={TH.pin[1] + 2.4} textAnchor="middle">
            2
          </text>
        ) : (
          <path d={`M${TH.pin[0] - 2.6} ${TH.pin[1]} l2 2 l3.4 -4`} fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </g>
    </g>
  );
};

/* ================================================================= share */

const ShareScene: React.FC<SceneProps> = ({ t }) => {
  const T = TIMES.share;
  const role = prog(t, T.roleAt, 380);
  const copied = prog(t, T.copyAt, 260);
  const toast = win(t, T.copyAt + 200, T.copyAt + 2200, 280);
  const join = prog(t, T.copyAt + 1500, 700);
  const dialog = { x: 36, y: 8, w: 152, h: 98 };
  const segX = lerp(52, 92, role);
  const ravi: Pt = [lerp(236, 204, join), lerp(70, 62, join)];

  return (
    <g>
      <Dots />
      <rect className="sd-card" x={dialog.x} y={dialog.y} width={dialog.w} height={dialog.h} rx={8} />
      <Bar x={52} y={20} w={32} h={5} fill="var(--text-primary)" o={0.85} />
      <Bar x={52} y={32} w={96} h={3.5} />

      <rect x={52} y={44} width={120} height={20} rx={6} className="sd-well" />
      <rect x={f(segX + 1.5)} y={45.5} width={37} height={17} rx={4.5} fill="var(--surface-primary)" stroke="var(--text-tertiary)" strokeWidth={1} />
      {['Edit', 'Comment', 'View'].map((label, i) => (
        <text key={label} className="sd-pill-text sd-pill-text--s" style={{ fill: 'var(--text-primary)', opacity: (i === 0 ? 1 - role : i === 1 ? role : 0.6) * (i === 2 ? 1 : 1) }} x={72 + i * 40} y={56.4} textAnchor="middle">
          {label}
        </text>
      ))}

      <g opacity={1 - role}>
        <Bar x={52} y={72} w={88} h={3.5} />
      </g>
      <g opacity={role}>
        <Bar x={52} y={72} w={72} h={3.5} />
      </g>

      <rect x={52} y={82} width={86} height={16} rx={5} className="sd-well" />
      <Bar x={58} y={88.5} w={52} h={3.5} fill="var(--text-primary)" o={0.55} />
      <rect x={SA.copy[0] - 15} y={SA.copy[1] - 8} width={30} height={16} rx={5} className="sd-pill" />
      {copied < 0.5 ? (
        <text className="sd-pill-text sd-pill-text--s" x={SA.copy[0]} y={SA.copy[1] + 2.5} textAnchor="middle">
          Copy
        </text>
      ) : (
        <path d={`M${SA.copy[0] - 3.6} ${SA.copy[1]} l2.6 2.8 l5 -5.6`} fill="none" stroke="var(--surface-primary)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {toast > 0.01 && (
        <g opacity={toast} transform={`translate(0 ${f((1 - toast) * 5)})`}>
          <rect className="sd-pill" x={80} y={111} width={64} height={13} rx={6.5} />
          <text className="sd-pill-text sd-pill-text--s" x={112} y={120.2} textAnchor="middle">
            Link copied
          </text>
        </g>
      )}

      <RemoteCursor x={f(ravi[0])} y={f(ravi[1])} name={PEOPLE.ravi.name} color={PEOPLE.ravi.color} o={join} />
      <Face x={206} y={16} color={PEOPLE.ravi.color} initial="R" o={join} />
    </g>
  );
};

export const COLLAB_SCENES: Partial<Record<ScriptedId, React.FC<SceneProps>>> = {
  cursors: CursorsScene,
  follow: FollowScene,
  spotlight: SpotlightScene,
  ping: PingScene,
  reactions: ReactionsScene,
  thread: ThreadScene,
  share: ShareScene,
};
