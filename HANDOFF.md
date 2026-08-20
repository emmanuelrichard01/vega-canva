# Handoff

Written so the next session can start cold. Read this, then `DESIGN.md` if you
are touching anything visual, then `docs/CANVAS-SPEC.md`.

**This supersedes every previous handoff.** The presence/physics archaeology
that used to fill this file has been folded into the commit messages and the
spec; `git log` is now the record of *why*, and `docs/CANVAS-SPEC.md` is the
record of *what exists*. This file is only: how to run it, what will waste your
time, where the work stopped, and what is next.

> ## Read this first
>
> **The last session was a long feature pass, driven by the user reporting bugs
> faster than they could be verified.** The standing instruction is "minimise
> testing and calling claude in chrome, focus on building faster". Take it
> seriously — it is the working agreement — but know what it cost here: the
> user found **six** defects the work did not, and every one was the same
> shape.
>
> **All six were a second list that had fallen out of step with the first.**
>
> 1. Line and arrow moved to their own dock seat, and `SHAPE_KINDS` — the list
>    `Canvas` registers tools from — lost them. The tools stopped being
>    *registered at all*: the dock lit up, the cursor changed, clicking did
>    nothing. The comment above that loop warns about exactly this.
> 2. The same split left `shapeKindFromToolId` resolving against the seat's
>    list, so `shape-line` resolved to null and the **Shape** seat claimed it.
> 3. Fixing that made the resolver answer for *every* preset, so the Shape seat
>    then wore a **line icon** whenever the line tool was armed.
> 4. The line preview and the line commit each drew the box's diagonal rather
>    than the run, so a line drawn up-and-left rendered as the opposite
>    diagonal — "always stuck at an angle".
> 5. The sketch branch of `ShapeRenderer` returns before the crisp branch's cap
>    code, so a **sketched arrow silently lost its head**. It had also grown its
>    own copy of the label, so a sketched line's label sat in empty space.
> 6. `CommandPalette` carried a private `objectLabel` — `nodeLabel` as it stood
>    before shapes learned to name themselves — so the Layers panel said
>    "Rectangle" and the palette said "Shape" for the same object.
>
> The lesson, and it is invariant 7 again: **when you split a list, grep for
> every reader of it before you finish.** Each of these was one call site that
> still pointed at the old half.
>
> **A seventh turned up since, and this one was found by auditing rather than
> by the user.** The Keyboard & help modal — the screen people open precisely
> when they are lost — advertised four shortcuts that nothing listened for:
> `Cmd+A`, `Arrows`, `Shift+Arrows`, and `Cmd+0` for a reset bound to bare `0`.
> Roughly as many real bindings went undocumented. The file's own header
> comment warns that *a hint which lies is worse than no hint*, and holds the
> tool rows to that by deriving them from `TOOL_SHORTCUTS` — but that guarantee
> only ever covered one section, and everything written by hand below it
> drifted exactly as the comment predicted. Fixed in `260bcab`: three of the
> four are now **bound** rather than deleted, because they are keys a canvas
> should have. **If you write a list of shortcuts, derive it or bind it — do
> not type it.**
>
> **What the browser did catch that tests did not**: the Mermaid layout put a
> retry loop's decision diamond *below* both of its branches, because ranking
> included the back edge. The cycle test only asserted termination. Cycles are
> broken by DFS first now, with the failing diagram pinned as a test.

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
npx vitest run --root apps/frontend                   # 1084 tests, 61 files
npx oxlint apps/frontend/src                          # 16 cosmetic warnings, exit 0
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
| Tests | **1084** across 61 files |
| Lint | exits 0; 16 `only-export-components` warnings, all cosmetic |
| Build | clean, 1.55MB JS (gzip 488KB) + 128KB CSS (gzip 21KB) — still no code splitting |

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
| `54a9ad4`… | the line-profile arc — see §4a-iv. Twelve commits; read that section rather than the log |
| `f047011` | a line's box becomes what it draws; endpoints move into `geometry` |
| `a605dec` | the hooks-order bug that emptied the canvas on double-click |
| `42efea7` | selection restored after a tool change (a stale `React.memo` comparator) |
| `006d92e` | connectors: anchored binding, draggable ends, and the shape that moved while you drew |
| `f848435` | Blend and Blur hidden for connectors |
| `417ec41` | the keyboard audit recorded; §5a-ii restored |
| `260bcab` | the keyboard audit — nudge, Cmd+A and `?` bound, the help screen corrected |
| `44d807e` | diagrams as code, the line/arrow rework, the right-click menu, help, text layout |
| `5cebd12` | connectors given the appearance block they were declared to have |
| `54697cd` | preview versioning, star/polygon geometry, connector colour in Appearance |
| `0b83d28` | the colour picker and gradient editor off inline styles |
| `e0fee09` | ruler/grid toggles, the dot field, focus mode, export, share sheet |
| `ccf0594` | board covers that survive being opened |
| `16b7858` | the canvas empty state |
| `f615fa8` | layer search |
| `2702a9a` | Phase 5 — text case, strikethrough, three-way text box resizing |
| `ed1db3d` | Phase 4 — anchor/handle editing, booleans, flatten, outline stroke |

## 3. The one thing that will waste your time if you don't know it

**Observing the running app is unreliable, but not impossible.** It worked for
most of the last session. When it fails it fails in these ways, and each has
cost real time here.

Historically the extension rendered its tab offscreen, so `rAF` never fired and
synthetic pointer events never reached the stage. That was *not* the experience
last session — clicks, drags and physics all ran. Assume it may work, verify
that it is actually ticking, and fall back to the techniques below when it is
not. The renderer also freezes outright on long scripts: keep injected snippets
small, and expect `Runtime.evaluate` timeouts on anything that loops over the
whole document.

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

**The user has since asked to minimise browser checking outright** — "let's
move faster, minimise testing and calling claude in chrome, let's focus on
building faster" — and the extension has been reliably unreliable since. Treat
that as the working agreement.

**So prefer writing a failing test to trying to watch the bug.** Every piece of
arithmetic in this codebase lives in a pure module for that reason —
`smartGuides`, `pathGeometry`, `pathBoolean`, `strokeOutline`, `imageCrop`,
`rulerTicks`, `stickyText`, `layerSearch`, `boardPreview` all run in Node with
no canvas. When you find arithmetic inside a component, that is the bug: move
it out and assert it. `previewPolygonPoints` was extracted for exactly this
reason after a star drew as a block twice.

**And check your test is not vacuous.** Revert the fix and confirm the test
fails. Two physics tests here passed with the fix removed; they were measuring
`activeCount` when the defect was in settle *churn*. The habit has caught real
things — `appearanceTypes.test.ts` was checked this way and, on a first draft
with too broad an invariant, flagged `sticky` and `audio` as bugs when neither
was one.

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
7. **One source of truth, or a test that holds the copies together.** The
   properties panel gates each paint section on *two* things: the capability
   the registry declares, and a hand-maintained type list. The list forgot
   `connector`, so connectors had no colour control while the code that draws
   one sat right there looking correct. The list now lives in
   `engine/objects/appearanceTypes.ts` with `appearanceTypes.test.ts` holding
   it against the registry. Any time you find yourself writing a second list
   of types, write the test with it.

   **The prose form of this is the same bug and has no compiler.** The help
   modal's key list, and this file's own "what is missing" lists, are second
   records of a fact the code already holds. Both have been wrong in the same
   week: four shortcuts advertised and unbound, and two sections here still
   listed as missing after they shipped — one of them struck by the very commit
   that edited this file. Where a list can be derived, derive it
   (`TOOL_SHORTCUTS` → the help screen's tool rows). Where it cannot, strike it
   in the commit that finishes the work, never afterwards.
8. **A cache of derived data needs a version.** Board covers are summarised
   into `localStorage` and only rewritten when a board is opened, so a fix to
   the *renderer* cannot reach a board nobody has opened since. Bump
   `PREVIEW_VERSION` whenever `PreviewItem` changes meaning.

Konva specifics that have each cost a bug: `fillPriority` must be set on every
branch (Konva leaves stale fill props in place, and React does not unset props
it stops passing); filters need an explicit `cache()` and the cache must be
padded by three sigma or the blur clips flat against the node's edge; Konva has
no stroke alignment, no inner shadow, no shadow spread and no conic or diamond
gradient — all four are drawn by hand in `ShapeEffects.tsx` and
`paintPattern.ts`.

## 4a. What this session added

All committed together. The reasoning lives in the code; this is the map.

**Diagrams as code.** `engine/diagram/` — a Mermaid flowchart parser, a layered
layout, and a builder that produces real shapes and connectors. No `mermaid`
dependency: it is over a megabyte and renders an SVG, which is the one thing
this must not produce on a canvas whose point is that everything is editable.
Reads back out too, from any selection, including one drawn by hand. 26 tests.

**The line and arrow rework.** Drawn click–move–click, edited at their
endpoints (`engine/model/lineEnds.ts`), Shift constraining to 15° through one
function shared by both gestures. Six end styles unified with connectors, an
`endScale` control, sketched caps, and midpoint labels that stay upright and
contrast-check their own ink.

**A real text layout engine.** `engine/text/layout.ts` replaced one
`Konva.Text` per node. It is what made paragraph spacing, the per-line
highlight ribbon, honest vertical alignment and caret-on-click possible — all
four were blocked on the same missing thing, which was *where each line is*.

**The right-click menu**, the **Help modal**, the **Text block** tool, foldable
and hideable groups in the Layers panel, and a properties panel reordered into
canonical blocks.

**Two performance fixes worth knowing.** The eraser called `toJSON()` on every
object for every *step* of its sweep — ten thousand deserializations per
pointer move on a 500-object board — and deleted each object in its own
transaction, so one swipe cost a dozen undos. It now reads the normalized store
and transacts the whole sweep. The pencil now thins its stored centreline with
Douglas–Peucker at commit; the drawn outline is untouched, and that is where
nearly all the points were.

## 4a-ii. The keyboard audit (`260bcab`)

Small in code, worth reading before you touch any key handling.

**Keys are bound in four places and they all reach the same window.**
`Room.tsx` owns the global map (tools via `TOOL_FOR_KEY`, undo, the palette,
`\`, `0`, and now `Cmd+A` and `?`). `Canvas.tsx` owns everything scoped to a
selection (delete, duplicate, restack, group, `Cmd+B/I/U`, Enter, and now the
arrow nudge). `LayersPanel`, `Minimap` and `TimeTravelBar` each bind their own,
as **React handlers on a focused element** — which still bubble to the window,
so a global listener sees them too. Two consequences, both now handled and both
easy to reintroduce:

- **Arrows are claimed by four components.** Nudging is what the *board* means
  by an arrow, so it applies only when focus is on the board itself — `null`,
  `body`, or inside the stage container. Without that check, arrowing through
  the Layers tree would also drag the selection across the canvas.
- **`Cmd+A` is bound twice on purpose.** The Layers tree scopes it to the rows
  it is showing; the board means everything. The board handler stands aside on
  `e.defaultPrevented`, so the narrower one wins where it applies.

**`nudgeDelta` is a pure module** (`engine/tools/nudge.ts`) for the usual
reason, and the step is in **world units, not screen pixels**: a nudge is an
alignment gesture, and scaling it with zoom would make the same press mean
different things at 40% and 400%. A multi-object nudge is one
`applyNodePatches` transaction, so it is one press to undo. Locked objects are
skipped rather than the press being refused.

**`TOOL_NAMES` moved out of the modal** to `engine/tools/toolNames.ts`, held
against `TOOL_SHORTCUTS` by a test. The modal renders `TOOL_NAMES[id] ?? id`,
which fails *quietly* — a new tool would appear on the help screen under its
internal id, which is worse than not appearing.

**Corrected, not just added:** the reset is bare `0`, never `Cmd+0`; and zoom
listens for `ctrl+wheel`, which is also how every browser reports a trackpad
pinch — so the old `Cmd + Scroll` row named a key nothing binds on a Mac.

**Newly documented, all previously bound and invisible:** `\` to hide the
chrome, `Cmd+Shift+[`/`]` to restack, `Cmd+B/I/U` on type, Enter to edit the
selection, the minimap's pan/zoom/fit keys, and the replay bar's step, play and
jump. The list roughly doubled, so it no longer fits without scrolling; three
columns at that width would wrap descriptions, which costs more than the scroll
does. The CSS comment that claimed it all fit was corrected with it.

## 4a-iii. The connector rework (`006d92e` and after)

The user reported one bug and asked for one feature; the bug turned out to be
the smaller half.

**Objects moved while you were connecting them.** `ObjectRenderer` decided
`draggable` from the node alone and never asked which tool was armed, so
pressing on a shape to draw an arrow from it started a Konva drag — *and* the
tool still received its events, so the gesture both moved the box and drew a
connector from wherever the box ended up. The fix is one word: `selectable`,
already computed from `canSelectWith` and already gating the hover outline, now
gates dragging too. **If a tool cannot select an object it has no business
moving it**, and that is one predicate, not two.

**A selected connector had the bounding-box transformer, and it was inert.**
Not merely the wrong affordance — a connector's `width`/`height` are *derived*
from what its ends resolve to, so a resize drag wrote a box the next render
recomputed and discarded. The only way to change what an arrow joined was to
delete it and draw another. `ConnectorEditor` gives it two endpoint handles;
the transformer stands down under the rule already written for a solo line.

**Three ways to bind an end, and the precedence lives in one function.**
`ConnectorEnd` now carries `anchor: {u, v}` alongside `port`:

| | Means | Resolves to |
| --- | --- | --- |
| `port: 'auto'` | *this object* | whichever side faces the other end |
| `port: 'left'` etc. | *this side* | the edge midpoint |
| `anchor: {u, v}` | *this spot* | a point on the perimeter, in the node's own proportions |

Normalized rather than absolute for exactly the reason a connector stores a
node id rather than a coordinate: **the binding has to survive a resize**, and
a fixed offset slides off a box that gets narrower. The anchor is an *aim* —
`anchorPoint` projects it to the perimeter, keeping the free coordinate and
snapping the bound one, so an endpoint slides along an edge and round a corner.
The edge is chosen in **normalized space**, the same reasoning `portFacing`
already used: on a 400x60 node a point 60px left of centre and 40px above is
barely a third of the way to the left edge but four fifths of the way to the
top. Pixel comparison gets that backwards on every wide node.

Precedence is resolved in `resolveEnd` alone and asserted there, so no caller
has to know the order.

**One rule, two callers.** `bindingAt` decides what a pointer means. It used to
be a private method on the tool, which was fine while the tool was the only
thing that asked — the moment endpoints became draggable there were two, and
two implementations of "what is the pointer over" is how a tool comes to
disagree with itself: draw onto a box's left edge and get one binding, drag an
existing arrow to the same pixel and get another.

**Both gestures, not one.** Drawing is click–move–click *and* drag. The line
tool had already made this decision, with its reasons written down, and the
connector was the odd one out — two things that draw a line from one point to
another, disagreeing about how you draw a line from one point to another. The
press decides which gesture it was by whether it moved, judged in **screen**
pixels: whether a hand moved is a question about the hand, and at 10% zoom a
world-unit threshold is most of a screen. A refused *click* leaves the pending
gesture standing rather than silently discarding a connector the user had
already started; a refused drag has nothing to stand and resets.

**Known gap, recorded in `connectorTargets.ts`: rotation is not handled**
anywhere in the connector system. A rotated node's ports sit on its unrotated
bounding box. Fixing it means every consumer working in the node's local frame
and rotating the resolved point back out — worth doing, not small.

## 4a-iv. Lines, profiles and the two bugs that cost the most

### The two bugs worth remembering

**A `useMemo` below an early return emptied the whole canvas.** Two hooks were
added under `if (!visible) return null` in `TextRenderer`. Entering the text
editor flips `visible`, the component returns early, two hooks vanish from the
render, React throws "Rendered fewer hooks than expected", and the *entire*
Konva subtree unmounts — so double-clicking one text object took every object
on the board with it. Invisible to the type checker and to 800-odd tests,
because it is a runtime rule about render order. **The console named it in one
line.** Opening the console first would have saved most of the time it took.

**A `React.memo` comparator that omitted a prop made objects unselectable.**
`ObjectRenderer` compared `objId`, `isSelected` and `stageScale` but not
`selectable`. That prop changes when the active tool does, so an object which
had not re-rendered for some other reason kept `draggable={false}` and a press
handler closed over a stale `false`. The selectivity was the tell: objects that
happened to re-render — moved, edited, or unmounted by culling and remounted —
behaved, and ones sitting untouched did not.

It had been wrong for a long time and was *invisible*, because `selectable`
only gated the hover outline. Widening it to gate the click promoted a cosmetic
bug into a functional one. **When you widen what an existing prop controls,
check the memo.**

### A line is no longer its bounding box

`width`/`height` used to *be* the two endpoints, corner to corner, with the
flip signs choosing the diagonal. Exact for a straight line; wrong the moment
the run has a profile, because the profile deviates *across* that diagonal.
Measured on a live board: a wavy arrow stored **380x0** and drew **380x49**.

Marquee, culling, the radar and export framing all read that box. So the box is
now the extent of what is drawn, markers included, and the endpoints moved into
`geometry`. Half the stroke is added on every side — a stroke is centred on its
path, and the old model gave a horizontal line a height of zero.

**Legacy lines are read, not rewritten.** `localRunEnds` answers both forms.
The normalizer deliberately does *not* invent endpoints: it would have to
invent a box too, since the old one is the diagonal rather than the drawn
extent, and normalization is not allowed to move objects on somebody's board.
A line converts the first time it is edited. `lineEnds.test.ts` covers both
legacy forms including the up-and-left one where the flip *is* the direction —
if that branch goes, every line drawn before this collapses to a point.

### Profiles, and what four failed attempts taught

Five profiles — straight, curved, wavy, zigzag, coil — as a property of the
existing line rather than five new kinds. `straight` returns its two endpoints
untouched, so nothing already drawn moved.

The **coil** took five attempts and the failures are the useful part. A shaped
sine, a phase-warped circle and a prolate cycloid were each derived from a
formula, and none had the right character: **a sine has one value per position,
so it cannot double back, and a curve that never doubles back cannot cross
itself.** Tuning numbers was never going to add a crossing to a construction
with none in it. The cycloid did produce real crossings — but a cycloid's loops
are tied in size to how many there are and run into each other with no baseline
between.

What it is now: one loop template of four cubics, plus a valley cubic between
consecutive crossings, translated by a fixed period. **Uniformity is
structural** — every loop is the same curve at the same size — and the loops
keep their size at any count, with the straight leads absorbing the difference.
The numbers are the reference's own, kept in its coordinates and scaled by one
factor so no proportion can drift.

The general lesson, and it is worth more than the coil: **when a shape is a
mark rather than a function, store the mark.** Four attempts to derive it cost
more than transcribing it once.

### Everything else on lines

- **Arrowhead alignment**, both of Illustrator's modes, in `terminateRun` —
  shared by the canvas, the exporter and the toolbar specimen, because a head
  placed by three separate pieces of arithmetic is three chances to disagree,
  and that had already happened: the exporter oriented heads along the box
  diagonal while the canvas used the true tangent.
- **The sketch branch had its own copy** of the cap placement and had never
  been updated — box corners, flat angle, its own size. Now hoisted so both
  branches render the same markers.
- **A line's label is a tag**, not a text block: fixed size, weight and case on
  a plate, riding the midpoint of the *run*. Interpolated rather than indexed —
  a straight line is two points, so `points[length / 2]` is its *end*, and the
  label sat past the arrowhead.
- **Label ink is lifted against the plate**, not the board. `readableOn`
  assumes a near-white or near-black surface; a plate is a mid-tone, and a
  colour clearing 3:1 on white can be invisible on it.
- **Sketchers are chosen by profile, not by counting points.** Straight and
  zigzag have real corners and keep the polyline sketcher's overshoot; curved,
  wavy and coil are samples and take the drift sampler. A point-count proxy got
  the one case wrong that mattered — a six-repeat zigzag is fourteen points, so
  it was reclassified as a curve and lost the corners that are its whole
  character.

## 4b. What the recent sessions changed

Grouped by area. Everything here is committed; the reasoning is in the code
comments and the commit messages, which are the real record. Two sessions are
folded together here because the second one was mostly design work on what the
first one built.

**A design system, written down.** `DESIGN.md` is new and is the reference:
two layers of tokens (PRIMITIVES are raw values, SEMANTIC are roles), and
components reference roles only. The bug it exists to stop had already happened
five times — a raw palette primitive (`--amber-500`) used where the accent role
belongs, giving white-on-orange at ~2.15:1 in the badge, the share sheet, the
comments overlay and the switch. Two traps documented there and worth
repeating: **a CSS custom property resolves where it is declared**, so aliasing
a theme-dependent value on `:root` freezes the light value in dark mode
(`--focus-ring-color` did exactly this); and **`popIn` animates `transform`**,
which clobbers the `translateX(-50%)` that centres a popover, so four surfaces
appeared half their width to the right and snapped into place. Centre with the
independent `translate` property, which composes instead of losing.

**The rooms page** (`Home.tsx`) was rebuilt from scratch twice — the first
attempt was patched and the user's verdict was that it was still "super
confusing", which was correct. It is a rail plus a stage now, with Your boards
and Vega Studio templates as separate views rather than one merged scroll.

**Templates: 26, in five categories** (`art`, `design`, `diagrams`, `physics`,
`thinking`), up from 13. Built from typed `NewNodeInput` rather than JSON so a
schema rename fails the build instead of producing broken rooms. Includes
deliberate scale showcases at 100/500/1000 objects. Thumbnails come from the
same `build()` that makes the board, drawn through the same `WorkspaceCover`
the board cards use, so a card cannot drift from what it produces —
`build(limit)` exists because generating 1600 nodes to draw four thumbnails
froze the page.

**Physics became a mode rather than a toggle.** `engine/physics/` holds
`simulation.ts` (Matter.js), `forces.ts` and `flightState.ts`. What is worth
knowing before touching it:

- **Matter's `isStatic` is overloaded** as both "pinned" and "asleep" here.
  `SimNode.locked` is the separate, real "the user pinned this" flag, and
  `activate()` refuses to wake a locked body. That is what makes Pachinko pegs
  possible, and it is a control a user has.
- **"Just my selection" is scoping, not imprisonment.** The first attempt
  removed everything else from the world, so a 450-object board became a
  4-object one and objects fell through where their neighbours used to be. It
  uses Matter **collision categories and masks** now: out-of-scope bodies still
  exist and still collide, they just do not receive the force.
- **Freeze had to learn about the latch.** A latched field re-applied itself
  on the next tick, so freezing did nothing that lasted; `calmAll` clears the
  latch first.
- An "inert contact" rule was written, measured to change nothing, and
  **deleted** rather than shipped as dead code. Do the same.

**The canvas chrome.** Rulers and the dot grid are toggles in a View menu that
also carries Snap, Throw and Focus mode. The ruler switch is *structural*: the
stage is inset by `RULER_SIZE` so screen coordinates and ruler marks describe
the same world position, so hiding the rulers has to move the stage, the grid
offset, the panel clearance and both insets, or it strands a dead margin down
two edges. One flag drives all five.

**The dot field was never a grid.** It was declared on `.canvas-area` at a
fixed `0 0` while the camera loop wrote `backgroundPosition` to
`.canvas-container` — a different element with no background image — so it was
screen-fixed wallpaper that objects slid over and snapping did not describe.
Moving it exposed why it had lived on the parent: `.canvas-container` carries
`w-full h-full relative`, **Tailwind classes in a project with no Tailwind**,
so it was zero pixels tall. It asks `tickStep` for its pitch now — the same
function the rulers use — and holds 20–40px across a 160x zoom range.

**Board covers** draw the actual board from a `localStorage` summary: real
positions, sizes, silhouettes and colours, including text as ruled lines,
frames as paper with a hairline, rotation, outline-only shapes, and stars and
polygons generated from a side count and an inner ratio. The vertex maths is
`previewPolygonPoints` in `engine/model/boardPreview.ts`, pure and tested,
because the alternative is arithmetic inside JSX that can only be checked by
looking at a thumbnail — which is how a star drew as a block for two rounds.

**Sharing** rebuilds its link from the room id rather than echoing
`location.href`, which was carrying whatever query or hash was in the address
bar into an invitation meant to outlive the session. It also states plainly
that a link is full access, permanently — there are no roles here and the sheet
should not imply there are.

**Smaller, all user-reported:** the activity feed compared `author.id` against
`provider.awareness.clientID` — two different identifier spaces — so "is this
me?" was never true and it narrated your own actions back at you; an empty
board's preview key was *deleted* rather than written, collapsing "never opened
here" and "opened, and empty" into one absence so every empty board read "Not
opened on this device"; `[hidden]` lost to an author `display` rule and left a
tuning row on screen.

## 5. Next up

### 5a. Verify what was built fast

**This session traded verification for speed, on the user's instruction, and
the bill came due six times** — see the preamble. Nothing below is known
broken; all of it is unwatched.

- **The right-click menu targeting an object.** Only the empty-board variant
  has been seen. The object variant needs Konva's hit graph, which an
  automation tab does not populate.
- **The Mermaid apply path.** Parse, layout and build carry 26 tests; the
  `Room` wiring — transaction, replace-in-place, selection — has never run.
- **Sketched caps, midpoint labels, the context menu, dock spacing** were
  confirmed by reading the scene graph rather than by looking. The label
  contrast fix *was* seen working (white ink on a white plate lifted to
  `#828282`).
- **Two real browsers with two real mice** — still the check automation cannot
  stand in for.

### 5a-ii. The walkthrough project (still what the user originally asked for)

Agreed scope, in order. Two of five are done:

1. ~~**Demo rooms**~~ — done. **26 templates in 5 categories**, including
   deliberate scale showcases at 100/500/1000 objects.
2. **Per-tool guided walkthroughs.** *Not started, and this is the next
   substantial piece of the brief.* The agreed design: an arrow anchored to a
   real object that **advances by doing the thing**, not by a Next button. A
   wizard becomes the thing people dismiss, and it would contradict what makes
   the templates work — you learn connectors by dragging a box. The templates
   now give these somewhere to happen; launch a walkthrough *against* a
   matching template rather than an empty canvas. The user chose "scripted
   real mutations" over a recorded video when asked.
3. ~~**Visual refinement** of existing surfaces~~ — largely done; see §4b.
4. **New surfaces** — the canvas empty state and the rooms page are done. A
   **first-run onboarding** and a **marketing-grade first run** are not.
5. **A product page.** Not started.

**Session creation is the loose thread.** The share *sheet* was rebuilt, but
the flow that gets you a named board and shares it the first time was not
touched. The user asked for "session creation and sharing, end to end" and only
the second half landed. Start there if you want a short, well-defined piece.

Also outstanding and explicitly deferred by the user: **Supabase** for auth and
storage. They chose it over own-auth/PocketBase/Clerk. It is a multi-file change
across the server, a new schema with RLS, and moving voice notes out of the CRDT
into object storage — worth its own session. Note that voice notes are still
base64 inside the Yjs document; the bitrate fix cut that ~5x but did not solve
it.

> This whole section was blank for two commits. A rewrite of §5a retitled it
> and left the `5a-ii` heading standing with nothing under it, so the single
> most important "what to do next" in the file read as an empty line. Restored
> from `5cebd12`. It is the same failure as the panel-navigation entry below,
> and the same lesson: **this file is a record with no test holding it.**

### 5b. Watch Phases 3–5 (still partly unverified)

Concretely:

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

### 5c. The sticky bug that was never reproduced

Reported repeatedly: placing a sticky shows the "added a sticky note" toast but
**nothing appears on the canvas or in the layers panel**. Never once reproduced
on this machine across five attempts.

Two real defects were found and fixed while hunting it, either of which could
have been it:

- `CanvasEngine` optimistically added a new node to the visible set, and the
  next spatial query built a fresh set and assigned it over the top — dropping
  the node again unless the index had caught it within one frame. `Canvas` only
  rescues that when culling loses >50% of the board, so it was invisible on a
  tiny board and fatal on a real one. Now held in `pendingIds` until the query
  itself reports the id.
- An empty sticky is discarded when its editor closes. The note is created on
  **pointerdown**, and a real click takes ~100ms — long enough for the editor to
  mount and autofocus, so **pointerup** blurred it and destroyed the note. This
  is timing-dependent, which is why synthetic events (which fire down and up in
  one tick) never reproduced it.

If it recurs, the next thing to check is `useStore.getState().isReplaying` —
stuck `true`, the store ignores *all* live document traffic, which produces
exactly this signature and has nothing to do with stickies.

### 5d. The two panels — a build phase

The user's brief for this is long and specific; the short version is that both
panels exist, both are functional, and both are thin against what the brief
asks for. What follows is an audit, not a wish list.

**`components/LayersPanel.tsx` (971 lines) already does:** a virtualized
uniform-row tree (frames and group clusters, indented), inline rename, drag
reorder, per-row visibility and lock toggles, Shift-range and Cmd-toggle
multi-select, per-frame collapse held outside the CRDT, tag filtering, type
icons, and "so-and-so is editing this" badges from awareness. The
virtualization is load-bearing: a DOM row per object measured at 27ms per
document change with 500 objects, which was ~88% of the cost of moving one.

**What the brief asks for that is missing:**

- ~~Search and filter by name and by node type.~~ **Done** (`f615fa8`).
  Subsequence matching with a two-pass ranker in
  `engine/model/layerSearch.ts`, marked hits in the row, type chips for the
  types the document actually contains, and a flat ranked list while filtering
  rather than a filtered tree. Enter selects every match.
- ~~**Keyboard navigation of the panel itself.**~~ **Done** (`16b7858`).
  `handleTreeKeyDown`: ↑/↓ move the cursor (Shift extends), ←/→ fold and unfold
  a frame, Enter renames, Space toggles visibility, Cmd+↑/↓ restacks, Cmd+A
  selects every visible row, Delete removes the selection, Escape clears it.
  The container is `role="tree"`, `tabIndex={0}`, with `aria-activedescendant`
  pointing at the cursor row — the tree previously could be clicked but never
  driven, because focus skipped from the search box straight to the first row's
  eye toggle. **This entry stayed listed as missing for two commits after it
  shipped**, including one that edited this file; see the note under
  §"Suggested order" below.
- **Frame wrapping** — turn a selection into a frame.
- **Reparenting by drag**, not just reordering.
- Section, Component, Instance and Mask node types. These are **blocked**:
  sections and masks are their own features, components are Phase 7.

**`components/PropertiesPanel.tsx` (2614 lines) already does:** Transform
(X/Y/W/H with aspect lock, rotation, flip), Appearance (fill with all five
paint types, opacity, corner radius, blend), Stroke (colour, weight, dash
preset, alignment, join, miter limit), Shadow, Inner Shadow, Blur (layer and
backdrop, together with the shadows — they are all effects), Typography
(family, size, weight, italic, underline, strikethrough, case, alignment, line
height, tracking, box resizing), plus per-type blocks for Star, Polygon, line
Ends, frame Safe Area, image Adjust, Sticky, Physics and Metadata — **and
multi-selection with a real mixed-value state throughout**, which is the
largest item this section used to list as missing.

**What the brief asks for that is missing:**

- ~~**It shows nothing for a multi-selection.**~~ **Done.** `Room.tsx` threads
  `selectedIds` through, capabilities are the *intersection* across the
  selection rather than the union, and a field where two objects disagree
  reads *Mixed* and writes to all of them when edited. `sharedPaint` /
  `shared` are the helpers; there are ~49 mixed-state call sites.
- **It shows nothing when nothing is selected.** The brief wants global canvas
  state there: background colour, measurement units, ruler/grid visibility
  toggles, and the document's styles.
- **Independent corner radii and corner smoothing.** One uniform radius today;
  the brief wants four corners and a squircle parameter.
- Constraints/pinning grid and Auto Layout are **Phase 6**; component link,
  variants and exposed properties are **Phase 7**. Do not start those here.

**Suggested order from here**: global canvas state when nothing is selected →
independent corner radii → frame wrapping and drag-reparenting.

> This list used to lead with panel keyboard navigation, which had already
> shipped in `16b7858` — **the same commit that edited this file**. A whole
> session could have been spent rebuilding it. The failure is the one invariant
> 7 describes, in prose rather than in code: two records of the same fact, and
> the one that is easy to forget is the one written in English. When you finish
> something listed here, strike it in the commit that finishes it, not later.

**Blend and Blur are both hidden for connectors now.** Neither was a decision
anyone made: both arrived as a side effect of connectors being added to
`APPEARANCE_TYPES`, and neither survives contact with what a connector is. A
connector's job is to stay legible across whatever it crosses — multiply
darkens it into the shapes it runs over, screen washes it out — and layer blur
turns a 2px stroke into a smear, destroying the one property the object exists
to have, while backdrop blur is invisible under a stroke that thin. Both gate
on `hasConnector` in `PropertiesPanel.tsx`. **The general lesson: when you give
a type a capability it never had, walk every control that capability unlocks.**

### 5e. Still logged, from earlier phases

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
- **Bundle splitting.** 1.55MB in one chunk (gzip 488KB). Trust the table at
  the top of this file; this line sat at a stale 1.33MB for several sessions.
- **Two real browsers with two real mice** — still the one check automation
  cannot stand in for.

### 5f. Not started from the brief

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

Physics, templates and the product shell (newest):

| File | What it owns |
| --- | --- |
| `engine/physics/simulation.ts` | the Matter world: bodies, scoping by collision category, `locked` vs asleep, gesture bookkeeping |
| `engine/physics/forces.ts` | the force catalogue, latch durations, falloff curves, the wording shown in the panel |
| `engine/physics/flightState.ts` | what is mid-throw, kept out of the document |
| `hooks/usePhysics.ts` | the React side: arming a force, latching, `calmAll` |
| `engine/templates/templates.ts` | 26 templates as typed `NewNodeInput`, with `build(limit)` for thumbnails |
| `engine/model/boardPreview.ts` | the board summary in `localStorage`, `PREVIEW_VERSION`, `previewPolygonPoints`. Pure, tested. |
| `components/WorkspaceCover.tsx` | that summary drawn as SVG — the only thumbnail renderer, shared by boards and templates |
| `engine/objects/appearanceTypes.ts` | which types carry an `appearance` block, held against the registry by a test |
| `engine/model/connector.ts` | routing: ports, auto-side choice, orthogonal and curved routes, bounds. Pure, tested. |
| `engine/model/connectorAnchor.ts` | an exact attachment point in a node's own proportions. Pure, tested. |
| `engine/model/connectorBinding.ts` | what a pointer means, as an end. The one rule the tool and the editor share. Pure, tested. |
| `engine/model/connectorTargets.ts` | the only bridge from nodes to boxes — what is connectable, and where its box is |
| `engine/model/linePath.ts` | the five line profiles as point lists, including the stamped coil. Pure, tested. |
| `engine/model/lineEnds.ts` | endpoints ↔ node, both the current form and the legacy box. Pure, tested. |
| `engine/model/connectorEnds.ts` | end caps, the trim, and `terminateRun` — the one place a marker is placed |
| `components/canvas/ConnectorEditor.tsx` | the two ends as handles you can drag onto anything |
| `engine/export/svgDocument.ts` | assembling the SVG file: definitions, backdrop, artwork. Takes the paint collector and drains it, so the gradient `<defs>` cannot go unwritten again. Pure, tested. |
| `engine/export/pdfWriter.ts` | the PDF file format: a frame is a page, the xref offsets, the page-size limit. Pure, tested. |
| `engine/export/rasterLimits.ts` | the browser canvas caps, edge **and** area, and the scale that fits them. Pure, tested. |
| `engine/export/filenames.ts` | what an exported file is called, in any writing system. Pure, tested. |
| `engine/export/inlineImages.ts` | pulling media into an exported SVG so the file survives being sent to someone. Pure, tested. |
| `engine/tools/shortcuts.ts` | the single-key tool bindings, and the inverse map `Room` resolves through |
| `engine/tools/toolNames.ts` | what each tool is *called* on the help screen, tested against the bindings |
| `engine/tools/nudge.ts` | what an arrow keypress means, in world units. Pure, tested. |
| `components/HelpModal.tsx` | the shortcut reference. Its tool rows are derived; the rest is hand-written and has drifted before — see §4a-ii. |
| `Home.tsx` | the rooms page: rail, stage, boards and templates as separate views |
| `DESIGN.md` | the token layers and the named rules. Read before touching `index.css`. |
