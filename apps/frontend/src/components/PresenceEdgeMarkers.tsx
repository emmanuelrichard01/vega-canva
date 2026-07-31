import React, { useCallback, useMemo, useRef } from 'react';
import { cameraSystem } from '../engine/CameraSystem';
import { collaboratorStore } from '../engine/presence/collaboratorStore';
import {
  useCollaborators,
  useKeyedRef,
  usePresenceFrame,
} from '../engine/presence/useCollaborators';
import { edgePlacement, formatDistance } from '../engine/presence/collaborators';
import { viewportCenter } from '../engine/presence/PresenceTypes';
import { relativeLuminance } from '../engine/cursor/remoteCursor';

/**
 * Where everybody is when they are not on your screen.
 *
 * On an infinite canvas this is not a nicety: two people who have panned apart
 * have no way of knowing the other exists, and the radar is a 260px widget in
 * a corner that you have to look at deliberately. A marker on the edge you
 * would leave by is the ambient version of the same fact.
 *
 * This replaces `OffScreenPresence`, which was broken in three separate ways
 * and had been for its whole life:
 *
 * - It was **mounted with a hardcoded camera** (`stageScale={1}`,
 *   `stagePos={{x: 0, y: 0}}`), so every calculation it did described a view
 *   nobody was looking at unless the canvas happened to be at the origin at
 *   100%.
 * - It read `provider.awareness.getStates()` **during render with no
 *   subscription**, so it only updated when the room re-rendered for some
 *   unrelated reason.
 * - It **clamped x and y independently**, which is not the same as walking the
 *   ray. Anything diagonal landed in the corner, so three people off in three
 *   directions stacked in one place and none of the markers pointed at anyone.
 *
 * It takes no props now. The camera is a singleton and the overlay fills the
 * same box the canvas does, so there is nothing left to pass in wrongly.
 */

/** How far in from the edge a marker sits. Room for the marker plus a margin. */
const EDGE_MARGIN = 48;
/**
 * Fraction of the visible canvas, measured from the right, inside which the
 * hover label has to grow leftwards instead — otherwise it expands straight
 * into the edge the marker is pinned to.
 */
const FLIP_ZONE = 0.34;

interface Registration {
  root: HTMLElement | null;
  /** The chevron, rotated to point along the ray. */
  arrow: HTMLElement | null;
  distance: HTMLElement | null;
}

/**
 * The chrome a marker must not slide underneath, as insets from the canvas.
 *
 * Placing markers against the raw window put them behind the Layers and
 * Properties columns, which is where a marker on the right-hand edge always
 * lands — the one edge a right-hand panel covers completely. Measured from the
 * DOM rather than assumed from the CSS, because the panels are conditional:
 * presentation mode removes them, and below 1024px they are overlays.
 */
interface SafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const NO_INSET: SafeArea = { left: 0, top: 0, right: 0, bottom: 0 };

function measureSafeArea(host: HTMLElement): SafeArea {
  const area = host.getBoundingClientRect();
  const inset = { ...NO_INSET };

  const edge = (selector: string, side: keyof SafeArea) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const amount =
      side === 'left'
        ? rect.right - area.left
        : side === 'right'
          ? area.right - rect.left
          : side === 'top'
            ? rect.bottom - area.top
            : area.bottom - rect.top;
    inset[side] = Math.max(inset[side], Math.min(amount, side === 'left' || side === 'right' ? area.width / 3 : area.height / 3));
  };

  edge('.workspace-header', 'top');
  edge('.hierarchy-panel', 'left');
  edge('.context-inspector', 'right');
  edge('.tool-dock', 'bottom');

  return inset;
}

export const PresenceEdgeMarkers: React.FC = () => {
  const collaborators = useCollaborators();
  const nodes = useRef(new Map<number, Registration>());
  const hostRef = useRef<HTMLDivElement>(null);
  const safeArea = useRef<SafeArea>(NO_INSET);
  const measureCountdown = useRef(0);

  // Only people whose whereabouts we actually know. Cursor is not enough —
  // it is cleared the moment a pointer touches a panel, and someone reading
  // their own notes on the far side of the board is exactly who this is for.
  const locatable = useMemo(() => collaborators.filter((c) => c.viewport), [collaborators]);

  // Hover is CSS now, not React state. The old version tracked the hovered
  // client in `useState`, which re-rendered every marker in the room to fade
  // one tooltip in.

  // `ensure`, not a lookup: React runs ref callbacks child-first, so the
  // chevron and the distance label register *before* the wrapper they live in.
  // Looking the entry up instead meant neither was ever recorded, and the
  // chevron — the entire point of the marker — never rotated to point at
  // anyone.
  const ensure = useCallback((clientId: number): Registration => {
    let entry = nodes.current.get(clientId);
    if (!entry) {
      entry = { root: null, arrow: null, distance: null };
      nodes.current.set(clientId, entry);
    }
    return entry;
  }, []);

  const register = useCallback(
    (clientId: number, el: HTMLElement | null) => {
      if (!el) {
        nodes.current.delete(clientId);
        return;
      }
      ensure(clientId).root = el;
    },
    [ensure]
  );

  const registerArrow = useCallback(
    (clientId: number, el: HTMLElement | null) => {
      ensure(clientId).arrow = el;
    },
    [ensure]
  );

  const registerDistance = useCallback(
    (clientId: number, el: HTMLElement | null) => {
      ensure(clientId).distance = el;
    },
    [ensure]
  );

  const rootRef = useKeyedRef(register);
  const arrowRef = useKeyedRef(registerArrow);
  const distanceRef = useKeyedRef(registerDistance);

  usePresenceFrame(() => {
    const host = hostRef.current;
    if (!host) return;

    // Panels do not move at frame rate, and four `getBoundingClientRect` calls
    // per frame is four forced layouts per frame. Twice a second is plenty to
    // keep up with a panel opening.
    if (measureCountdown.current-- <= 0) {
      measureCountdown.current = 30;
      safeArea.current = measureSafeArea(host);
    }

    const zoom = cameraSystem.zoom;
    const inset = safeArea.current;
    const origin = { x: inset.left, y: inset.top };
    const view = {
      width: Math.max(1, cameraSystem.width - inset.left - inset.right),
      height: Math.max(1, cameraSystem.height - inset.top - inset.bottom),
    };

    for (const person of collaboratorStore.live()) {
      const entry = nodes.current.get(person.clientId);
      if (!entry?.root || !person.viewport) continue;

      const world = viewportCenter(person.viewport);
      const screen = {
        x: world.x * zoom + cameraSystem.x - origin.x,
        y: world.y * zoom + cameraSystem.y - origin.y,
      };

      // If their pointer is on your screen, `RemoteCursors` is already drawing
      // them and a marker would contradict what you can see: an arrow at the
      // bottom edge saying someone is away to the south, while their cursor
      // sits in the middle of the canvas.
      const pointer = person.cursor;
      const pointerOnScreen =
        !!pointer &&
        edgePlacement(
          {
            x: pointer.x * zoom + cameraSystem.x - origin.x,
            y: pointer.y * zoom + cameraSystem.y - origin.y,
          },
          view,
          EDGE_MARGIN
        ) === null;

      if (pointerOnScreen) {
        entry.root.style.opacity = '0';
        entry.root.style.pointerEvents = 'none';
        continue;
      }

      /**
       * They have no visible pointer — so this marker *is* how they are
       * represented, wherever they are.
       *
       * A cursor is cleared the moment someone's pointer leaves their canvas:
       * they moved to a panel, switched to another window, or are reading
       * rather than pointing. That is correct — a stale arrow is worse than
       * none — but it left a hole. Hiding the marker whenever the person's
       * viewport happened to be on screen meant that following an arrow to a
       * collaborator and arriving showed you **nothing at all**: the marker had
       * just hidden itself, and there was no cursor to replace it. Someone
       * present, on your screen and not currently pointing was invisible.
       *
       * So the marker follows them onto the screen instead of vanishing. Off
       * screen it sits on the edge with a chevron pointing their way; on
       * screen it sits at the middle of their view with the chevron dropped,
       * because there is no direction left to indicate.
       */
      const edge = edgePlacement(screen, view, EDGE_MARGIN);
      const at = edge ?? screen;

      // Visibility is written here rather than in React because it depends on
      // the camera, which moves every frame. The markup renders these hidden,
      // so a stalled frame loop shows nothing rather than showing a marker
      // pointing somewhere the person no longer is.
      //
      // Written unconditionally rather than only on a change. Guarding it on a
      // remembered "is it currently shown" flag is one line shorter and was
      // wrong: any path that resets the record while the DOM keeps its old
      // style leaves a marker stranded at full opacity forever, and assigning
      // the same string to `style.opacity` costs nothing.
      entry.root.style.opacity = person.away ? '0.45' : '1';
      entry.root.style.pointerEvents = 'auto';
      if (entry.arrow) entry.arrow.style.opacity = edge ? '1' : '0';

      entry.root.style.transform = `translate3d(${at.x + origin.x}px, ${at.y + origin.y}px, 0)`;
      if (entry.arrow && edge) entry.arrow.style.transform = `rotate(${edge.angle}deg)`;

      const flip = at.x > view.width * (1 - FLIP_ZONE) ? 'left' : 'right';
      if (entry.root.dataset.flip !== flip) entry.root.dataset.flip = flip;

      if (entry.distance) {
        // World distance, not screen distance: "1.2k" should mean the same
        // thing at every zoom level, the way it does on a map. Dropped
        // entirely once they are on screen — "6px away" about someone you are
        // looking at is noise dressed up as information.
        let text = '';
        if (edge) {
          const centreWorld = cameraSystem.screenToWorld(
            origin.x + view.width / 2,
            origin.y + view.height / 2
          );
          text = formatDistance(Math.hypot(world.x - centreWorld.x, world.y - centreWorld.y));
        }
        if (entry.distance.textContent !== text) entry.distance.textContent = text;
      }
    }
  });

  if (locatable.length === 0) return null;

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 80 }}>
      {locatable.map((person) => (
        <div
          key={person.clientId}
          ref={rootRef(person.clientId)}
          className="presence-marker"
          style={
            {
              '--marker-color': person.color,
              // White or near-black by luminance, so the initials stay legible
              // without moving the identity colour underneath them.
              '--marker-ink': relativeLuminance(person.color) > 0.42 ? '#141821' : '#FFFFFF',
            } as React.CSSProperties
          }
        >
          {/* The chevron is the only part that rotates — turning the whole
              marker would stand the initials on their head every time someone
              panned past. Its wrapper is a zero-sized point at the avatar's
              centre, so the chevron orbits that centre; rotating a box the
              size of the avatar instead put the orbit at a 7px radius, tucked
              underneath a 30px avatar and invisible from every angle. */}
          <div ref={arrowRef(person.clientId)} className="presence-marker-orbit">
            <span className="presence-marker-chevron" style={{ color: person.color }} />
          </div>

          <button
            type="button"
            className="presence-marker-pill"
            onClick={() => {
              const target = collaboratorStore.find(person.clientId)?.viewport;
              if (!target) return;
              const centre = viewportCenter(target);
              window.dispatchEvent(
                new CustomEvent('navigateViewport', {
                  detail: { x: centre.x, y: centre.y, zoom: target.zoom || 1 },
                })
              );
            }}
            aria-label={`Jump to ${person.name}`}
          >
            <span className="presence-marker-avatar" aria-hidden="true">
              {person.initials}
            </span>
            {/* Grows out of the pill on hover rather than appearing beneath it
                as a second surface. Hidden from assistive tech because the
                button is already labelled — announcing the name twice is worse
                than not animating it at all. */}
            <span className="presence-marker-label" aria-hidden="true">
              {person.name}
              <span ref={distanceRef(person.clientId)} className="presence-marker-distance" />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
};
