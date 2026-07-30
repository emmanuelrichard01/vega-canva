# Handoff

Written so the next session can start cold. Read this, then `README.md`. Delete
this file once its "next up" list is exhausted.

**This supersedes the previous handoff.** If anything here contradicts an older
note, this is newer.

> ## Read this first: one thing is unresolved
>
> **The owner reports that remote collaborator cursors do not appear**, and that
> is not confirmed fixed. Several real bugs in that path *were* found and fixed
> this session (see §4), any of which could have been the cause — but the last
> one landed without a confirmation from a second real browser.
>
> Every link in the chain was verified individually: the cursor publishes, the
> DOM node is created, it is positioned at the peer's coordinates, the chip
> colours resolve, and React sets `opacity: 1` when the peer has a cursor. What
> was **never** done is watch two *visible* browser windows with real mice at
> the same time — see §3 for why the automation tab cannot do it.
>
> **Start by reproducing it that way**, with two real windows, before changing
> any code. If it is still broken, instrument it: put a temporary on-screen
> readout of `state.cursor`, the node's `inlineOpacity`, and its `transform` on
> the page. Do not diagnose this one by inference — that already cost the owner
> several rounds this session (§4, "the mistakes").

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
npm test              # 119 tests, 7 files
npx oxlint            # must exit 0 (8 known cosmetic warnings)
npx vite build        # must succeed
```

## 2. Where the work lives

All of this work is on the branch **`rebuild/time-travel-and-physics`**, fifteen
commits, nothing pushed, nothing merged to `main`. Each commit builds on its own
and the messages carry the reasoning — read `git log` before changing any of it.

| | |
| --- | --- |
| Typecheck | clean |
| Tests | **119** (was 33) across 7 files |
| Lint | exits 0; 8 `only-export-components` warnings, all cosmetic |
| Build | clean, ~1.17MB JS (still no code splitting) |

The last four commits are cursor and presence work and are the least settled
part of the branch. `a7a5dce` is the newest; the open question above sits on
top of it.

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

## 5. Next up, in the order I'd do it

0. **Confirm remote collaborator cursors actually render** — the open item at
   the top of this file. Two real browser windows, mouse moving on the canvas in
   one, watching the other. This blocks nothing else, but it is the thing the
   owner last reported broken, so do not start feature work with it unresolved.
1. **Auth and room lifecycle screens** — sign-in, create, delete, welcome-back.
   Design together; they share one visual system. Note deletion has no confirm
   flow, and see the dashboard bug below.
2. **Landing page** — depends on the identity established in 1.
3. **A real first-run moment** — the empty state teaches the core gesture and
   nothing introduces Forces, History or materials.
4. **Bundle splitting** — 1.17MB, no chunks. Konva, Matter and framer-motion are
   the obvious lazy candidates.

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

- **Remote collaborator cursors are unconfirmed** — see the box at the top.
- **A remote cursor that fades in depends on a CSS transition completing.** In a
  hidden tab that transition is frozen at `opacity: 0`. It resolves when the tab
  becomes visible, so this is probably benign, but it is the same shape as the
  rAF bug that was just fixed and is worth a second look if cursors turn out to
  be genuinely invisible.
- **`clearCursor()` fires on the canvas's `mouseleave`.** That is semantically
  right, but if any sibling overlay ever covers the canvas, moving over it
  clears the cursor and the collaborator's arrow winks out. The radar no longer
  depends on this (viewport does that job), but the arrows do. Unverified
  suspect for the open item.
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
7. `engine/presence/PresenceTypes.ts` — small, but it documents the units that
   three call sites got wrong

The cursor system, if you are picking up the open item:

| File | What it owns |
| --- | --- |
| `engine/cursor/toolCursor.ts` | tool id → cursor mode. Pure, tested. |
| `engine/cursor/cursorArt.tsx` | the drawn shapes, one per mode |
| `engine/cursor/LocalCursor.tsx` | your pointer: hit-testing, positioning, native fallback |
| `engine/cursor/RemoteCursors.tsx` | everyone else's pointers **← the open item** |
| `engine/cursor/remoteCursor.ts` | chip colour, edge flipping, smoothing. Pure, tested. |
| `index.css` (§ "CANVAS CURSORS") | native fallbacks + the `cursor: none` handover |
