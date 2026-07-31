# Handoff

Written so the next session can start cold. Read this, then `README.md`. Delete
this file once its "next up" list is exhausted.

**This supersedes the previous handoff.** If anything here contradicts an older
note, this is newer.

> ## Read this first
>
> **The presence layer — remote cursors, off-screen arrows, radar — was rebuilt
> and has now been watched rendering on screen** with synthetic peers injected
> into awareness (§3 has the recipe; use it, it is quick). That found five real
> bugs that no amount of reading the code had. It is no longer "unconfirmed" in
> the way the previous handoff meant.
>
> **What still has not happened is two real browsers with two real mice.** That
> is the one check the automation tab genuinely cannot stand in for, and it is
> worth ten minutes before anything else. What to look for: your pointer shows
> up in the other window in your colour, the name chip fades after a couple of
> seconds of stillness and comes back when you move, panning your own canvas
> does *not* make their arrow slide relative to the content under it, and
> panning away from them puts an initialled marker on the edge you left by.

---

## 1. Start here

```bash
docker compose up -d              # Postgres, Redis, MinIO, sync server (:3000)
npm install                       # only if node_modules looks stale — see §6
npm run dev -w apps/frontend      # :5173
```

Verify in ~30 seconds:

```bash
cd apps/frontend
npx tsc -b            # must be silent
npm test              # 259 tests, 13 files
npx oxlint            # must exit 0 (8 known cosmetic warnings)
npx vite build        # must succeed
```

## 2. Where the work lives

All of this work is on the branch **`rebuild/time-travel-and-physics`**, nothing
pushed, nothing merged to `main`. The messages carry the reasoning — read
`git log` before changing any of it.

One caveat about the history. Everything from the design-system commit onward
was committed in one pass at the end, after the features had been built
together, so those commits group by feature but are **not individually
buildable checkpoints** — `index.css` in particular lands as one piece because
the sections were authored against one set of tokens. Earlier commits are
genuine step-by-step ones. Only the branch tip is verified.

| | |
| --- | --- |
| Typecheck | clean |
| Tests | **259** (was 33) across 13 files |
| Lint | exits 0; 8 `only-export-components` warnings, all cosmetic |
| Build | clean, ~1.21MB JS (still no code splitting) |

The newest work is the presence rebuild (§4a) — remote cursors, off-screen
arrows and the radar, plus the `collaboratorStore` they all read from. It is
the most recently touched part of the branch and the least exercised by real
use, though it is now the best covered by tests.

## 3. The one thing that will waste your time if you don't know it

**You very likely cannot observe the running app.** The Chrome extension renders
its tab offscreen: `document.visibilityState` is permanently `"hidden"`, so
**`requestAnimationFrame` never fires**, and synthetic pointer events do not
reach the Konva stage.

Consequences, all of which cost real time this session:

- Nothing driven by rAF runs — that is *all* physics, and the camera loop.
- Clicking, dragging and throwing cannot be simulated. `computer` clicks look
  like they land and do nothing.
- A screenshot still renders, so the app *looks* alive. It is not ticking.

What works instead:

- Konva binds its listeners to **`stage.content`**, not `stage.container()`.
  Dispatching a real event on `stage.content` does reach it.
- Drive the simulation by hand: `window.__physics` is the live
  `PhysicsSimulation`; call `applyForce(...)` / `launch(...)` then
  `advance(1000/60)` in a loop.
- `window.objectsMap` is the live Y.Map (long-standing debug hatch).
- Import app modules with `await import('/src/engine/document/index.ts')` — but
  note Vite appends `?t=` to files you have just edited, so a plain import can
  hand you a **second module instance** with its own state. If a store looks
  empty when it should not, that is why. Reload the page rather than trusting it.

**Because of all this, the simulation was extracted so it can be tested in
Node.** Prefer writing a failing test over trying to watch the bug.

**Two automation tabs cannot stand in for two users.** Both report
`visibilityState: "hidden"`, which means no rAF *and no CSS transitions* — an
element mid-fade is frozen at its start value, so `getComputedStyle(...).opacity`
reads `0` while the inline style correctly says `1`. Neither tab ever has a
pointer over the canvas either, so both publish `cursor: null` and drift to
`status: "away"`. Nearly every "the cursor is not rendering" reading collected
this session traced to that, not to the code. Read the **inline** style, not the
computed one, and ask the owner to confirm anything that needs two live users.

**But static rendering *can* be checked**, and you should when the work is
visual. Nothing static needs rAF or pointer events. Two harnesses, both used
this session:

- A standalone page in the scratchpad, served over HTTP (`file://` is rejected
  by the navigate tool — a one-line Node `http.createServer` is enough).
- Better, because it uses the real modules and the real tokens: import them into
  the running app and render into an injected overlay.
  `await import('/node_modules/.vite/deps/react.js')` (note: `.default`), and
  `react-dom_client.js` exposes `createRoot` on **`.default`**, not as a named
  export. Bust Vite's module cache with `?bust=${Date.now()}` after editing.
  That is how the cursor art in §4 was judged, and it caught three shapes that
  were genuinely bad and would otherwise have shipped.

### Fake a room full of people (use this)

Two automation tabs cannot be two users, but you do not need them to be. Peers
are just entries in the awareness map, and the presence frame loop can be
turned by hand — which makes the whole presence layer inspectable in one paste.
**This found five real bugs that reading the code did not.** In the console of
a room (sign in first, or set `vega_user` in `localStorage` and reload):

```js
const doc = await import('/src/engine/document/index.ts');
const cs  = (await import('/src/engine/presence/collaboratorStore.ts')).collaboratorStore;
const cam = (await import('/src/engine/CameraSystem.ts')).cameraSystem;
const ev  = (await import('/src/engine/EventBus.ts')).engineEvents;

doc.provider.awareness.states.set(1001, {
  user: { name: 'Dana Ito', color: '#F59E0B' },
  cursor: { x: 60, y: -30 },                                  // world coords
  viewport: { x: -500, y: -400, width: 1200, height: 800, zoom: 0.8 },
  activity: '✏️ Typing', status: 'online', selection: [],
});
doc.provider.awareness.emit('change', [{ added: [1001], updated: [], removed: [] }, 'local']);

cam.x = 620; cam.y = 330; cam.zoom = 0.62;
ev.emit('CameraChanged', cam);

// rAF never fires here, so turn the shared presence loop by hand.
for (let i = 0; i < 120; i++) cs.frameListeners.forEach((fn) => fn(16.7));
```

Then screenshot. Notes:

- Fake clients have no `meta` entry, so awareness's outdated-client sweep never
  removes them. They stay until you reload.
- `window.__radar.draw()` paints one radar frame on demand, and
  `window.__radar.hits` is where each collaborator's dot ended up on the map —
  dispatch a real `PointerEvent` at one of those to test click-to-fly.
- Read **inline** styles, not computed ones. A hidden tab freezes CSS
  transitions at their start value, so `getComputedStyle(...).opacity` lies.

## 4a. The presence rebuild (newest work)

`engine/presence/` now holds the whole "where is everyone" story. Read
`collaborators.ts` first — it is pure and its comments carry the reasoning.

| File | What it owns |
| --- | --- |
| `collaborators.ts` | normalizing awareness, the roster signature, edge placement. Pure, tested. |
| `radarProjection.ts` | framing and world↔radar mapping. Pure, tested. |
| `collaboratorStore.ts` | the one reader of awareness + the one presence frame loop |
| `useCollaborators.ts` | React bindings, incl. `useKeyedRef` |
| `RadarEngine.ts` | the radar's canvas-2d painter and its pointer handling |
| `../cursor/RemoteCursors.tsx` | other people's pointers |
| `../../components/PresenceEdgeMarkers.tsx` | who is off the edge of your screen |
| `../../components/Minimap.tsx` | the radar's panel, collapse state, zoom row |

Gone: `utils/PresenceStore.ts`, `utils/MinimapEngine.ts`,
`components/OffScreenPresence.tsx`.

### The rules that now hold

1. **One reader, as well as one writer.** `PresenceManager` writes;
   `collaboratorStore` reads. There were four readers before, with four
   different answers.
2. **One frame loop, and the radar does not own it.** It belongs to the store,
   is refcounted by its subscribers, and steps interpolation before anyone
   draws. It used to live in `MinimapEngine`, so **collapsing the radar froze
   the smoothing the cursors depended on**.
3. **Interpolate in world space.** Smoothing screen positions means your own
   pan drags everyone else's pointer along behind the content it is over.
4. **Roster changes go to React; positions go to the DOM.** `rosterSignature`
   is the line between them.
5. **Never hand a presence component a camera.** The camera is a singleton and
   these overlays fill the same box the canvas does. `OffScreenPresence` was
   mounted with `stageScale={1} stagePos={{x:0,y:0}}` and so described a view
   nobody was looking at; it also read `getStates()` during render with no
   subscription, so it barely updated at all.
6. **Place edge markers against the *visible canvas*, measured from the DOM.**
   The window's right edge is behind the Properties panel.
7. **Everyone present is represented by exactly one thing, always.** If their
   pointer is on screen that is the cursor; otherwise it is the avatar marker,
   which follows them onto the screen (chevron dropped) instead of hiding. See
   below for why this is not optional.

### "I can't see their cursor" — read this before changing anything

`clearCursor()` fires when a pointer leaves the canvas: a panel, another
window, another application. That is right — a stale arrow parked on the board
is worse than no arrow — but two consequences follow, and both have now been
reported as bugs:

- **You cannot see a remote cursor while testing alone with two windows.** Your
  mouse is in one of them; the other has correctly published `cursor: null`.
  Nothing is broken. Verified end to end on 2026-07-30 with two page instances
  in one room: a peer's cursor crosses the network and renders in their colour.
  The publish side was checked separately — a real `mousemove` dispatched on
  `stage.content` puts world coordinates straight into awareness.
- **A collaborator who is present but not pointing had nothing drawn for them
  at all**, because the edge marker also hid itself once their viewport came on
  screen. Following an arrow to someone and arriving showed empty canvas. That
  is what rule 7 fixes.

If someone reports a missing cursor again, establish which of the three it is
before touching code: (a) their `cursor` is genuinely `null` — check
`awareness.getStates()` on the *sender*; (b) it is on the wire but not in the
roster — check `collaboratorStore.live()`; (c) it is in the roster but not on
screen — check the portal's inline styles. Each is one console line.

### Bugs found by rendering it, not by reading it

Every one of these type-checked, linted and looked fine in the source.

1. **React runs `ref` callbacks child-first.** A child's callback that *looks
   up* the entry its parent's callback creates therefore always misses. The
   chip's offset was never applied, so it sat exactly on top of the arrow and
   hid the pointer behind its own name tag; the edge marker's chevron never
   rotated. Everything registers through an `ensure(...)` now.
2. **Inline `ref={(el) => f(id, el)}` is a new function every render**, so
   React detaches and re-attaches on *every* render and any per-node scratch
   state is destroyed. A marker whose "currently visible" record had just been
   reset would never be told to hide, and sat at full opacity pointing at
   someone in plain sight. Use `useKeyedRef`.
3. **A chevron rotating about the wrong origin** orbited at a 7px radius,
   underneath a 30px avatar, invisible from every angle.
4. **`placeChip`'s edge clamp becomes a lie off screen**: the arrow is clipped
   by the overlay and the name alone slides into the corner, belonging to
   nothing. Chips are dropped once the pointer leaves the viewport.
5. **`chipColorsFor` solves text-on-chip contrast only.** A deep colour gets
   deepened further, so Violet `#8B5CF6` becomes near-black — invisible against
   a dark board. The chip's ring in the raw identity colour is what carries
   that job; it is load-bearing, not decoration.
6. **An absolutely positioned child of a zero-sized element shrink-to-fits
   against zero.** The marker's pill is anchored to a 0×0 point, and its label
   is `overflow: hidden`, whose min-content width is 0 — so the pill collapsed
   to the avatar however long the name was. `width: max-content` on the pill is
   what makes it size from its contents. Do not remove it.

**A warning about measuring this in the automation tab.** Bug 6 looked
unfixable for several rounds because `getComputedStyle` kept reporting
`max-width: 0px` while the inline style said `190px`. That is the frozen-
transition artefact from §3, not the bug: the property is animated, and a
hidden tab never advances the transition. Set `style.transition = 'none'`
before measuring anything that has a transition on it.

### Showing what a collaborator is doing

One channel per question: the arrow says *where*, a badge in its tail says
*what they are holding*, a word beside the name says *what you cannot see*, and
a tag on the selection outline says *which object is theirs*. README has the
table and the reasoning; the parts that will bite you are:

- **The badge glyph vocabulary is shared with your own cursor** (`TOOL_GLYPHS`,
  `ToolBadge` in `cursorArt.tsx`). Do not fork it. A collaborator holding the
  pen must show the same shape your pointer shows when you hold the pen.
- **Glyphs are two or three strokes, no small features.** They render into a
  9px disc at `strokeWidth: 5` in a 24-unit box. A lucide pencil became a
  slash-in-a-circle (i.e. a "no entry" sign) and an outlined hand became a
  blob. Render the whole set at 4× before keeping any new one — the recipe is
  in §3, and cloning the live cursor SVGs into a panel is the fastest version.
- **`GLYPH_BY_TOOL` keys by tool id, `TOOL_GLYPHS` by cursor mode.** The badge
  asks a finer question than the pointer does: `image` and `audio` share the
  `place` cursor, but "placing a thing" and "live microphone" are not the same
  news. Shapes are split off from the pen for the same reason.
- **`select` and `pan` deliberately have no badge.** Not an oversight.
- **`ActivityKind` is a closed set of four, and only two have labels.** See
  `ACTIVITY_LABEL` for why `drawing` and `moving` travel but stay wordless.
  They are published from `ObjectRenderer`'s drag handlers and `Canvas`'s
  pointer down/up; the `up` clear is unconditional because a release over a
  panel is exactly where a stuck "drawing" state would live forever.

Deleted here: `components/canvas/ObjectPresenceIndicator.tsx`, mounted on every
object, holding a per-object awareness subscription and a react-konva `Html`
portal — to render nothing, ever, because it keyed off an `editing` field that
has never been written. Ownership is shown on the remote selection outline now.

### Also fixed here

**Your own cursor could be missing entirely, and often was.** `LocalCursor` set
`data-custom-cursor="on"` — which is what makes `index.css` apply
`cursor: none` — the instant it mounted, but only raised the drawn pointer on
`pointerenter`. **No `pointerenter` is ever delivered for a pointer that was
already inside the element**, so mounting with the mouse over the canvas hid
the system cursor and drew nothing: no pointer at all until you moved off the
canvas and back on. That happens on every reload with the mouse on the board,
and on every sign-in, because the auth modal unmounts and the room appears
underneath a mouse that never crossed a boundary.

Two changes, and the second is the one that matters:

1. Any pointer event *on the canvas* now marks the pointer as inside, not just
   `pointerenter`.
2. `data-custom-cursor` is applied **only while the drawn cursor is visible**
   (a layout effect keyed on that state, so both flip in the same paint and you
   never see two cursors for a frame). The invariant is now structural: the
   attribute cannot be on unless there is something drawn to replace what it
   hides. Do not move it back to mount time — that is the third time this
   codebase has shipped a hidden system cursor with nothing in its place.

`Canvas.tsx` published `viewport` **twice**: `presenceManager.updateViewport`,
*and* a raw `setLocalStateField` on every `CameraChanged` marked "for legacy
components". The second had no throttle at all, so one pan sent an awareness
update per frame to every peer and woke every peer's subscribers for each.

## 4. What changed, and the rules that now hold

### Time Travel (`engine/history/`, `components/TimeTravelBar.tsx`)

Replay **never reached the canvas** — `isReplaying` existed and the live observer
deferred to it, but nothing ever set it, and the snapshot went only to the
Layers/Properties panels. `useStore.applyReplaySnapshot` now owns that
transition (objects + scene graph + flag in one write).

`sessionTimeline.buildTimeline` turns the raw CRDT log into described,
attributed *moments* — a 14-step drag is one "Dave moved Ship the beta", not 14
steps. Keyframes make seeking backwards cheap. The server now reports how many
updates retention discarded (`rooms.updates_trimmed`), so "starts partway" is a
fact rather than a guess.

### Physics (`engine/physics/simulation.ts` + `hooks/usePhysics.ts`)

**The simulation is a plain module.** It imports Matter and the material
profiles and *nothing else* — no React, no Konva, no Yjs, no awareness. This is
the rule that makes physics testable at all; do not import any of those into it.
`usePhysics` is only an adapter: when to step, and what to do with the result.

Bugs fixed that are worth not reintroducing:

1. **Infinite mass.** Bodies created with `isStatic: true` never get mass or
   inertia computed, and waking does not restore them. Force scaled by mass
   became `Infinity`, Matter multiplied by an inverse mass of `0`, and every
   position became `NaN`. Build bodies *dynamic*, capture mass properties, then
   park them static (`wakeBody` restores).
2. **Never let a non-finite value reach the document.** `Y.Map` stores `NaN`
   happily and `toJSON()` turns it into `null`, so one bad frame strips a node's
   coordinates permanently, syncs that, and survives reload.
3. **Two coordinate spaces.** `SimTransform` carries both: `x`/`y` is the node's
   **top-left** (commit this) and `centerX`/`centerY` is the **Konva group
   origin** (render this). Writing the wrong one draws objects half their size
   off and makes them jump on landing.
4. **Fixed timestep.** Variable deltas make the same throw travel different
   distances depending on frame pacing. Note the `STEP_EPSILON` — float residue
   was silently dropping a step.
5. **Never broadcast or commit per object in a loop.** Ownership is claimed in
   one awareness write; settles commit in one `doc.transact`. Per-object
   versions produced thousands of network writes a second.
6. **`flightState` skips the local client.** Rendering your own broadcast pose
   while the loop also writes the Konva node makes objects visibly phase back
   and forth.

### Force as a mode (`engine/physics/forces.ts`, `components/ForcesBar.tsx`)

`FORCE_SPECS` is the single source for radius/strength/label — the field ring
you see is drawn from the same numbers the simulation uses. Picking a force tool
*is* turning force on; the header switch now only governs throw-on-flick.
Entering force mode snapshots the layout so "Restore layout" can undo the whole
session; `Canvas` clears that snapshot on **every** exit path.

**There is deliberately no world gravity.** An infinite canvas has no floor, so
a constant field would pull content off the board forever and nothing would ever
settle. "Drop" is a force you aim and hold. The reasoning is written into
`forces.ts` — read it before adding gravity.

### Materials (`utils/behaviorSystem.ts`)

Five user-selectable materials in the Properties panel. `material` is optional on
`BaseNode`; absent means "this type's default", which is what keeps older
documents behaving as before. Air drag was cut ~3× so a flick actually carries
(Paper 120px → 431px) with the ordering preserved and locked by tests.

### Cursors (`engine/cursor/`, `index.css`)

Rebuilt. The old system was 8 files and 362 lines to draw one arrow; it is now
4 files, and half of what it did was wrong.

- **The local cursor is custom-drawn** (`LocalCursor`, `cursorArt.tsx`), over
  the canvas only. This was briefly replaced with native CSS cursors — that was
  the wrong call for this product and was reversed; see "the two mistakes"
  below. Tools resolve to a *mode* (`cursorModeForTool`, pure and tested), and
  the art is a solid pointer with a tool badge in its tail, or a crosshair for
  the modes that need a point rather than a direction. Swaps are instant: no
  tween, no press response, by explicit decision.
- **Write the transform in the pointer event, never in a frame.** That single
  line is why the original custom cursor felt broken and this one does not — it
  stored a coordinate and applied it in `rAF`, so it was always a frame stale.
  `pointerrawupdate` is used where available because it is not coalesced.
- **`index.css` still carries a full set of native `[data-cursor-mode]`
  cursors.** They are the fallback for coarse pointers and `forced-colors`,
  where a drawn cursor cannot honour OS pointer size or contrast.
  `LocalCursor` sets `data-custom-cursor` on the container *itself*, so if it
  is absent or bails the canvas still has a pointer. Never put `cursor: none`
  in the markup — that is how the original ended up with no pointer at all.
- **There were four cursor authorities**, which is why none of them worked:
  `Canvas`'s inline style, `HandTool` writing `container.style.cursor`
  imperatively (fighting React for the same inline style), `cursorManager`, and
  a `Tool.cursor` field with a `ToolManager.getCursor()` that nothing ever
  called. Now one.
- **The awareness `cursor` field had two writers** — the bug the last handoff
  flagged. `presenceManager` is the only one now; `Canvas` routes through it.
  Note *why* it was worse than a race: `pushToAwareness` merges `localState`
  over what is already published, so the stale cursor was put back by the next
  unrelated presence update. Mouse-leave never stuck.
- **Remote cursors keep custom rendering** — nothing native to defer to. Three
  things moved into `remoteCursor.ts` and under test: frame-rate-independent
  smoothing (the old per-frame lerp converged 2.5× faster at 144Hz than at
  60Hz), WCAG-safe chip colours derived from the presence colour, and edge
  flipping so a chip near the viewport edge is not clipped away.
- **Do not paint a label in the raw presence colour.** Half the palette fails
  AA with white text and the other half fails with black; `chipColorsFor` moves
  the fill the shorter way to readability and is pinned by tests over every
  palette entry plus arbitrary input, because sign-in lets people choose.
- The native fallback cursors rasterise at **32px**, not the 24 of their
  viewBox. Windows' own pointers are about 32, and a smaller one reads as
  incidental. Hotspots are in 32ths — multiply a viewBox coordinate by 4/3.
- **The rule that hides the OS cursor must out-specify the mode rules.**
  `.canvas-container[data-custom-cursor="on"]` ties with
  `.canvas-container[data-cursor-mode="…"]`, and a tie is broken by source
  order — so written above them it lost to every one, and the system arrow was
  painted on top of the drawn one while everything else worked perfectly. It
  now carries both attributes. If you add another `.canvas-container[…]` cursor
  rule, check it against that one.
- **Remote cursor visibility must not depend on the frame loop.** It renders at
  `opacity: 0` and if only rAF raised it, a throttled tab showed nobody at all —
  indistinguishable from an empty room. `onCanvas` is part of the React identity
  signature and the JSX sets opacity; the loop does position only.

### The mistakes worth not repeating

All three cost the owner real time, and all three were avoidable.

1. **I took the previous handoff's "drop the local cursor for native CSS" as
   settled and never checked it against what the product is supposed to feel
   like.** It is a whiteboard for creative work; a plain OS arrow on the canvas
   is the wrong answer no matter how good the accessibility argument is. The
   direction was reversed after shipping, at the owner's instruction. Ask before
   removing something expressive on technical grounds.
2. **I diagnosed "you can't see the change" three times without looking at
   what the change actually was.** Every reload and cache theory was wrong. The
   console line number `Canvas.tsx:505` settled it in one step, because that
   line only exists after the edit — compare
   `git show <before>:file | sed -n '505p'` against the current file. **A line
   number in a stack trace is a version fingerprint.** Reach for that before
   theorising. More generally: the owner's own observations ("clicking the
   avatar pans to empty canvas") were worth more than any of my inference, and
   led straight to a real bug in one step.
3. **I changed the meaning of a shared field and audited one of its four
   consumers.** Redefining `viewport` to store a top-left corner was right for
   the minimap and silently wrong for everything that navigates *to* a person.
   Grep every reader before changing what a published field means.

### Cursor art: fixed colours, not tokens

`cursorArt.tsx` draws in a fixed white/near-black, and the first version did
not — it used `--surface-primary` and `--text-primary` so it would follow the
theme. That is wrong for a cursor and looking at it made the reason obvious: a
pointer sits over **content**, not over the background. A `--surface-primary`
fill is near-black in dark mode, so the pointer dissolved into the canvas and
read as a hollow outline; it would have done the same over any dark object in
light mode. White fill, near-black outline, offset shadow.

Two shapes also had to be redrawn after seeing them rendered: a fine dashed
reticle stopped resolving as dashes at 28px and read as a wireframe globe, and
an outlined four-finger hand turned to mush below ~20px. **Render the art and
look at it** — the harness for that is in §3.

### Presence: cursor is not the same signal as viewport

Making mouse-leave actually clear the cursor exposed that `updateViewport` had
**never been called by anything**, so `state.viewport` was permanently `null`.
The radar had only the raw cursor to go on, and the old unthrottled window
mousemove had been hiding that by publishing a cursor from anywhere on the
page. Clear the cursor honestly and collaborators vanish from the minimap the
moment they touch a panel.

`ViewportState` was also the wrong shape — it stored only `x`/`y`/`zoom`, while
`MinimapEngine` reads `u.viewport.width / u.viewport.zoom`, so remote viewport
rectangles computed `NaN` and drew nothing. It now carries `width`/`height`
too, `Canvas` publishes on every `CameraChanged`, and the units are documented
on the type: `x`/`y` are **world** coordinates of the top-left, `width`/`height`
are **screen** pixels.

The rule: **cursor is "where the pointer is now" and is meant to disappear;
viewport is "where this person is working" and is meant to persist.** Anything
that needs someone to stay visible — radar, "Jump to…", off-screen markers —
reads viewport.

**`viewport.x`/`y` is the top-left corner, and almost nothing wants that.**
`navigateViewport` centres the camera on the point it is handed, so passing the
corner straight through lands you half a screen up and to the left — on empty
canvas. Three call sites did exactly that (the avatar row, follow mode, the
off-screen markers); only the minimap, which draws an actual rectangle, wanted
the corner. Use **`viewportCenter()`** from `engine/presence/PresenceTypes.ts`.
It lives next to the type so the units and the trap are documented together, it
degrades to the corner for peers on older builds that publish no `width`, and
it is covered by tests. Do not inline that arithmetic a fifth time.

### Wheel input (`Canvas.tsx`)

`onWheel` was on **both** the container and the Konva `Stage`, so every scroll
panned twice and every pinch zoomed twice. React also attaches wheel listeners
as passive, so the `preventDefault()` was rejected — hundreds of console
warnings, and the browser applied its own page zoom on top of the canvas
camera. It is now one native listener with `{ passive: false }`, which is the
only way to get a non-passive wheel handler; do not put it back on a React prop.

### UI (`ToolWorkspace`, `WorkspaceShell`, `index.css`)

- The dock **must not clip**: it used `overflow-y: hidden`, which cut off every
  tooltip and flyout, because they are positioned above the buttons. No z-index
  escapes an ancestor's overflow. It wraps instead.
- Dock flyouts (pen/shape/forces) share one menu state, open on click *and*
  hover, and close on Escape or outside press. Hover-only was unreachable on
  touch.
- Where there is no hover there are no tooltips, so touch gets permanent labels
  (`data-label` + `@media (pointer: coarse)`).
- The header button that opens Time Travel says **History**, not "Play".

## 4b. Comments, stickies, audio — audit and direction

The owner's standing instruction is to raise these three to something a
Figma/Notion-class team would ship, and has named them as the priority. What
follows is an audit, not speculation — each line was read in the source.

### Comments: what now exists

`engine/comments/` holds the parts worth testing; `components/comments/` holds
the surfaces. Read `threads.ts` first — it is pure and carries the reasoning.

| File | What it owns |
| --- | --- |
| `engine/comments/threads.ts` | mentions, unread, inbox order, pin anchoring, relative time. Pure, **31 tests** |
| `engine/comments/readMarks.ts` | per-person read state, `localStorage`, not the CRDT |
| `engine/comments/commentView.ts` | the one "show resolved" preference |
| `components/comments/MentionInput.tsx` | composer with `@` autocomplete |
| `components/comments/MessageBody.tsx` | renders mention chips |
| `components/comments/CommentInbox.tsx` | every thread in one list |

Rules that will bite if broken:

- **Read state is per person and never goes in the CRDT.** Putting it in the
  document would let your colleague opening a thread mark it read for you, and
  would grow the update log with data nobody else can use.
- **A mention is stored as `@[Display Name](authorId)`** — position matters
  ("ask @Dana, not @Mike" is not a name list), and the display name is captured
  at write time and never re-resolved. Rewriting an old message because
  someone changed their profile is editing history.
- **`mentions` is denormalised onto each message** even though it is derivable.
  "Does anything unread name me" runs over every message of every thread on
  each render of the pins *and* the inbox.
- **Your own message is never unread to you**, and marks never move backwards —
  opening an old thread must not un-read a newer message in it.
- **The expanded thread and the draft composer are portaled to `<body>`.** The
  comments overlay is z-index 40 inside the canvas, beneath both side panels,
  and clips to its own `overflow: hidden`. Rendered in place, an open thread
  near either edge was unreadable and untypeable. The pins stay in the overlay;
  only the focused surface goes above the chrome. Because the pin and the panel
  are then in different subtrees, the outside-click handler has to ignore
  `[data-comment-pin]` or the pin's own click closes and reopens the thread.

### Fixed already

- **Authorship was a per-session id.** `localAuthorId()` returned
  `awareness.clientID`, which Yjs re-mints on every reload. Comment edit and
  delete are author-only and compared against it, so **a reload made your own
  comments permanently read-only to you** — and because client ids are random
  32-bit numbers, a later visitor could be handed one and inherit edit rights
  over someone else's words. It now prefers the persisted `user.id` that
  `AuthContext` mints, published on the awareness `user` field. This also fixes
  attribution generally: `createdBy` is stamped with the same function, so one
  person across two sessions used to look like two people.
  **Comments written before this keep their old session-scoped `authorId` and
  are editable by nobody. That is the safe direction; do not "repair" them by
  reassigning ownership.**
- **A thread opened off-screen near the right or bottom edge.** The 320px panel
  was hard-pinned below-right of its pin. It flips across the anchor now, the
  same rule the cursor chips and edge markers use.

### Still open, roughly in value order

**Comments** — unread, mentions, the inbox and rotation-aware anchoring are
done (§4b above). What is left:
- **Pins do not cluster or scale with zoom.** At low zoom a dense board becomes
  a wall of overlapping pins. This is now the biggest remaining gap.
- No notification when someone mentions you while you are looking elsewhere —
  the header badge counts, but nothing announces.
- Threads cannot be deleted as a whole, only message by message until the last
  one takes the thread with it.
- No rich text, no attachments, no emoji reactions on messages.

**Sticky notes** — reactions, the creation flow and the visual design are all
rebuilt (below). Still open:
- **`tags` is a dead field** — on the schema, written and read by nothing, for
  the project's whole life. It needs a decision rather than a quiet
  implementation: tags without a filter to use them are decoration, so either
  build the filter (the Layers panel is the natural home) or drop the field.
- Duplicating a sticky copies other people's reactions onto the copy, which is
  arguable at best.
- Notes do not resize to their content; only the type inside them does.

### Sticky notes: flow, type and paint

**A new note opens ready to type in.** It did not: `StickyTool` created the
node and stopped, so every note needed a double-click before you could write —
which loses the thought you dropped it for.

The mechanism is a **latch**, not an event (`engine/interaction/pendingEdit.ts`).
The obvious version — create the node, then dispatch `requestEditNode` — is a
race the tool always loses, because the renderer for the new node has not
mounted and nothing is listening. Waiting a frame makes it *usually* work,
which is worse. The tool sets the id first; the renderer claims it during its
own first render, so there is no window to miss. `Tab` chains another note
beside it (`stickyChain.ts`), and an empty note removes itself when you click
away — which is what makes dropping notes freely safe.

**The type is fitted, not stored** (`engine/model/stickyText.ts`). `fontSize`
was fixed and Konva clipped anything past the bottom edge, so typing past the
fold made your own words silently invisible. Two rules hold:
- **The canvas and the editor must agree exactly**, or the words jump the
  instant you stop typing. Both call `stickyFit`, which measures with a Konva
  probe — the only thing that knows how Konva wraps. An approximation with
  `measureText` and hand-rolled wrapping reflows the note under the caret.
- **Height alone is not enough.** A lone long word fits by height at a large
  size because the renderer hard-breaks it: "Onboarding" rendered as
  "Onboar / ding". `measureWord` refuses any size that would break a word.
  Found by rendering it; a height-only fit looks correct in every test.

**The paint.** The palette went from fully saturated highlighter colours to
paper weights with a deep same-hue ink and a hairline edge, because a wall of
saturated notes is exhausting and the colour should label the note rather than
compete with it. Gone with it: a 25px glow of the note's own colour
masquerading as a shadow, a white 15% wash that desaturated all eight themes
toward each other, a skeuomorphic peeled corner, a heavy filled author disc,
and a bespoke indigo selection state that ignored the hairline ring
`ObjectRenderer` already draws for every object. `RadarEngine` keeps a
duplicate of the palette — update both.

**The face is Caveat, by the owner's decision.** It was briefly swapped for
Inter on legibility grounds and swapped back on request; the handwriting is the
product's voice and that is not a technical call. Two things to keep:
- **Weight 600, never `bold`.** `index.html` loads Caveat at 400 and 600 only,
  and the renderer used to ask for 700 — so the browser synthesised it by
  smearing the 400 cut, which thickens strokes unevenly and fills the joins on
  a script face. That is why the old notes looked slightly muddy.
- **The type scale and leading are set for a script**, not a grotesque:
  Caveat's x-height is about two thirds of Inter's at the same nominal size, so
  the ceiling is 58 rather than 44, and the leading is 1.38 because script
  ascenders and descenders tangle at the 1.3 a UI face is happy with.

**Webfonts arrive after the first paint, and every size fitted before they do
is wrong.** Canvas measurement uses whatever font resolves at that instant, so
a cold load measured against the fallback cursive and then cached the answer
forever — notes subtly wrong on first visit, correct on reload, which is the
worst way for a bug to present. `stickyFontEpoch` clears the cache on
`document.fonts.ready` and re-renders; the epoch is part of the cache key so a
stale entry cannot survive.

### Sticky reactions: the CRDT shape, and two bugs the tests caught

`reactions` was `Record<emoji, number>`, incremented on click. That let one
person react five times, gave no way to take a reaction back except a "clear"
button that wiped **everyone's**, recorded nobody, and — the real defect —
**lost reactions**: two people reacting at the same moment each read the same
count, each wrote count + 1, and one silently vanished. In the one feature that
exists to be used simultaneously.

It is now a single flat `Y.Array<string>` of `emoji\0authorId` entries, seeded
at node creation. Getting there went through two wrong shapes, both of which
looked obviously correct and were caught by `reactions.test.ts`:

1. **`Y.Map<emoji, Y.Array<authorId>>` created lazily.** Two people reacting to
   a *fresh* note each build their own `Y.Map` and `set` it at the same key.
   **Concurrent `set` on one key is last-write-wins**, so a whole map — with a
   reaction inside it — is discarded.
2. **Seeding the outer map at creation.** Fixes the above and not the same bug
   one level down: the *per-emoji* `Y.Array` is still created on demand, so two
   people reacting with the same new emoji still race.

The rule: **any container created on demand can be created twice.** One flat
array has exactly one container, created once with the node, and every
operation after that is an insert or delete that Yjs merges. There is no key
left to race for.

Consequences to respect:
- **Never write `reactions` through `updateNode`.** It sets a plain object and
  would replace the shared structure with one client's snapshot of it.
- **Anything that creates a sticky must go through `createNode`**, which calls
  `seedReactions`. A note whose container is missing races on first use.
- `reactions.ts` imports Yjs and the normalizer and **nothing else** — not
  `doc.ts`, which touches `window`. That is what lets two real documents be
  driven in a Node test, and it is the same rule the physics simulation follows.
- Legacy `emoji → count` data is upgraded on first use, preserving the tally as
  synthetic `legacy:👍:0` ids that no real author can collide with.

**Audio** — playback and recording both rebuilt (below). Still open:
`transcript` is on the schema and never populated, and PNG export omits audio
players entirely (they are DOM overlays; SVG draws a placeholder).

### Voice notes: playback and recording

**The waveform is the scrubber.** It was forty inert `<div>`s — the one obvious
affordance on the component did nothing, and there was no other way to seek at
all. It is now a `role="slider"`: pointer drag with capture, arrows for five
seconds, Home/End, Space to play. `End` deliberately lands a hair short of the
duration, because seeking exactly to the end fires `ended` on some browsers and
looks like "start over".

**A voice note could not be selected or dragged.** This renderer draws *no
Konva shapes at all* — the player is a DOM overlay — so the node's group had
nothing in Konva's hit graph, and both gestures go through that graph. Every
other type has real shapes and so never showed it. Two things were needed:

- **A `Rect` with a `fill`.** A fill, even `transparent`, is what puts a shape
  in the hit graph; without one it is invisible to hit testing as well as to
  the eye. Do not delete it because it "draws nothing".
- **The card is `pointer-events: none`, and only its controls opt back in.**
  With `auto` on the whole card the overlay swallowed every event before Konva
  saw it. Now a press on the background falls through to the canvas and lands
  on the rect above, while the buttons still claim their own.

**`Html` mounts its children after your effects run.** This is the trap in this
file and it will catch the next person too. `react-konva-utils`' `Html`
renders into a container it creates itself, so a `useEffect` in the same
component reading `audioRef.current` finds **`null`**, bails, and with a stable
dependency array never runs again — nothing bound to the element at all: no
duration, no position, no progress, a permanent `0:00 / 0:00`. The version
before it only appeared to work because its deps changed on interaction and
gave it a second chance by luck. **Wire the element from a `ref` callback**,
which fires exactly when the element exists. Same lesson as `pendingEdit` and
`useKeyedRef`: when timing is the question, a latch or a callback beats an
effect.

**Progress is a clipped overlay, not coloured bars.** Filling whole bars means
the display changes only when the playhead crosses one — about once a second
on a 35-bar waveform — so playback looked frozen. The played portion is a
second copy of the waveform in the accent colour, absolutely positioned over
the first and revealed with `clip-path`. Both layers share a box and lay out
identically, so the bars register by construction rather than by arithmetic,
and the edge moves sub-pixel.

**Position has two sources, deliberately.** `timeupdate` is the baseline (~4Hz,
but it keeps running in a backgrounded tab) and a frame loop smooths on top
while playing. Only one note can play, so that is one loop for the whole board.
Do not delete the `timeupdate` path in favour of the loop: playback would then
be exactly as live as `requestAnimationFrame` happens to be, which in a
throttled tab is not at all.

**The waveform overflowed the card on every real recording.** The recorder
stores **50** peaks and creates a **240px** node. One bar per peak at a 2px
flex floor with 2px gaps needs ~198px of waveform, and the card has about 134px
to give once the play button, speed control and padding have taken theirs —
flex will not shrink below a minimum width, so the bars simply ran out of the
card. `barCountFor(width)` derives the bar count from the space available and
`resampleWaveform` reduces the peaks to it, keeping the **loudest** of each
bucket rather than the average, because averaging flattens speech into a mound.
`min-width: 0` on the bars and `overflow: hidden` on their row are the backstop.
Verified at 240px (35 bars) and 380px (48, the cap) with no overflow.

Other fixes worth not undoing:
- **Duration comes from the element, not the document.** Uploaded clips are
  created with `durationMs: 0` and nothing ever filled it in, so they showed
  `0:00 / 0:00` while audibly playing and their progress could never move. The
  first client to load one now writes the real duration back.
- **One note plays at a time.** Two players talking over each other with no way
  to tell which to stop is not a canvas-specific problem and does not deserve a
  canvas-specific answer.
- **Position comes from `timeupdate`**, not a `requestAnimationFrame` loop per
  playing note reading a number that changes four times a second — and the old
  loop only ran while playing, so a paused player could not show a seek.
- **Peaks are normalised for display.** A quiet recording drawn literally is a
  flat line that reads as broken.

**The HUD is a panel like every other floating panel** — `panel-surface`, same
border, same shadow, same radius language as the radar, the tool dock and the
comment inbox. It was briefly inverted to copy the macOS menu-bar recording
pill; `--surface-inverse` resolves to a *light* capsule in dark theme, so the
HUD became the only white object on a dark board. Do not reach for the inverse
surface here: the red dot is the recording signal and needs no help. Its meter
is a fixed 84px of hairlines and carries no mask, gradient or other effect — a
subtle effect that misfires reads as a rendering bug, which is worse than not
having it.

**Recording.** A denied or missing microphone used to `console.error` and stop:
from the user's side, pick the tool, click, and *nothing happens at all* — no
note, no message, no clue that a permission is being auto-denied. It now says
which failure it was and what to do. Also added: **Escape or Discard throws the
take away** (Stop was the only exit and it keeps the recording, so a false start
meant placing a note and then hunting it down), and a five-minute cap that
*keeps* the take, because an unattended recording holds the microphone open and
grows the peak array by sixty samples a second until the tab closes.

### Tags, and the filter that earns them

`tags` sat on the schema for the project's whole life, written and read by
nothing. Tags and their filter shipped together, because a tag you cannot act
on is decoration.

- **Normalised** (`engine/model/tags.ts`): lower-cased and hyphenated, so
  "Needs Design", "needs design" and "needs-design" are one tag. Free-text
  tagging without this is useless within a week.
- **The filter matches *any* selected tag, not all.** An all-of filter over
  hand-typed tags returns nothing almost every time, and a filter that usually
  returns nothing gets abandoned.
- **The canvas dims, it does not hide.** Filtering on a canvas is worth more
  than filtering a list precisely because you see the matches *among* their
  neighbours; hiding would throw away the spatial context that is the whole
  point of the board.
- **The filter is not in the CRDT and is not persisted.** It is a way of
  looking: your colleague narrowing to `risk` must not empty everyone's board,
  and a filter left on yesterday makes the app look broken tomorrow. It prunes
  itself when the last note carrying a tag is deleted, or the board filters to
  nothing with no visible cause.

The Properties panel lost its **Text Size** control in the same pass: it set a
`fontSize` nothing reads any more, since sticky type is fitted to the note.

## 5. Next up

**The owner has redirected the work** (2026-07-31). The priority is now the
canvas application itself, against a full specification of what a modern
canvas tool is — frames and artboards, guides and smart snapping, boolean
path operations, auto-layout, gradients and blend modes, effects, a real
typographic engine, components and instances, image adjustments, prototyping,
and an export pipeline. That specification lives in `docs/CANVAS-SPEC.md`
along with what already exists and what does not.

Two things are explicitly **deferred, not dropped**, and should be picked up
once the canvas work is at a natural stopping point:

- **Watch presence with two real browser windows.** Ten minutes; see the box
  at the top for what to look for. The owner has reported this area broken
  twice, and the automation tab genuinely cannot stand in for it.
- **The shell around the canvas: auth, room lifecycle, dashboard, landing.**
  Held to the same bar as the canvas, and worth designing as one system. The
  facts as of today:
  - **There is no router.** `App.tsx` is
    `path.startsWith('/room/') ? <Room/> : <Home/>` against
    `window.location.pathname`, and every navigation is
    `window.location.href = …` — a full page reload, so the Y.Doc, the
    IndexedDB provider and the WebSocket are torn down and rebuilt each time.
    This is the biggest structural gap outside the canvas.
  - **A workspace cannot be deleted at all.** `recentWorkspaces` is read in
    `Home.tsx` and written in `Room.tsx`; there is no delete anywhere, so the
    earlier note about "no confirm flow" understated it.
  - **The dashboard lists workspaces from `localStorage`** and never checks
    the server, so a room deleted server-side lingers as a card.
  - `Home.tsx` carries 42 inline `style={{}}` blocks and hand-rolled
    `onMouseEnter`/`onMouseLeave` hover, and neither it nor `AuthModal` uses
    the `Button`/`IconButton` primitives that now exist.
  - There is no landing page. Logged out you get the auth modal; logged in,
    the dashboard.

Still true and still unscheduled: **bundle splitting** — 1.21MB, no chunks,
with Konva, Matter and framer-motion the obvious lazy candidates.

### Design direction

**The owner has been explicit about this and it overrides technical
preferences**: the interface should feel dynamic, clean and modern, not generic.
That is what reversed the native-cursor decision. When a change would make the
product plainer in exchange for a technical virtue, raise it — do not just take
it.

There is a `design inspirations/` folder at the repo root (untracked) with
reference screenshots — canvas tools with dot grids, floating segmented docks,
hairline borders, tight radii on chrome, and one dark board showing remote
presence done well. Look at it before designing any new surface. Two
independent design-skill references are also worth reading for their rules
rather than their tooling: `github.com/pbakaus/impeccable` (craft floor:
contrast, depth with offset *and* blur, motion as one authored moment,
exponential ease-out over bounce) and `github.com/Leonxlnx/taste-skill`.

Where those rules collide with this codebase, the codebase wins — both tell you
to avoid Inter, and `--font-sans` is Inter. A committed visual world beats a
generic anti-pattern list.

### Known gaps

- **Presence has not been seen with two real mice** — see the box at the top.
- **A remote cursor that fades in depends on a CSS transition completing.** In a
  hidden tab that transition is frozen at `opacity: 0`. It resolves when the tab
  becomes visible, so this is probably benign — but read inline styles, not
  computed ones, when judging it.
- **`clearCursor()` fires on the canvas's `mouseleave`.** That is semantically
  right, but if any sibling overlay ever covers the canvas, moving over it
  clears the cursor and the collaborator's arrow winks out. The radar and the
  edge markers no longer depend on this (viewport does that job); the arrows do.
- **The radar frames everyone's viewport, including someone far away.** That is
  the point of it, but one collaborator 3000px off does shrink the content to a
  corner of the map. If that turns out to be annoying in practice, the honest
  fix is to include distant peers as clamped edge dots rather than as full
  rectangles, not to drop them.
- **Two people off-screen in nearly the same direction produce overlapping edge
  markers.** They are offset enough to read as a stack; there is no clustering.
- **The dashboard lists workspaces from `localStorage` and never checks the
  server**, so a deleted room lingers as a card. Hit repeatedly while testing;
  fix this as part of item 1.
- Adapter-level physics code (Konva writes, awareness broadcasts) is still
  untested — that is exactly where the landing-jump bug lived. Extracting the
  pose-write into a pure function would close it.
- Presentation mode (`isUiVisible`) hides chrome. Remote cursors are
  deliberately **not** behind it — see the comment at their mount in `Room.tsx`
  before putting them back.
- PNG export omits audio players (DOM overlays, not canvas).
- Groups are flat; no permissions; auth is a display identity, not an account.

## 6. Environment notes

- **`@hocuspocus/server` version skew** is the classic trap here. Confirm 4.4.0:
  `node -e "console.log(require('./node_modules/@hocuspocus/server/package.json').version)"`.
- Vite picks the first free port from 5173. **Each port is a separate origin**, so
  `localStorage` and IndexedDB do not carry across ports. If the dashboard looks
  empty or you appear as a different user, check the port.
- Server changes need `docker compose up -d --build server`.
- Physics is behind the **Throw** switch for flicks only, and that preference is
  persisted per origin — if throwing seems dead, check `vega_physics_enabled` in
  `localStorage` before debugging the simulation.
- Rooms in Postgres are recreated by the sync server whenever a client is still
  connected. Close the tab *before* deleting a test room or it will come back.

## 7. Where things live

`README.md` has the full map. The files to read first:

1. `engine/model/schema.ts` — the data model everything obeys
2. `engine/document/` — CRDT ownership, the single write path, normalization
3. `hooks/useStore.ts` — the one bridge from document to UI
4. `engine/physics/simulation.ts` — physics, with nothing else attached
5. `components/Canvas.tsx` — input, tools, camera, the shared transformer
6. `engine/presence/PresenceManager.ts` — the single writer of ephemeral state
7. `engine/presence/collaboratorStore.ts` — the single reader of it
8. `engine/presence/PresenceTypes.ts` — small, but it documents the units that
   three call sites got wrong

The cursor system:

| File | What it owns |
| --- | --- |
| `engine/cursor/toolCursor.ts` | tool id → cursor mode. Pure, tested. |
| `engine/cursor/cursorArt.tsx` | the drawn shapes, one per mode |
| `engine/cursor/LocalCursor.tsx` | your pointer: hit-testing, positioning, native fallback |
| `engine/cursor/RemoteCursors.tsx` | everyone else's pointers |
| `engine/cursor/remoteCursor.ts` | chip colour, edge flipping, smoothing. Pure, tested. |
| `index.css` (§ "CANVAS CURSORS") | native fallbacks + the `cursor: none` handover |

The rest of the presence layer is mapped in §4a.
