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

## 2. Node schema (v2)

Two rules govern the whole model:

1. **`width`/`height` on the base node are the only source of bounds.** Nothing
   else stores a size.
2. **`geometry` describes form; `appearance` describes paint.** No field appears
   in both.

### Base fields — present on every node

```
BaseNode {
  id: string
  type: "text" | "shape" | "sticky" | "image" | "audio" | "path" | "comment" | "frame"

  x, y: number                  // top-left in world space
  width, height: number         // unrotated, unscaled — the only bounds source
  rotation: number              // degrees, about the node's centre
  scaleX, scaleY: number        // sign carries flip
  opacity: number

  zIndex: number                // assigned centrally; new nodes land on top
  parentId?: string             // synthetic id shared by group members
  locked: boolean
  hidden: boolean               // there is no `visible` field
  title?: string                // user-supplied name, shown in the Layers panel

  createdBy: string             // awareness clientID as a string
  createdByName?: string        // denormalized so authorship outlives the session
  createdByColor?: string
  createdAt: number             // epoch ms
  updatedAt: number             // stamped on every write
}
```

### Shared value types

```
Paint      { type: "solid", color: string, opacity?: number }
Stroke     { color: string, width: number, dash?: number[] }
Shadow     { color: string, blur: number, offsetX: number, offsetY: number }
Appearance { fill?: Paint[], stroke?: Stroke, shadow?: Shadow, cornerRadius?: number }

Typography {
  fontFamily: string
  fontSize: number
  fontWeight: number            // orthogonal to slant — see note below
  italic: boolean
  underline: boolean
  align: "left" | "center" | "right"
  verticalAlign: "top" | "middle" | "bottom"
  lineHeight: number
  letterSpacing: number
  color: string
}

Author { id: string, name: string, color: string }
```

`fontWeight`, `italic` and `underline` are deliberately separate fields. Konva
encodes weight and slant into a single `fontStyle` string; conflating them in the
model is what previously left the Bold control inert. That translation happens in
exactly one place: `components/canvas/renderers/shared.ts`.

### Per-type fields

| type | additional fields |
| --- | --- |
| `text` | `text: string`, `typography: Typography`, `autoHeight: boolean` |
| `shape` | `geometry: { kind, points?, innerRatio? }`, `appearance`, optional `text` + `typography` label |
| `sticky` | `text`, `theme` (closed set of 8), `fontSize`, `author`, `reactions: Record<emoji, count>`, `tags: string[]`, `pinned: boolean` |
| `path` | `geometry: FreehandGeometry \| BezierGeometry`, `appearance` |
| `image` | `src: string`, `appearance`, `naturalWidth?`, `naturalHeight?`, `crop?`, `filters?` |
| `audio` | `src: string`, `durationMs`, `waveform: number[]`, `author`, `transcript?` |
| `comment` | `text`, `author`, `resolved: boolean` |
| `frame` | `appearance`, `layout?` |

`ShapeKind` is `rect | ellipse | triangle | hexagon | star`.

```
FreehandGeometry { kind: "freehand", svgPath: string, points: Point[], strokeSize: number }
BezierGeometry   { kind: "bezier", segments: BezierSegment[], closed: boolean }
```

Both store coordinates **relative to the node origin**, so paths resize and
hit-test like every other node.

### Legacy documents

`engine/document/normalize.ts` maps any pre-v2 node onto this schema on read, so
old rooms render correctly without migration having run. `migrateDoc.ts` then
rewrites the stored document once — idempotently, in a single transaction,
guarded by `metadata.schemaVersion`. Both are covered by tests, including
convergence when two peers migrate the same document concurrently.

## 3. Awareness state (ephemeral, never persisted)

```
Awareness {
  user:       { name: string, color: string }
  viewport?:  { x, y, zoom, width, height }
  cursor?:    { x, y } | null
  selection?: string[]                                  // ids, for remote outlines
  activity?:  string                                    // e.g. "✏️ Typing"
  throws?:    Record<id, { x, y, rotation? } | null>    // in-flight physics poses
  physicsOwned?: string[]                               // single-writer ownership
  gesture?:   { id, emoji, x, y, timestamp }
}
```

Cursor updates are throttled to ~15Hz and smoothed by local interpolation.
Because none of this touches the document, ephemeral state never enters history
or snapshots.

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
