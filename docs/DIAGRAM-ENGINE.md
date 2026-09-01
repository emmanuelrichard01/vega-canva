# The diagram engine

How `flowchart TD ...` becomes objects on the board, what was wrong with it,
and what I would do next. This replaces an earlier plan whose recommendation
had already shipped — see §6.

---

## 1. The pipeline

```text
source text
  → mermaid.ts   parse         → MermaidGraph { nodes, edges, subgraphs }
  → layout.ts    place (dagre) → PlacedNode[] PlacedEdge[] clusters
  → build.ts     realise       → ShapeNode[] ConnectorNode[] FrameNode[]
```

`build.ts` also runs backwards: `diagramToMermaid` reads tagged nodes off the
board and emits source again.

**That round-trip is the feature, and it is the thing to protect.** This is not
an importer that pastes a picture. It produces real, editable canvas objects,
tagged with `diagramId` and carrying their `diagramKey`, and it can read them
back. Everything below is judged against whether it keeps that true.

---

## 2. The decision worth writing down: anchors, not waypoints

`dagre.layout()` computes a polyline per edge — a genuine route, bent around
whatever is in the way. The obvious move is to store it. Do not.

`connector.ts` opens by stating the invariant the whole canvas relies on:

> a connector stores **which objects it joins**, not where its ends happen to
> be […] the arrow never knew a coordinate to begin with

A stored polyline is stale the moment anybody drags a box, and a connector
remembering a path through a diagram that has changed is worse than one that
re-derives a plain path. It would also have to be reconciled on every move,
resize, undo and remote edit — the exact "two sources of truth" the grid node
was rebuilt to escape.

So what is kept is not the route but its **intent**: the point on each node
where dagre chose to leave and arrive, stored as an `Anchor` — `{u, v}`
normalised to the node's own box. That survives the node being moved *and*
resized, and `anchorPoint` projects it back to the perimeter on every read.
No coordinate is stored and the invariant holds.

The practical difference is fan-out:

| | leaving a decision node |
| --- | --- |
| `port: 'auto'` | all three edges resolve to the same bottom midpoint, and cross immediately |
| anchors | `u = 0.09`, `0.50`, `0.91` — the offsets dagre separated them to |

`auto` remains the fallback for an edge dagre did not route: one pointing at a
cluster, or one dropped by the non-compound retry.

---

## 3. What was wrong, and is now fixed

All three were found by probing the real pipeline, not by reading it.

### 3.1 Dagre's routing was computed and thrown away

`LayoutResult` carried only `nodes` and `clusters`; `build.ts` attached every
connector with `port: 'auto'`. The layering was dagre's and the arrows were
not — which is most of the way to a tangle, and precisely the problem dagre
had been introduced to solve. Fixed per §2.

### 3.2 Boxes did not account for the wrapping they caused

`estimateSize` was `longest * 8.4 + 36` wide and `lines * 22 + 34` tall, where
`lines` counted explicit newlines only. Those two rules contradict each other:
the width is capped at 320, so a longer label **wraps** — and the height was
computed as though it had not.

```text
before   76 chars → 320x56   (needs ~3 lines; text ran outside the shape)
after    76 chars → 320x93
```

The fix is not a better constant. The project already owns the wrapper the
renderer uses, so `measureSize` asks it: lay the text out at the width it will
really be drawn at and take the height it reports. Same greedy break, same
tracking, same measured glyphs — the box agrees with the text by construction
rather than by a factor that is close for Inter at 14px and wrong for Caveat.

This is the sticky-note bug in another costume: a fallback measurement standing
in for a real one. `measure.ts` drops its probe on `fontsChanged`, so a diagram
measured before its webfont arrived is measured again after.

### 3.3 Edge labels were given no room

`A -->|yes| B` parses, and the connector draws the word — but layout called
`g.setEdge(from, to)` with no label box, so dagre laid the graph out as though
the edges were bare and the label landed on whatever the tighter layout put
underneath. Dagre takes `{ width, height, labelpos }`; it does now.

An estimate is right *here* and wrong in §3.2: this reserves a gap rather than
sizing something drawn, so a few pixels out moves an arrow and never clips a
word.

### 3.4 Two smaller ones, fixed alongside

- **Origin ignored clusters.** A cluster box is drawn with padding around its
  children and a strip above them for the title, so it always starts above and
  left of its topmost node. Normalising on nodes alone placed any diagram
  containing a subgraph outside the spot it was dropped on, by that padding.
- **`extractLayout(g: any)`** in a strict codebase — now a declared structural
  type.

### 3.5 Still open, deliberately

`resolveLeafKey` redirects an edge touching a subgraph to `nodeKeys[0]` or
`nodeKeys[len-1]` — *declaration* order. It is an unavoidable guess: dagre's
ranker cannot take a cluster as an endpoint, and the edge must be in the graph
before layout runs, so there is no position to choose by yet. Fixing it
properly means a second layout pass. Not worth it until somebody complains.

---

## 4. Why not run real mermaid

The earlier plan's Option B — run `mermaid` headlessly, translate its output —
is how Excalidraw's `mermaid-to-excalidraw` works. I would not do it here.

Bundle size is the obvious objection (**84 MB unpacked**) and the weakest one;
the modal is already lazy. The real objection is that it fights §1. Mermaid
emits SVG. Translating SVG back into editable `ShapeNode`s and `ConnectorNode`s
is lossy and brittle against an AST that is not a public API — and it puts the
round-trip at risk to buy fidelity to *mermaid's* rendering, which is not what
this canvas wants anyway. Themes and sketch mode exist precisely because the
output should look like this board, not like mermaid.

Excalidraw can accept that trade because mermaid is an import convenience for
them. Here it is a first-class authoring path with a reader on the other end.
The plan's "stop reinventing graph layout" was right and was taken. "Stop
parsing" is a different claim and it does not follow.

---

## 5. What I would do next, in order

1. **A test that the preview cannot lie.** `MermaidModal` renders an SVG
   preview beside the canvas renderer. Geometry is shared; *drawing* is not,
   so they will drift — and a preview that disagrees with the result is worse
   than no preview. Assert both agree on shape kind and box for a fixed source.
2. **`sequenceDiagram`.** The most-asked-for type by a distance, and a
   genuinely different layout — lifelines and ordered messages, not a DAG, so
   dagre does not apply. Tractable because the parser is well-structured with
   37 tests behind it. One real diagram type beats claiming fourteen.
3. **Re-layout in place.** Editing the source of an existing diagram rebuilds
   it; it should diff by `diagramKey` and move what moved, so hand-tweaked
   positions and anything attached survive an edit.
4. **Elbow smoothing.** Dagre's polyline has the bend points; we keep only the
   ends. A rounded corner at each bend is the remaining visual gap against
   Excalidraw, and it belongs in the connector renderer — derived, not stored.

### On the UI

It is better than the old plan credited: live preview on shared geometry, five
themes, crisp/sketch, direction switch, line-level diagnostics, templates,
pan/zoom. Refinements I would make, in value order:

- **Error recovery over error reporting.** `errorLine` is good. Better is
  rendering the largest valid prefix of a broken document, so the preview keeps
  showing something while you type rather than blanking on every half-finished
  line.
- **Preview and result must look identical.** See item 1 — this is correctness
  wearing a UI hat.
- **Show the layout cost.** Node and edge counts, and a warning past a few
  hundred, so pasting something enormous is not a surprise freeze.
- **Keep the source.** Store it on the diagram so reopening the modal edits the
  original text rather than round-tripping through `diagramToMermaid`, which
  necessarily loses comments and formatting.

---

## 6. Note on the plan this replaces

The earlier document recommended "Option A: replace `layout.ts` with dagre",
and that had **already shipped** by the time it was being weighed up. Its
"Proposed Changes" described work that existed.

Worth recording as a process note rather than a criticism: the plan was
executed structurally and not to its stated goal. It promised dagre would make
"edges route cleanly around them", and the routing was computed and discarded,
so that promise was unmet while the plan looked done — the hardest kind of gap
to notice, because the box is ticked.

Which is the argument for §5 item 1, and for the tests added beside these
fixes: state the outcome, then assert it.
