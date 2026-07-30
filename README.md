# Vega-Canva

A real-time collaborative infinite canvas. Multiple people draw, write, and talk
on one unbounded 2D surface, with CRDT sync, offline editing, client-side
physics, and true vector export.

Originally built for a Vega-IT hackathon; since substantially rebuilt.

---

## Running locally

Infrastructure (Postgres, Redis, MinIO, and the sync server) is containerised:

```bash
docker compose up -d --build     # sync server on :3000
npm install                      # once, at the repo root (npm workspaces)
npm run dev -w apps/frontend     # Vite on :5173
```

Open `http://localhost:5173`. You land on a dashboard; creating a workspace
navigates to `/room/:id`. Copy that URL into another window to collaborate.

```bash
npm test -w apps/frontend        # Vitest
npm run build -w apps/frontend   # tsc -b && vite build
npm run lint -w apps/frontend    # oxlint
```

Endpoints are derived from the host that served the page (see
`utils/endpoints.ts`), so opening a room link from another machine on the LAN
works without configuration. Override with `VITE_SERVER_HOST` / `VITE_WS_URL`
when the frontend and sync server are on different hosts.

---

## Architecture

```mermaid
flowchart TB
  subgraph Client["Browser (one per collaborator)"]
    direction TB
    Doc["engine/document<br/>Y.Doc · provider · mutations"]
    Store["hooks/useStore<br/>zustand + normalize"]
    Scene["SceneGraph → SpatialIndex<br/>(rbush)"]
    Engine["CanvasEngine<br/>rAF loop · culling"]
    Renderers["Konva renderers<br/>one per node type"]
    Cache["IndexedDB<br/>(y-indexeddb)"]

    Doc --> Store --> Scene --> Engine --> Renderers
    Doc <--> Cache
  end

  Client -- "WebSocket (Yjs updates + awareness)" --> Server

  subgraph Server["apps/server — Express + Hocuspocus"]
    Rooms["Document registry"]
    Persist["Snapshot + update log"]
  end

  Server --> Postgres[("PostgreSQL<br/>snapshots · update log · media refs")]
  Server --> MinIO[("MinIO (S3)<br/>images · audio")]
  Server -. "multi-instance fan-out (opt-in)" .-> Redis[("Redis")]
```

Sync uses CRDTs (Yjs), so there is no authoritative ordering server — clients
converge without one, which is also what makes offline editing work: edits made
while disconnected merge on reconnect rather than being rejected.

### The document layer — `engine/document/`

The single owner of collaborative state. Everything else subscribes to it; it
depends on nothing above it.

| Module | Responsibility |
| --- | --- |
| `doc.ts` | `Y.Doc`, Hocuspocus provider, IndexedDB persistence, the shared maps, connection status |
| `mutations.ts` | The **only** write path. Stamps z-index, timestamps and authorship so no caller can forget them |
| `observe.ts` | The **only** observer of the objects map. Publishes a `{changed, removed}` id set |
| `normalize.ts` | Maps any persisted node — current or legacy — onto the canonical schema |
| `migrateDoc.ts` | Idempotent, transactional rewrite of a stored document to the current schema |

Two invariants worth knowing before changing anything here:

- **All writes go through `mutations.ts`.** New nodes always land on top of the
  stacking order and always carry `createdAt`/`updatedAt`/`createdBy`, because
  those are stamped centrally rather than by each tool.
- **All reads are normalized at the boundary.** `useStore` normalizes each
  changed node once, so nothing downstream ever sees a legacy field.

### The document model — `engine/model/schema.ts`

One canonical shape per node type, governed by two rules:

1. **`width`/`height` on the base node are the only source of bounds.** Nothing
   else stores a size.
2. **`geometry` is form; `appearance` is paint.** Nothing lives in both.

```ts
BaseNode   x, y, width, height, rotation, scaleX, scaleY, opacity,
           zIndex, parentId?, locked, hidden, title?,
           createdBy, createdByName?, createdByColor?, createdAt, updatedAt

TextNode   text, typography, autoHeight
ShapeNode  geometry{kind}, appearance{fill,stroke,shadow,cornerRadius}, text?, typography?
StickyNode text, theme, fontSize, author, reactions, tags, pinned
PathNode   geometry{kind:'freehand'|'bezier', …}, appearance
ImageNode  src, appearance, crop?, filters?
AudioNode  src, durationMs, waveform, author, transcript?
```

`typography` keeps `fontWeight` and `italic`/`underline` as separate orthogonal
fields. Konva wants them combined into a single `fontStyle` string; that
translation happens in exactly one place
(`components/canvas/renderers/shared.ts`).

Documents written by older clients still render correctly — `normalize.ts`
handles them on read — and converge to the canonical shape via a one-time
migration guarded by `schemaVersion` in the document metadata.

### Rendering — `components/canvas/`

`ObjectRenderer` owns what is shared across every node type: transform,
selection, dragging, editing lifecycle, presence. Drawing dispatches to a typed
per-type renderer. Objects rotate and scale about their centre, so the group sits
at the centre with its contents offset back — which means `e.target.x()` during a
drag reports the centre, exactly what the physics body expects.

- **One shared `<Transformer>`** (`SelectionTransformer`), re-pointed at the
  current selection rather than one mounted per object.
- **One shared `NodeEditor`** serves text, shape labels, stickies and comments.
  It positions itself in screen space from the camera rather than through Konva's
  transform tree, which is what keeps the caret glued to the object through pan
  and zoom.

### Performance

Built around the assumption that the document is large and the viewport is small.

- **Spatial culling.** `SceneGraph` maintains bounds (rotation included);
  `SpatialIndex` is an R-tree; `CanvasEngine` queries it once per frame with a
  300px overscan and publishes a visible-id set. A 500-object query measures
  ~0.004ms.
- **Per-object subscriptions.** Each renderer subscribes to its own node, so
  moving one object re-renders one object.
- **Virtualized Layers panel** (`useVirtualRows`) — a DOM row per object is by
  far the most expensive consumer of document changes at scale.
- **Camera applied outside React.** The rAF loop writes stage position and scale
  imperatively; panning and zooming do not re-render the tree.
- **Awareness-driven physics.** In-flight objects are broadcast over awareness and
  read through one shared subscription, never per-object polling.

Measured on a 500-object scene: **~5.7ms** to commit a single object move.

### Physics — `engine/physics/simulation.ts`

The simulation is a plain module: node data in, transforms out. It imports
Matter and the material profiles and **nothing else** — no React, no Konva, no
Yjs, no awareness — so it runs in Node with no canvas and is covered by tests.
`hooks/usePhysics.ts` is only the adapter: it decides when to step, writes
in-flight poses straight to Konva, commits settled ones to the CRDT in a single
transaction, and arbitrates ownership.

**Single-writer ownership**: every client runs its own world, so exactly one
client owns an object while it is in motion. The owner simulates and commits the
final position; everyone else renders the owner's broadcast flight path. Without
that, two clients settle the same object at slightly different resting positions
and fight over the write.

Objects collide, and being hit promotes a resting object to a moving one — a
static body in Matter has infinite mass, so without that it behaves as a wall.

**Force is a mode, not an ambient setting.** Picking a force tool (Pull, Push,
Drop, Wind, Shockwave) turns force on by itself and shows a field ring at the
radius the simulation will actually use. Entering the mode snapshots the layout,
so "Restore layout" can undo the whole session in one action. The header switch
governs only whether a flick throws.

There is deliberately **no world gravity**: an infinite canvas has no floor, so a
constant field would pull content off the board forever and nothing would ever
settle. "Drop" is a force you aim and hold. `engine/physics/forces.ts` records
the full reasoning.

Every object has a **material** — Feather, Paper, Rubber, Wood or Stone — chosen
in the Properties panel, deciding how far it carries and how hard it bounces.

### Export — `engine/export/`

A registry of exporters behind one service. All three formats frame the
**document bounds**, computed by a shared helper, so they agree with each other
regardless of where the camera happens to be.

- **PNG** — reframes the Konva stage onto the content box, captures, restores.
  Clamped to a maximum canvas edge. Audio players are DOM overlays and are
  therefore absent.
- **SVG** — serializes CRDT state to real vector primitives, escaping user text.
  Audio becomes a labelled placeholder; comment pins are excluded, as in Figma
  and Illustrator.
- **JSON** — canonical node data plus comment threads.

### Collaboration surfaces

Cursors, selection outlines, the viewport radar, per-object "editing" badges and
emoji gestures all ride on Yjs awareness rather than the document, so ephemeral
state never enters history.

`PresenceManager` is the **only** writer of local awareness state. It owns one
throttle (15Hz) and the idle timer, and everything ephemeral goes through it —
having two writers for the `cursor` field is what left ghost pointers parked on
the canvas after someone moved to a side panel.

**Cursor and viewport answer different questions.** The cursor is where a
pointer is right now, and it is cleared the moment that pointer leaves the
canvas. The viewport is where someone is *working*, and it persists while they
read, think, or use a panel — so it, not the cursor, is what keeps a
collaborator on the radar and in "Jump to…".

`ViewportState` stores the **top-left corner** of what someone can see, in world
coordinates, plus the viewport in screen pixels. The minimap wants that corner
because it draws a rectangle; everything that navigates *to* a person wants the
middle instead, via `viewportCenter()`.

Authorship is denormalized onto each node at creation, so a node still shows who
made it after that person disconnects.

### Cursors — `engine/cursor/`

Two different problems, deliberately solved two different ways.

**Your own pointer is drawn by the app**, over the canvas only. Tools resolve
to a *cursor mode* (`cursorModeForTool`, pure and tested), and `LocalCursor`
renders the matching art from `cursorArt.tsx`: a solid pointer with a small
tool badge in its tail, or a crosshair where the job is to hit a point rather
than indicate a direction. Tools swap instantly — no tweening, no press
response.

Two things make this work where the version it replaces did not:

- **The transform is written inside the pointer event, never in a frame.** The
  old implementation stored a coordinate and applied it in `requestAnimationFrame`,
  so it was a frame behind by construction. It also subscribes to
  `pointerrawupdate` where that exists, which is not coalesced, so a
  high-polling mouse lands on positions `pointermove` never reports.
- **The art has fixed colours, not theme tokens.** A cursor sits over
  *content*, not over the background: a `--surface-primary` fill is invisible
  against a dark canvas and against any dark object in a light one. White fill,
  near-black outline, offset shadow — legible over everything.

Panels and chrome keep the real OS pointer. `index.css` also keeps a full set
of native `[data-cursor-mode]` cursors underneath, and `LocalCursor` hands the
surface back to them on a coarse pointer or under `forced-colors`, where a
drawn cursor cannot honour the pointer size and contrast the OS was asked for.
The attribute that suppresses the native cursor is set by `LocalCursor` itself,
so the canvas is never left with `cursor: none` and nothing drawn on top.

**Other people's pointers** are rendered by `RemoteCursors`: React mounts and
unmounts them and decides whether each is visible, while a frame loop does
position and interpolation only. Splitting it that way is deliberate — when the
frame loop also owned visibility, a throttled tab showed an empty room.

**Other people's pointers are content**, so they keep custom rendering.
`RemoteCursors` mounts and unmounts through React and moves through `rAF`,
writing transforms straight to the DOM rather than re-rendering at broadcast
rate. Three things there are arithmetic, and therefore live in
`remoteCursor.ts` under test:

- **Interpolation is frame-rate independent.** The old fixed per-frame lerp
  made a 144Hz display converge nearly 2.5× faster than a 60Hz one on identical
  network updates.
- **Name chips derive their colours.** A chip painted in the raw presence
  colour with white text failed WCAG AA on half the palette — Amber `#F59E0B`
  at about 2:1 — and sign-in lets people pick an arbitrary colour, so a lookup
  table would not have covered it. `chipColorsFor` moves the fill the *shorter*
  way to readability, so deep colours stay saturated with white text and bright
  ones stay bright with hue-tinted dark text. The arrow always keeps the raw
  colour and the chip is outlined in it.
- **Chips flip at the viewport edge** instead of being clipped by the overlay.

### Design system — `index.css`

Two token layers, and only two: **primitives** (raw values, no meaning) and
**semantic roles** (what the UI references). Components reference semantic tokens
only. Includes a type scale, space scale, radius scale, elevation ramp, one global
`:focus-visible` ring, and `prefers-reduced-motion` handling.

All six text roles meet WCAG AA contrast in both themes. The theme follows the OS
preference until the user chooses, then persists.

---

## Repository layout

```text
apps/
  frontend/
    src/
      engine/
        document/    CRDT ownership, mutations, normalization, migration
        model/       the canonical schema
        objects/     per-type capability registry (drives the inspector)
        tools/       tool implementations behind one interface
        export/      exporter registry
        presence/    awareness-backed collaboration state
        physics/     the simulation, force specs, shared in-flight state
        history/     session timeline for Time Travel
        interaction/ grid snapping
        cursor/      tool cursor modes, remote cursor rendering
      components/
        canvas/      renderers, node editor, shared transformer
        workspace/   header, tool dock, presence avatars
        ui/          primitives (Switch, NumberStepper, colour picker, …)
      hooks/         store, sync binding, breakpoints, focus trap, virtualization
      utils/         minimap engine, layout, offline media queue, path simplifier
  server/
    src/             Express + Hocuspocus, S3 uploads, snapshots, retention
docs/                architecture notes, data model, PRD, build plan
```

## Tech stack

**Frontend** — React 19, Vite, react-konva, Yjs, Matter.js, zustand, rbush,
perfect-freehand, framer-motion, Vitest
**Backend** — Node, Express, Hocuspocus, `ws`
**Infrastructure** — PostgreSQL, MinIO, Redis (opt-in), Docker Compose

## Notes and known limits

- **Authentication is a display identity, not an account.** A name plus a
  deterministic presence colour, stored locally. There is no server-side account
  system, and the app does not pretend otherwise.
- **Anyone with a room link can edit that room.** There are no permissions.
- **Redis is opt-in** (`REDIS_HOST`) and only needed to fan out across multiple
  sync-server instances.
- **The update log is trimmed** to the most recent 2000 entries per room. Room
  snapshots are the canonical recovery state; the log exists for Time Travel
  scrubbing.
- **Groups are flat.** Members share a synthetic `parentId`; there is no
  enter-group editing and no nesting.
- **PNG export omits audio players**, as noted above.
- **Tests cover pure logic, CRDT behaviour and the physics simulation** (schema
  normalization, migration convergence, geometry, session timeline, camera zoom,
  cursor modes and remote-cursor colour/placement/smoothing, and the simulation
  itself). There are still no component or interaction tests — the adapter layer
  between the simulation and Konva is the notable gap.
- **The dashboard lists workspaces from local storage** and does not verify they
  still exist on the server, so a deleted room can linger as a card.
- **Remote collaborator cursors are not confirmed working end to end.** Several
  bugs in that path were fixed and each link verified in isolation, but it has
  not been watched with two live browsers. See the box at the top of
  `HANDOFF.md`.
