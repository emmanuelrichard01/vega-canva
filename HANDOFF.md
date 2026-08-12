# Handoff

Written so the next session can start cold. Read this, then `docs/CANVAS-SPEC.md`.

**This supersedes every previous handoff.** The presence/physics archaeology
that used to fill this file has been folded into the commit messages and the
spec; `git log` is now the record of *why*, and `docs/CANVAS-SPEC.md` is the
record of *what exists*. This file is only: how to run it, what will waste your
time, where the work stopped, and what is next.

> ## Read this first
>
> **Three phases of work have shipped without ever being watched running.**
> Phases 3, 4 and 5 — precision tools, the vector engine, the typographic
> engine — are covered by 556 tests and by reading, and by nothing else. The
> Chrome extension went unresponsive partway through Phase 3 and repeated
> attempts made it worse, so it was stopped rather than hammered.
>
> That is the single largest piece of outstanding risk on this branch. §3 has
> the recipe for what *can* be observed in a hidden tab and what genuinely
> cannot. If you can get a real browser in front of this, do that before
> writing anything new. What to look for is listed in §5.

---

## 1. Start here

```bash
docker compose up -d              # Postgres, Redis, MinIO, sync server (:3000)
npm install                       # only if node_modules looks stale — see §6
npm run dev -w apps/frontend      # :5173
```

Verify in ~30 seconds:

```bash
npx tsc --noEmit -p apps/frontend/tsconfig.app.json   # must be silent
npx vitest run                                        # 556 tests, 28 files
npx oxlint apps/frontend/src                          # 14 cosmetic warnings, exit 0
npm run build -w apps/frontend                        # must succeed
```

**Do not typecheck with `tsconfig.json`.** It is a solution file with no
`files` and no `include`, so `tsc -p apps/frontend/tsconfig.json` typechecks
*nothing at all* and exits 0. Several "tsc is clean" reports in this project's
history were vacuous for exactly that reason. Use `tsconfig.app.json`, or
`npm run build`, which runs `tsc -b`.

| | |
| --- | --- |
| Branch | `rebuild/time-travel-and-physics`, nothing pushed, nothing merged |
| Typecheck | clean |
| Tests | **556** across 28 files |
| Lint | exits 0; 14 `only-export-components` warnings, all cosmetic |
| Build | clean, **1.33MB** JS (gzip 409KB) — still no code splitting |

**Read the failing-suite line, not the test count.** Vitest reports a suite
that failed to *load* separately from tests that failed, so a file that throws
on import still leaves the summary reading "474 passed". That has already
caused one bad commit here (`f0c359c` fixes it and says so). Check
`Test Files  N passed (N)` — the two numbers must match.

## 2. Where the work lives

`docs/CANVAS-SPEC.md` is the map: ~100 discrete capabilities from the product
brief, each marked **Shipped / Partial / Dead / Absent**, with the reasoning
and the phase plan at the bottom. It is kept current — update it in the same
commit as the code, not after.

**"Dead" is the important category and it is worse than "Absent."** A dead
field is declared on the schema, written by something, and read by nobody — so
the app *claims* a capability it does not have, and every reader downstream is
entitled to believe it. Ten have been found and killed so far. The most recent
was `TextNode.autoHeight` (Phase 5). The rule that follows from it: **never
declare a capability the renderer ignores**, and **a feature ships with the
control that gives it a purpose**.

Recent commits, newest first:

| | |
| --- | --- |
| `2702a9a` | Phase 5 — text case, strikethrough, three-way text box resizing |
| `ed1db3d` | Phase 4 — anchor/handle editing, booleans, flatten, outline stroke, join/miter |
| `410e96d` | Phase 3 recorded, and what it left blocked on the group model |
| `f0c359c` | the snap tests were not loading; the count was lying |
| `a4b3905` | rulers, and guides you can pull out of them |

## 3. The one thing that will waste your time if you don't know it

**You very likely cannot observe the running app.** The Chrome extension
renders its tab offscreen: `document.visibilityState` is permanently
`"hidden"`, so **`requestAnimationFrame` never fires**, and synthetic pointer
events do not reach the Konva stage.

Consequences, all of which have cost real time here:

- Nothing driven by rAF runs — that is *all* physics, and the camera loop.
- Clicking, dragging and throwing cannot be simulated. `computer` clicks look
  like they land and do nothing.
- A screenshot still renders, so the app *looks* alive. It is not ticking.

What works instead:

- Konva binds its listeners to **`stage.content`**, not `stage.container()`.
  Dispatching a real event on `stage.content` does reach it.
- `window.objectsMap` is the live Y.Map (long-standing debug hatch).
- Import app modules with `await import('/src/engine/document/index.ts')` — but
  Vite appends `?t=` to files you have just edited, so a plain import can hand
  you a **second module instance** with its own state. If a store looks empty
  when it should not, that is why. Reload rather than trusting it.
- Read **inline** styles, not computed ones. A hidden tab freezes CSS
  transitions at their start value, so `getComputedStyle(...).opacity` reads 0
  while the inline style correctly says 1.

**Because of all this, prefer writing a failing test to trying to watch the
bug.** Every piece of arithmetic in this codebase lives in a pure module for
that reason — `smartGuides`, `pathGeometry`, `pathBoolean`, `strokeOutline`,
`imageCrop`, `rulerTicks`, `stickyText` all run in Node with no canvas.

**But static rendering can be checked, and you should when the work is
visual.** Nothing static needs rAF. Import the real modules into the running
app and render into an injected overlay:
`await import('/node_modules/.vite/deps/react.js')` (note `.default`), and
`react-dom_client.js` exposes `createRoot` on **`.default`**, not as a named
export. Bust Vite's cache with `?bust=${Date.now()}` after editing. That is how
the cursor art was judged, and it caught three shapes that would otherwise have
shipped.

There is also a trick for feeding the app a file without a backend: generate a
PNG in-page and hand it to the existing hidden `<input type=file>` via a
`DataTransfer`. That is how the crop overlay was verified.

## 4. The invariants — break these and you will reintroduce a known bug

Each was learned from a real defect here and is documented at its source.

1. **`engine/document/mutations.ts` is the only write path.** Nothing else
   touches the Y.Map.
2. **`width`/`height` on `BaseNode` are the only source of bounds.** `geometry`
   is *what shape*, never *how big*. `appearance` is paint. Nothing is stored
   in both.
3. **All reads are normalized at the CRDT boundary** (`normalize.ts`), so no
   consumer ever sees a legacy field. Every function there is total — it never
   throws and never returns undefined for a required field.
4. **Any CRDT container created on demand can be created twice.** Two people
   reacting to a fresh sticky each build their own `Y.Map` and `set` it at the
   same key; one is discarded. Seed containers with the node. See
   `reactions.ts`.
5. **Ephemeral state rides awareness or an external store, never the
   document.** Which anchor *you* have picked, which image *you* are cropping,
   which frames *you* have folded shut — none of that is a fact about the
   board. `cropMode`, `pathEdit`, `guideState` and `tagFilter` are the pattern.
6. **Never declare a capability the renderer ignores**, and **ship a feature
   with the thing that gives it a purpose.**

Konva specifics that have each cost a bug: `fillPriority` must be set on every
branch (Konva leaves stale fill props in place, and React does not unset props
it stops passing); filters need an explicit `cache()` and the cache must be
padded by three sigma or the blur clips flat against the node's edge; Konva has
no stroke alignment, no inner shadow, no shadow spread and no conic or diamond
gradient — all four are drawn by hand in `ShapeEffects.tsx` and
`paintPattern.ts`.

## 5. Next up

### 5a. Watch Phases 3–5 (do this first if a browser is available)

Nothing below is more valuable than this. Concretely:

- **The 22px stage inset.** `Canvas.tsx` insets the Konva stage by
  `RULER_SIZE` so screen coordinates and ruler marks describe the same world
  position. If those disagree the ruler is *worse* than not having one. This is
  the single riskiest unverified change on the branch.
- Smart guide lines appearing during a drag, and ruler ticks relabelling
  sensibly across a zoom range.
- Guides dragging out of the rulers, snapping, and double-click to delete.
- Double-click a pen path → anchors and handles appear; drag an anchor, drag a
  handle, Alt-drag to break the pair, click the outline to insert, Delete to
  remove one. Watch that the selection box tracks the shape (that is
  `reframePath` doing its job).
- The four booleans on two overlapping shapes — especially **subtract
  producing a visible hole**, which is the whole reason compound paths exist.
- Outline stroke on a thick dashed line; flatten a rounded rectangle and check
  the corners are still round.
- Text: case switching without the stored text changing, strikethrough, and
  the three resize modes (auto-width must not wrap, fixed must ellipsize).

### 5b. The two panels — this is the next build phase

The user's brief for this is long and specific; the short version is that both
panels exist, both are functional, and both are thin against what the brief
asks for. What follows is an audit, not a wish list.

**`components/LayersPanel.tsx` (596 lines) already does:** a virtualized
uniform-row tree (frames and group clusters, indented), inline rename, drag
reorder, per-row visibility and lock toggles, Shift-range and Cmd-toggle
multi-select, per-frame collapse held outside the CRDT, tag filtering, type
icons, and "so-and-so is editing this" badges from awareness. The
virtualization is load-bearing: a DOM row per object measured at 27ms per
document change with 500 objects, which was ~88% of the cost of moving one.

**What the brief asks for that is missing:**

- **Search and filter by name and by node type.** There is a tag filter and
  nothing else. This is the highest-value single item in the panel and it is
  self-contained — a pure predicate module plus a field at the top.
- **Keyboard navigation of the panel itself.** ↑/↓ to move, ←/→ to fold and
  unfold, Enter to rename, Cmd+↑/↓ to reorder, Space for visibility. The brief
  explicitly asks for the power-user path and there is currently none.
- **Frame wrapping** — turn a selection into a frame.
- **Reparenting by drag**, not just reordering.
- Section, Component, Instance and Mask node types. These are **blocked**:
  sections and masks are their own features, components are Phase 7.

**`components/PropertiesPanel.tsx` (1148 lines) already does:** Transform
(X/Y/W/H with aspect lock, rotation, flip), Appearance (fill with all five
paint types, opacity, corner radius, blend), Stroke (colour, weight, dash
preset, alignment, join, miter limit), Shadow, Inner Shadow, Layer Blur,
Backdrop Blur, Typography (family, size, weight, italic, underline,
strikethrough, case, alignment, line height, tracking, box resizing), plus
per-type blocks for Star, Polygon, line Ends, frame Safe Area, image Adjust,
Sticky, Physics and Metadata.

**What the brief asks for that is missing:**

- **It shows nothing for a multi-selection.** `Room.tsx` passes `selectedId`
  (singular), so selecting three objects gives you "Select an object". This is
  the most conspicuous gap in the panel and almost certainly part of what
  "weak and poorly implemented" refers to. Doing it properly means a mixed-value
  state — a field where two objects disagree shows *Mixed* and writes to all of
  them when edited.
- **It shows nothing when nothing is selected.** The brief wants global canvas
  state there: background colour, measurement units, ruler/grid visibility
  toggles, and the document's styles.
- **Independent corner radii and corner smoothing.** One uniform radius today;
  the brief wants four corners and a squircle parameter.
- Constraints/pinning grid and Auto Layout are **Phase 6**; component link,
  variants and exposed properties are **Phase 7**. Do not start those here.

**Suggested order**, cheapest-to-most-valuable first: layer search/filter →
properties for a multi-selection (with Mixed) → panel keyboard navigation →
global state when nothing is selected → independent corner radii → frame
wrapping and drag-reparenting.

### 5c. Still logged, from earlier phases

- **Real nested groups + deep select.** Groups are flat: members share a
  synthetic `parentId` and there is nothing to select *into*. This is a model
  change, and it is the same one auto-layout needs — so it belongs with
  **Phase 6**, not with selection or with the layers panel.
- **The scale tool** — distinct from the transformer, which resizes geometry;
  a scale tool multiplies strokes, radii, shadows and type along with the box.
  Only now well-defined, since all four of those became real.
- **Layout grid overlays**, which want a per-frame grid definition and belong
  with the frame work.
- **A compound path cannot be edited anchor by anchor** — the editor walks one
  run of anchors and a compound path is several.
- **Booleans decline on a rotated or scaled operand.** The geometry would need
  to go through the node's full transform first. The buttons disappear rather
  than producing a result that ignores the rotation.
- **Paragraph spacing, kerning and OpenType are one decision, not three.** All
  three want text off Konva's `Text` and off the `<textarea>` overlay. Worth
  making once, deliberately.
- **The shell around the canvas.** No router — every navigation is a full page
  reload rebuilding the Y.Doc. No workspace deletion. The dashboard reads
  `localStorage` only. No landing page.
- **Bundle splitting.** 1.33MB in one chunk.
- **Two real browsers with two real mice** — still the one check automation
  cannot stand in for.

### 5d. Not started from the brief

Excalidraw-style ideas, mermaid diagrams, wireframe-to-code, and the laser
pointer. The laser pointer is small and independent (it is ephemeral presence
state — see invariant 5) and could be slotted in any time.

## 6. Environment notes

- **`@hocuspocus/server` version skew** is the classic trap. Confirm 4.4.0:
  `node -e "console.log(require('./node_modules/@hocuspocus/server/package.json').version)"`.
- Vite picks the first free port from 5173. **Each port is a separate origin**,
  so `localStorage` and IndexedDB do not carry across ports. If the dashboard
  looks empty or you appear as a different user, check the port.
- Server changes need `docker compose up -d --build server`.
- Physics is behind the **Throw** switch for flicks only, persisted per origin
  — if throwing seems dead, check `vega_physics_enabled` in `localStorage`
  before debugging the simulation.
- Rooms in Postgres are recreated by the sync server while a client is still
  connected. Close the tab *before* deleting a test room.
- `apps/frontend/public/` holds favicon and logo assets the owner is editing
  directly. They show as modified/untracked in `git status` and are **not**
  part of this work — do not stage them.

## 7. Where things live

`README.md` has the full map. Read these first, in this order:

1. `engine/model/schema.ts` — the data model everything obeys
2. `engine/document/` — CRDT ownership, the single write path, normalization
3. `hooks/useStore.ts` — the one bridge from document to UI
4. `components/Canvas.tsx` — input, tools, camera, the shared transformer
5. `docs/CANVAS-SPEC.md` — what exists, what does not, and why

The vector engine (newest, and the densest):

| File | What it owns |
| --- | --- |
| `engine/model/pathGeometry.ts` | cubics, flattening, splitting, anchor-centric conversion, hit-testing. Pure, tested. |
| `engine/model/shapeToPath.ts` | every primitive → a real path. Pure, tested. |
| `engine/model/pathBoolean.ts` | the four booleans, over `polygon-clipping`. Pure, tested. |
| `engine/model/strokeOutline.ts` | a stroke → a filled region. Pure, tested. |
| `engine/document/vectorOps.ts` | the same operations as document edits |
| `components/canvas/PathEditor.tsx` | anchors and handles on screen |
| `engine/interaction/pathEdit.ts` | which path is open, which anchor is picked |

The precision tools:

| File | What it owns |
| --- | --- |
| `engine/interaction/smartGuides.ts` | alignment and spacing arithmetic. Pure, tested. |
| `engine/interaction/objectSnap.ts` | the adapter: candidates, zoom tolerance, re-entrancy guard |
| `engine/interaction/rulerTicks.ts` | tick steps and labels. Pure, tested. |
| `engine/document/guides.ts` | ruler guides, as document state on a root `Y.Array` |
