# Data Model — Real-Time Collaborative Infinite Canvas

Companion to `ARCHITECTURE.md`. Describes the CRDT document schema, awareness
schema, and persistence tables **as implemented**.

> This file previously specified a pre-implementation design in which every node
> carried a type-specific `content` blob. The code diverged from it, and that
> divergence became the single largest source of defects in the project: sizes
> ended up stored in as many as three places (`width`, `geometry.width`,
> `content.width`) and read with different precedence in each of six modules.
> Schema v2 removed the `content` carrier entirely. `engine/model/schema.ts` is
> the authority; this document describes it.

## 1. Yjs document structure (one doc per room)

| Root type | Contents |
| --- | --- |
| `objects: Y.Map<id, Y.Map>` | One `Y.Map` per canvas node |
| `metadata: Y.Map<string>` | Room name, `schemaVersion` |
| `comments: Y.Map<id, Y.Map>` | Comment threads, separate from canvas objects |
| `history: Y.Array` | Recent authoring events, capped (see §5) |

Each object is its own `Y.Map`, so concurrent edits to different objects — or to
different fields of the same object — merge without conflict.

## 2. Node schema (v3)

Two rules govern the whole model:

1. **`width`/`height` on the base node are the only source of bounds.** Nothing
   else stores a size.
2. **`geometry` describes form; `appearance` describes paint.** No field appears
   in both.

Rule 1 has a consequence worth stating, because it reaches all the way into the
renderer: **resizing changes `width`/`height`, never `scaleX`/`scaleY`.** Scale
is for flips and nothing else. Konva's `Transformer` only knows how to write
scale, so it is pointed at an invisible proxy rectangle and the gesture's result
is converted to a size before it is committed — see §"Rendering" in the README.
A node that stored its size as a scale would have scaled padding, scaled stroke
widths and resampled type, and `width`/`height` would no longer be the answer to
"how big is this".

`SCHEMA_VERSION` is **3**. Version 2 removed the `content` carrier described in
the note above; version 3 removed `TextNode.autoHeight` in favour of `resize`.

### Base fields — present on every node

```
BaseNode {
  id: string
  type: "text" | "shape" | "sticky" | "image" | "audio" | "path"
      | "comment" | "frame" | "connector"

  x, y: number                  // top-left in world space
  width, height: number         // unrotated, unscaled — the only bounds source
  rotation: number              // degrees, about the node's centre
  scaleX, scaleY: number        // sign carries flip
  opacity: number

  zIndex: number                // assigned centrally; new nodes land on top
  parentId?: string             // synthetic id shared by group members
  frameId?: string              // the frame this node sits in, by real node id
  locked: boolean
  hidden: boolean               // there is no `visible` field
  material?: string             // 'feather'|'paper'|'rubber'|'wood'|'stone'
  title?: string                // user-supplied name, shown in the Layers panel

  createdBy: string             // awareness clientID as a string
  createdByName?: string        // denormalized so authorship outlives the session
  createdByColor?: string
  createdAt: number             // epoch ms
  updatedAt: number             // stamped on every write
}
```

`parentId` and `frameId` are deliberately **not** the same field. `parentId` is
synthetic — shared by the members of a group, belonging to no node — and
everything sharing one is selected together. `frameId` names a real frame node,
and clicking one object inside a frame must not select the rest. An object can
therefore be in a group *and* in a frame, which are independent facts about it.

`NODE_TYPES` is exported as a value, not only a type, because the read boundary
has to decide at runtime whether a `type` string off the wire is one it knows.
A hand-kept second copy is what once caused every `connector` to be silently
rewritten into a `shape`.

### Shared value types

```
PaintType    "solid" | "linear" | "radial" | "conic" | "diamond"
GradientStop { offset: number, color: string, opacity?: number }
Paint        SolidPaint { type: "solid", color, opacity? }
           | GradientPaint { type: GradientKind, stops: GradientStop[], … }

Stroke     { color: string, width: number, dash?: number[], cap?: LineCap,
             join?: LineJoin, miterLimit?: number, align?: StrokeAlign }

Shadow     { color: string, blur: number, offsetX: number, offsetY: number,
             spread?: number, opacity?: number }

Appearance { fill?: Paint[], stroke?: Stroke, shadow?: Shadow,
             cornerRadius?: number, blendMode?: BlendMode, blur?: number,
             innerShadow?: Shadow, backdropBlur?: number }

Typography {
  fontFamily: string
  fontSize: number
  fontWeight: number            // orthogonal to slant — see note below
  italic: boolean
  underline: boolean
  strikethrough: boolean        // separate from underline, not one enum
  align: "left" | "center" | "right"
  verticalAlign: "top" | "middle" | "bottom"
  lineHeight: number
  letterSpacing: number
  color: string
  textCase?: "none" | "upper" | "lower" | "title"
}

Author { id: string, name: string, color: string }
```

`fontWeight`, `italic` and `underline` are deliberately separate fields. Konva
encodes weight and slant into a single `fontStyle` string; conflating them in the
model is what previously left the Bold control inert. That translation happens in
exactly one place: `components/canvas/renderers/shared.ts`.

`strikethrough` is its own flag rather than sharing a `decoration` enum with
`underline`, because Canvas2D, CSS and SVG all draw a run with both at once and
a single-valued field would have made them exclusive for no reason.

`textCase` is a **presentation** transform, never applied to the stored string —
a control that rewrote the text would make switching to upper case and back
return `HELLO` rather than `Hello`.

`BlendMode` holds all sixteen Canvas2D `globalCompositeOperation` names, stored
verbatim so the renderer forwards the string with no lookup table between the
two to fall out of step. `blur` diffuses the object; `backdropBlur` diffuses
what is behind it; `shadow` and `innerShadow` are separate fields because an
object can want both.

### Per-type fields

| type | additional fields |
| --- | --- |
| `text` | `text: string`, `typography: Typography`, `resize: TextResize`, `appearance?` |
| `shape` | `geometry: { kind, points?, innerRatio?, arrowStart?, arrowEnd? }`, `appearance`, optional `text` + `typography` label |
| `sticky` | `text`, `theme` (closed set of 8), `fontSize`, `author`, `reactions: Record<emoji, authorId[]>`, `tags: string[]`, `pinned: boolean` |
| `path` | `geometry: FreehandGeometry \| BezierGeometry \| CompoundGeometry`, `appearance` |
| `image` | `src: string`, `naturalWidth?`, `naturalHeight?`, `appearance`, `crop?`, `filters?` |
| `audio` | `src: string`, `durationMs`, `waveform: number[]`, `author`, `transcript?` |
| `comment` | `text`, `author`, `resolved: boolean` |
| `frame` | `appearance`, `safeArea?`, `layout?` |
| `connector` | `from: ConnectorEnd`, `to: ConnectorEnd`, `routing: Routing`, `appearance?`, `endStart?`, `endEnd?`, `label?` |

`ShapeKind` is `rect | ellipse | polygon | star | line | arrow`. `polygon`
replaced the separate `triangle` and `hexagon` kinds, which were two hard-coded
side counts; both survive as *dock presets* that create a polygon with `points`
set, which is what makes the count editable afterwards instead of frozen into
the shape's identity. `points` is clamped 3..60, and is one field for both a
star's point count and a polygon's side count — the same quantity, one control.

`line` and `arrow` are the only two with **no interior**: they run corner to
corner of the node's box, which keeps `width`/`height` the single source of
bounds rather than storing two endpoints as a second record of size.

`TextResize` is `width | height | fixed` — which of the box's dimensions follow
the text. It replaced `autoHeight`, which could express only two of those three
states and was **read by nothing**; the version 3 migration deletes the key.

```
FreehandGeometry { kind: "freehand", svgPath: string, points: Point[], strokeSize: number }
BezierGeometry   { kind: "bezier", segments: BezierSegment[], closed: boolean }
CompoundGeometry { kind: "compound", subpaths: BezierGeometry[] }
```

All three store coordinates **relative to the node origin**, so paths resize and
hit-test like every other node.

`CompoundGeometry` is several closed contours filled as one, with the even-odd
rule. It is what a boolean operation produces and the only thing that can hold
the result: subtracting a disc from the middle of a square gives a square with a
hole, and no single run of anchors describes a hole.

Two things write it: the boolean operations (`engine/document/vectorOps.ts`,
via the Martinez clipper) and converting text to path, where a counter is a
contour inside a contour. Both bake the node's rotation and scale into the
coordinates they produce, since the result is a new node with an identity
transform — which is why `mapPath` transforms control points as well as anchors:
a cubic is affine-invariant, so moving the anchors and leaving the handles would
bend the curve between them.

`connector` is the one type whose geometry is **derived rather than stored**.
`from` and `to` hold node ids and a side; the points are recomputed on every
read from wherever those objects currently are, which is what makes a flowchart
survive being rearranged — the arrow never knew a coordinate to forget. Its
`width`/`height` are still the only source of bounds and are kept in step by the
renderer, because culling, the radar and marquee selection all read them.

`reactions` maps an emoji to the **author ids** who reacted with it, not to a
count. A count cannot express who reacted, cannot be taken back, and loses
reactions outright: two people reacting at the same moment each read the same
number and each wrote number + 1. See §"Sticky reactions" in the README for how
that is stored in the CRDT.

### Legacy documents

`engine/document/normalize.ts` maps any earlier node onto this schema on read, so
old rooms render correctly without migration having run. `migrateDoc.ts` then
rewrites the stored document once — idempotently, in a single transaction,
guarded by `metadata.schemaVersion`. Both are covered by tests, including
convergence when two peers migrate the same document concurrently.

## 3. Awareness state (ephemeral, never persisted)

```
Awareness {
  user:       { id, name: string, color: string }
  viewport?:  { x, y, width, height, zoom }             // x/y world, w/h screen px
  cursor?:    { x, y } | null
  selection?: string[]                                  // ids, for remote outlines
  tool?:      string                                    // drives the cursor's tool badge
  activity?:  ActivityKind | null                       // closed set — see below
  status?:    'online' | 'away'
  throws?:    Record<id, { x, y, rotation? } | null>    // in-flight physics poses
  physicsOwned?: string[]                               // single-writer ownership
  gesture?:   { id, emoji, x, y, timestamp }
}
```

`ActivityKind` is a **closed set** — `typing | recording | drawing | moving` —
and only the first two are shown as a word beside a name. Drawing and moving
are already fully visible on the canvas; labelling them writes on screen what
the screen has already said. They still travel, because they hold the name chip
up while someone works and they drive the radar's ping.

This replaced a free-text `activity` written in two places as `'✏️ Typing'` and
`'🎤 Recording'` — an icon, a word and a state fused into one value that went on
the wire and was rendered verbatim, so it could not be styled, translated or
tested.

`ViewportState` stores the **top-left corner** in world coordinates plus the
viewport in screen pixels. The minimap wants the corner because it draws a
rectangle; everything that navigates *to* a person wants the middle instead, via
`viewportCenter()`.

Cursor updates are throttled to ~15Hz and smoothed by local interpolation.
`PresenceManager` is the only writer of local awareness and
`collaboratorStore` the only reader of everyone else's. Because none of this
touches the document, ephemeral state never enters history or snapshots.

## 4. Room routing

Room id is a URL-safe nanoid generated client-side, used as the Yjs doc name and
the Hocuspocus document identifier. `/room/:roomId` is the shareable link. There
is no server-side creation step — the first client to connect with a given id
implicitly creates the room.

## 5. Persistence (Postgres)

### `rooms`

| column | type | notes |
| --- | --- | --- |
| `id` | text (pk) | matches roomId |
| `created_at` | timestamptz | |
| `last_active_at` | timestamptz | updated on each persisted snapshot |

### `room_snapshots`

Canonical recovery source — one row per room, upserted on a debounce. Not a
growing log.

| column | type | notes |
| --- | --- | --- |
| `room_id` | text (pk, fk → rooms.id) | |
| `state` | bytea | `Y.encodeStateAsUpdate` output |
| `updated_at` | timestamptz | |

### `room_updates`

Incremental Yjs updates, appended per transaction, replayed in order by Time
Travel. **Retention: the most recent 2000 rows per room**, enforced by a periodic
sweep in `apps/server/src/db.ts`. Indexed on `(room_id, id)` — replay is always
room-scoped and ordered.

| column | type | notes |
| --- | --- | --- |
| `id` | serial (pk) | monotonic |
| `room_id` | text (fk → rooms.id, cascade) | |
| `update_data` | bytea | one Yjs update |
| `created_at` | timestamptz | |

### `media_refs`

| column | type | notes |
| --- | --- | --- |
| `id` | text (pk) | |
| `room_id` | text (fk → rooms.id, cascade) | |
| `url` | text | public object-storage URL |
| `mime_type` | text | |
| `size_bytes` | bigint | |

Media bytes live in MinIO (S3-compatible), never inline in the CRDT.

The in-document `history` array is distinct from `room_updates`: it holds recent
authoring events for the activity feed, is capped at 200 entries, and is
replicated to every client. Time Travel replays `room_updates`, not this.

## Related docs

- `../README.md` — architecture overview and how to run it
- `PRD.md` — product scope
- `ARCHITECTURE.md` — system design and scaling reasoning
