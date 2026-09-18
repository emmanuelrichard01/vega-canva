# The diagram engine

How `flowchart TD ...` becomes objects on the board, what was wrong with it,
and what is left. This replaces an earlier plan whose recommendation had
already shipped — see §6.

Last updated 2026-09-01. The engine carries 79 tests across
`mermaid.test.ts`, `layout.test.ts`, `build.test.ts`, `silhouette.test.ts` and
`templates.test.ts`.

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

### 3.5 A node placed outside the frame it was then clipped to

Membership in a subgraph was recorded **twice** and the two could disagree.
`remember()` pushed to `subgraph.nodeKeys` unconditionally, but the node's own
`subgraphId` only survived on the branches that *replaced* the stored node — so
a node mentioned before the block it belongs to:

```text
B -->|yes| C[Process]
subgraph S1 [Pipeline]
  C --> E
end
```

ended up in `S1.nodeKeys` with no `subgraphId`. Both records are read, by
different code, and that is what turned a bookkeeping slip into something
visibly broken: `layout.ts` parents to dagre by `subgraphId`, so C was laid out
**outside** the cluster; `build.ts` assigned `frameId` from `nodeKeys`, so C
was given the frame anyway; and `ObjectRenderer` clips a framed node to its
frame's rectangle. C was placed outside a box and then cut to fit it.

The stamp now applies to whichever record `remember` keeps, and `build.ts`
reads `subgraphId` — so the field that decides *where a node is placed* is the
field that decides *what clips it*.

### 3.6 Still open, deliberately

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

## 5. What was done next, and what is left

Items 1 and 4 below were the roadmap when this document was written; both are
done. What replaced them at the top of the list is item 3.

### 5.1 The preview cannot lie — done

`MermaidModal` renders SVG and the board renders canvas. They shared geometry
and sizes but **not** the silhouette: the preview carried its own
`switch (shape)` ending in `case 'rect': default:`, and three of the fourteen
shapes had no case. `trapezoid`, `trapezoid_inv` and `flag` fell through, so
for the same source, side by side, the board drew a polygon and the preview
drew a rectangle.

`silhouetteFor` closed that, and has since been taken further: it no longer
*derives* an outline from `SHAPE_SPECS`, it builds the node `build.ts` would
build and asks `shapeToPath` — the same function the canvas renderer and the
SVG exporter use. Interior detail comes from `shapeFeatureContours`, the
canvas's own answer, asked for the same node.

There is no second description of a shape anywhere now, so the preview can only
be wrong in the way the board is wrong. That is the only version of this
guarantee worth having; the first version still had the preview drawing
"ornament" the board did not, which is a smaller gap of the same kind.

### 5.1b The shapes themselves were the larger fault — done

Fixing the *preview* left the deeper problem untouched for a while:
`SHAPE_SPECS` mapped every mermaid shape onto `rect`, `ellipse` or `polygon`,
because those were the only kinds the old preview could draw. A four-point
regular polygon is a **diamond**, so `parallelogram`, `parallelogram_inv`,
`trapezoid` and `trapezoid_inv` — mermaid's two I/O symbols and two
manual-operation symbols — all rendered as the decision symbol. The hexagon was
pointy-topped rather than the flat-topped preparation symbol, and a
subroutine's bars and a database's rims existed *only* in the preview.

The canvas had correct geometry for all of them the whole time. They map onto
it now: `predefined_process`, `cylinder`, `preparation`, `capsule`, `diamond`,
`trapezoid`, `parallelogram`. A trapezoid's taper is signed, as a
parallelogram's slant already was, so `[/A\]` and `[\A/]` stop being one
picture.

`silhouette.test.ts` asserts the property that was missing rather than the
mapping: no two mermaid shapes may produce the same drawing, outline *and*
interior. The single admitted pair is `circle`/`double_circle`, because mermaid
draws a ring inside the second and no canvas kind does.

### 5.1c Mermaid 11's named shapes — done

The bracket forms are the whole of mermaid's old vocabulary and they ran out:
there is no bracket spelling for a document, a delay, a manual input or an
internal-storage box, which is why mermaid 11 added
`A@{ shape: doc, label: "…" }`. This canvas drew all of those correctly and
nothing could ask for them.

Six more shapes, reachable by 61 names — mermaid gives most shapes a semantic
name, a shape name and a textbook name, and accepting only one would reject
valid source. `@{` is parsed **before** the brackets, because `{` is itself a
bracket opener and a node read bracket-first takes `A@{ shape: cyl }` as a
diamond labelled "shape: cyl".

Two names mermaid supports are deliberately refused even though the canvas
draws them well: `cross-circ` and `com-link`. A flowchart node exists to carry
words, and those are annotation symbols — the circle's X runs through its own
label and the bolt sits behind it.

### 5.2 Elbow smoothing — done

`roundCorners` inserts sampled points rather than switching to SVG arcs,
because in this codebase the point list **is** the geometry: `connectorBounds`,
hit-testing, the radar and the board thumbnail all read it. A corner rounded
only in the renderer would be a shape the rest of the system could not see —
clicks would miss it and its bounding box would be wrong.

The radius is clamped to just under half the shorter adjacent segment. Two
corners on one short segment would otherwise each eat more than half of it,
cross, and turn the elbow inside out, which is the failure mode of every naive
corner-rounder.

### 5.3 Sequence diagrams — done, and pie charts with them

The most-asked-for type by a distance, and a genuinely different layout —
lifelines and ordered messages, not a DAG, so dagre does not apply. `sequence.ts`
carries its own parser and its own table-style layout for exactly that reason,
`buildSequence.ts` puts it on the board, and `sequenceEmit.ts` reads it back.
Pie charts followed, on the same split: `pie.ts` lays out wedges as paths
because a wedge is not a shape kind.

`MermaidModal` dispatches on the source rather than on a mode the reader has to
set — `looksLikeSequence` and `looksLikePie` before the flowchart parser —
because mermaid already says which it is on its first line, and asking twice is
a way for the two answers to disagree.

One real diagram type beat claiming fourteen, and three real ones beat one.
`classDiagram`, `stateDiagram`, `erDiagram`, `gantt`, `journey` and `mindmap`
are still refused **by name**, which is the honest answer: the error says which
three work rather than failing with a parse complaint about syntax the parser
was never going to understand.

### 5.4 Re-layout in place — still open

Editing the source of an existing diagram rebuilds it. It should diff by
`diagramKey` and move what moved, so hand-tweaked positions and anything
attached survive an edit.

### 5.5 The templates — done, and they are the documentation

There is nowhere else in the product that says what any of this syntax does,
so the templates are it. All six used to be the same diagram: boxes, arrows,
subgraphs. Between them they demonstrated none of `classDef`, dotted or thick
edges, `&` fan-out, or ten of the shapes.

There are fourteen now, spanning all three engines, and each teaches something
the others do not and opens with a `%%` note saying what. The **Shape
Reference** shows every shape labelled with the syntax that makes it, including
a `Named shapes` group for the six that only mermaid 11's `@{ shape: … }` form
can ask for. `templates.test.ts` holds the set: every one parses, none strands
a node with no way in or out, and between them they cover **every** shape, every
line kind and at least one `classDef`. A template that does not parse is a worse
first impression than no template, in the feature's own words — and the
every-shape assertion is what stops a shape being added to the table and never
shown to anybody.

### On the UI

It is better than the old plan credited: live preview on shared geometry, five
themes, crisp/sketch, direction switch, line-level diagnostics, templates,
pan/zoom. Refinements I would make, in value order:

- ~~**Error recovery over error reporting.**~~ Done. `parseMermaidLenient`
  drops the offending line and retries, so a typo on line nine costs line nine
  and not the other twenty. Failing lines are *blanked rather than removed*,
  because `errorLine` is what the gutter marks and renumbering underneath it
  would point the marker at the wrong row. The strict error is still reported
  and the status bar names the lines it left out — recovery has to be visible
  to be trusted.
- ~~**Preview and result must look identical.**~~ Done; see §5.1.
- ~~**Show the layout cost.**~~ Partly done: the header carries the node, edge
  and group counts. A warning past a few hundred is still worth adding.
- **The parse runs on a 140ms settle**, not on every keystroke. Deliberately
  not React's `useDeferredValue`, which yields to *rendering* priority — the
  cost here is synchronous work inside a `useMemo` that the scheduler cannot
  see.
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
