import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { AnyNode, FrameNode } from '../../engine/model/schema';
import { descendantsOfFrame } from '../../engine/model/frames';
import { isPlaceholder } from '../../engine/slides/placeholderText';
import { matchSlides, sameProportion, type MoveNode } from '../../engine/slides/smartMove';
import type { TransitionSpec } from '../../engine/slides/slideMeta';
import { CSS_EASINGS, DIVE_SHARE, paneFrame, playableTransition } from '../../engine/slides/transitionMath';
import { solidFill } from '../../engine/slides/themes';
import { SlidePlan } from './SlidePlan';

/**
 * A slide's transition, played in miniature.
 *
 * The previous slide and this one, drawn as plans, perform the transition the
 * panel is set to whenever the pointer rests on the preview (or it has focus
 * and Space is pressed), with the slide's own length and curve. Smart move
 * plays the real match: the objects the two slides share travel between
 * their places. Under reduced motion it plays the quick dissolve the show
 * itself would.
 */
export const TransitionPreview: React.FC<{
  from: FrameNode | null;
  to: FrameNode;
  objects: Record<string, AnyNode>;
  spec: TransitionSpec;
}> = ({ from, to, objects, spec }) => {
  const root = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const play = playableTransition(spec, reduced);
  const travellers = useMemo(() => (play.kind === 'smart' && from ? travellersOf(from, to, objects) : []), [play.kind, from, to, objects]);
  const hideTo = useMemo(() => new Set(travellers.map((t) => t.toId)), [travellers]);
  const hideFrom = useMemo(() => new Set(travellers.map((t) => t.fromId)), [travellers]);

  useEffect(() => {
    if (!playing) return;
    const el = root.current;
    if (!el) return;
    const a = el.querySelector<HTMLElement>('.tp-from');
    const b = el.querySelector<HTMLElement>('.tp-to');
    const stage = el.querySelector<HTMLElement>('.tp-board');
    const anims: Animation[] = [];
    const ms = Math.max(200, play.ms);
    const timing: KeyframeAnimationOptions = { duration: ms, easing: CSS_EASINGS[play.ease], fill: 'both' };
    const go = () => {
      anims.forEach((x) => x.cancel());
      anims.length = 0;
      if (!a || !b) return;
      switch (play.kind) {
        case 'none':
          anims.push(a.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], { duration: 900, fill: 'both' }));
          break;
        case 'dissolve':
          anims.push(a.animate([{ opacity: 1 }, { opacity: 0 }], timing));
          break;
        case 'push':
        case 'slide': {
          const s = paneFrame(play.kind, play.direction, 0);
          const e = paneFrame(play.kind, play.direction, 1);
          const pose = (p: typeof s.from) => ({ transform: `translate(${p.x * 100}%, ${p.y * 100}%) scale(${p.scale})`, opacity: p.opacity });
          anims.push(a.animate([pose(s.from), pose(e.from)], timing), b.animate([pose(s.to), pose(e.to)], timing));
          break;
        }
        case 'zoom':
          anims.push(
            a.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(5)', opacity: 1, offset: DIVE_SHARE }, { transform: 'scale(6)', opacity: 0 }], {
              duration: ms,
              easing: CSS_EASINGS.gentle,
              fill: 'both',
            })
          );
          break;
        case 'glide':
          if (stage)
            anims.push(
              stage.animate(
                [
                  { transform: 'translateX(0) scale(1)' },
                  { transform: 'translateX(-27%) scale(0.86)', offset: 0.5 },
                  { transform: 'translateX(-54%) scale(1)' },
                ],
                timing
              )
            );
          break;
        case 'smart':
          anims.push(a.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, duration: ms * 0.7 }));
          el.querySelectorAll<HTMLElement>('.tp-traveller').forEach((t, i) => {
            const tr = travellers[i];
            if (!tr) return;
            const at = (box: MoveNode, color: string) => ({
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
              backgroundColor: color,
            });
            anims.push(t.animate([at(tr.from, tr.fromColor), at(tr.to, tr.toColor)], timing));
          });
          break;
      }
    };
    go();
    const loop = window.setInterval(go, ms + 900);
    return () => {
      window.clearInterval(loop);
      anims.forEach((x) => x.cancel());
    };
  }, [playing, play.kind, play.ms, play.ease, play.direction, travellers]);

  const base = from ?? to;
  return (
    <button
      ref={root}
      type="button"
      className="tp"
      data-kind={play.kind}
      data-playing={playing || undefined}
      aria-label={`Preview the transition into this slide${playing ? ', playing' : ''}`}
      onPointerEnter={() => setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      style={{ aspectRatio: `${base.width} / ${base.height}` }}
    >
      {play.kind === 'glide' ? (
        <span className="tp-board">
          <span className="tp-pane tp-from">{from ? <SlidePlan frame={from} objects={objects} /> : <span className="tp-blank" />}</span>
          <span className="tp-pane tp-to tp-to--beside">
            <SlidePlan frame={to} objects={objects} />
          </span>
        </span>
      ) : (
        <>
          <span className="tp-pane tp-to">
            <SlidePlan frame={to} objects={objects} hide={hideTo} />
          </span>
          <span className="tp-pane tp-from">
            {from ? <SlidePlan frame={from} objects={objects} hide={hideFrom} /> : <span className="tp-blank" />}
          </span>
          {travellers.map((t) => (
            <span key={t.toId} className="tp-traveller" data-text={t.text || undefined} />
          ))}
        </>
      )}
      {!playing && (
        <span className="tp-hint" aria-hidden="true">
          <Play size={12} />
          Hover to preview
        </span>
      )}
    </button>
  );
};

interface Traveller {
  fromId: string;
  toId: string;
  from: MoveNode;
  to: MoveNode;
  fromColor: string;
  toColor: string;
  text: boolean;
}

/** The objects a smart move would carry from `a` to `b`, with their boxes in slide units. */
function travellersOf(a: FrameNode, b: FrameNode, objects: Record<string, AnyNode>): Traveller[] {
  if (!sameProportion(a, b)) return [];
  const list = Object.values(objects);
  const members = (f: FrameNode) => {
    const ids = new Set(descendantsOfFrame(f.id, list));
    return list.filter((n) => ids.has(n.id) && !n.hidden && n.type !== 'frame' && !isPlaceholder(n as never)) as unknown as MoveNode[];
  };
  const plan = matchSlides(a, members(a), b, members(b));
  const colorOf = (n: MoveNode) => {
    const node = objects[n.id] as AnyNode & { typography?: { color?: string } };
    return solidFill(node as never) ?? node?.typography?.color ?? '#94A3B8';
  };
  return plan.pairs.slice(0, 24).map((p) => ({
    fromId: p.a.id,
    toId: p.b.id,
    from: { ...p.a, ...p.from },
    to: { ...p.b, ...p.to },
    fromColor: colorOf(p.a),
    toColor: colorOf(p.b),
    text: p.b.type === 'text',
  }));
}
