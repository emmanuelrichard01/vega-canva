# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teams doing collaborative visual work in a shared room: several people on one
unbounded 2D board at the same time, drawing, writing stickies, leaving voice
notes, and commenting on each other's work.

The situation the product is designed around: collaborators are **not looking at
the same part of the board**. An infinite canvas means two people who have panned
apart have no inherent way of knowing the other is there. Much of the interface
exists to answer "where is everyone, and what are they doing" without either
person leaving their own view.

Identity is a display name plus a presence colour, chosen at sign-in and stored
locally. There are no accounts and no roles, so the interface cannot assume an
owner, an admin, or a permission tier.

## Product Purpose

Let several people build one shared visual artefact in real time, and keep that
artefact editable when the network is not there. Success is that concurrent
editing converges without anyone losing work, and that a collaborator's presence
is legible without costing more attention than the work itself.

## Origin and Ambition

Built for a Vega-IT company hackathon. The brief was a real-time collaborative
infinite canvas with "strong focus on creative tools and interactions that go
beyond a standard Figma or digital whiteboard": rooms invited by shareable link,
a massive 2D surface with smooth zoom/pan performing well at 100+ objects, text /
shapes / images / sticky notes / audio recordings, guest-mode-plus-username auth,
and responsive design, in two days. Physics, minimap + radar, and offline support
were the scored "creative technical" tier; PNG/SVG/JSON export and Time Travel
were bonuses. That brief explains why each feature exists, and every one of them
shipped.

**The hackathon brief is history, not the current bar.** The owner has since
decided, independently, to take the project to what a company like Figma, Notion,
Canva, Adobe Illustrator or Apple would actually engineer, design and publish.
That standard governs everything now: tools, UI, layout, UX, flows, onboarding,
auth and login/logout, workspace creation and deletion, the layers and properties
panels, the main floating toolbar, and the per-object floating quick-action
toolbars, down to the smallest detail and to premium interaction behaviour.

Two consequences for design work. First, "it works and it matches the old
screen" is not a passing result on any surface named above; those are open for
deliberate, meticulous redesign rather than preservation. Second, the surfaces
outside the canvas itself (auth, dashboard, onboarding, empty states, room
lifecycle) are held to the same bar as the canvas, not treated as scaffolding.

## Positioning

CRDT-based (Yjs), with **no authoritative ordering server**. Clients converge
without one, which is what makes offline editing work: edits made while
disconnected merge on reconnect rather than being rejected.

Two capabilities follow from that architecture and are not incidental features:

- **Client-side physics.** Objects have materials (Feather, Paper, Rubber, Wood,
  Stone) and collide. Force is a mode, not an ambient setting; there is
  deliberately no world gravity, because an infinite canvas has no floor.
- **True vector export.** SVG export serializes CRDT state to real vector
  primitives rather than rasterizing the stage.

## Operating Context

- Rooms are reached by URL (`/room/:id`). Sharing the link is the entire
  invitation mechanism.
- Sessions are long and mixed-mode: reading, thinking, and panel work interleave
  with direct manipulation. The interface must stay legible during the parts
  where nobody is pointing at anything.
- Multiple collaborators are commonly off-screen from one another.
- Infrastructure (Postgres, Redis, MinIO, sync server) runs in Docker Compose;
  the frontend is Vite on :5173.

## Capabilities and Constraints

Confirmed capabilities: infinite canvas with text, shapes, freehand and bezier
paths, images, sticky notes (with tags and reactions), voice notes with a
scrubbable waveform; comment threads with replies, mentions, resolve, per-person
unread state and an inbox; presence (cursors with tool badges, selection name
tags, off-screen edge markers, radar/minimap with viewport rectangles); physics
with per-object materials; Time Travel over a session timeline; PNG, SVG and JSON
export; offline editing via IndexedDB.

Durable constraints future work must preserve:

- **`engine/document/mutations.ts` is the only write path**, and all reads are
  normalized at the boundary. Nothing downstream sees a legacy field.
- **`width`/`height` on the base node are the only source of bounds**;
  `geometry` is form, `appearance` is paint, and nothing lives in both.
- **One writer, one reader for presence.** `PresenceManager` is the only writer
  of local awareness; `collaboratorStore` is the only reader, running one frame
  loop that every presence surface subscribes to. Adding a second writer or a
  second frame loop has already caused ghost cursors and per-frame broadcast
  storms.
- **Positions are written straight to the DOM inside the frame loop**, never
  through React state. Re-rendering a component tree at broadcast rate to move a
  22px arrow costs more than the document it decorates.
- **Ephemeral state rides awareness, never the document**, so it never enters
  history.
- Roughly 500 objects is the working performance target (~5.7ms to commit one
  object move; ~0.004ms for a 500-object spatial query).

Known limits that are facts, not gaps to paper over: anyone with a room link can
edit that room; there are no permissions; groups are flat with no nesting; PNG
export omits audio players; the update log is trimmed to 2000 entries per room;
the dashboard lists workspaces from local storage and does not verify they still
exist on the server.

## Brand Commitments

None binding. "Vega-Canva" is the working name; the project originated in a
Vega-IT hackathon and has since been substantially rebuilt, but no Vega-IT brand
assets, palette, or voice constrain it.

The current visual system in `apps/frontend/src/index.css` is an **incumbent
working default, explicitly open to replacement** (confirmed 2026-07-31). It is
two token layers and only two: primitives (raw values, no meaning) and semantic
roles (what the UI references); components reference semantic tokens only. It
carries a type scale, space scale, radius scale, elevation ramp, one global
`:focus-visible` ring, and `prefers-reduced-motion` handling. Theme follows the
OS preference until the user chooses, then persists.

Treat that system as incumbent authority for refinement work, and as evidence
rather than obligation for a deliberate redesign. It is not a brand commitment.

## Evidence on Hand

- `design inspirations/` at the repo root: five untracked reference images of
  canvas tools (dot grids, floating segmented docks, hairline borders, tight
  radii on chrome, one dark board showing remote presence chips).
- `README.md` documents the architecture and, more usefully, the reasoning
  behind the presence, cursor, sticky, comment and physics decisions, including
  the failures each current design replaced.
- `docs/` holds architecture notes, data model, PRD and build plan.
- `HANDOFF.md` records open questions.

Absences future work must not fabricate: there are no users, no usage data, no
testimonials, no customers, no benchmarks beyond the two measured performance
numbers above, and no pricing or deployment story. There is no server-side
account system, and the app does not pretend otherwise.

## Product Principles

1. **One channel per question, and no surface exists twice.** Where is someone,
   what are they holding, what are they doing that I cannot see, which object is
   theirs, is anyone busy off-screen: each has exactly one answer surface.
2. **Do not label what the screen already says.** Drawing and moving are fully
   visible; annotating them writes on screen what the screen has already said.
   Only invisible activity (typing, recording) earns a word.
3. **Presence must cost less attention than the work it decorates.** A name fades
   after stillness; six people in a room must not mean six permanent name tags
   over the work.
4. **A view is not a property of the board.** Filters, read state, and camera
   position are ways of looking. They must not empty anyone else's screen or
   outlive the session.
5. **Legibility over content, not over background.** Anything that sits on top of
   user content (cursors, chips, markers) is coloured for contrast against
   arbitrary content, not against a theme token.
6. **Hold the named-company bar, or say you did not.** The comparison set is
   Figma, Notion, Canva, Illustrator, Apple. A surface that merely functions has
   not met it. This applies as much to logging in and deleting a workspace as to
   the canvas.

## Accessibility & Inclusion

**WCAG AA is the committed floor** (confirmed 2026-07-31), and regressions are
bugs, not deferred polish. Currently held: all six text roles meet AA contrast in
both themes; there is one global `:focus-visible` ring;
`prefers-reduced-motion` is handled; remote-cursor name chips derive their
colours to reach AA rather than using the raw presence colour; the audio waveform
is a real `role="slider"` with arrow, Home/End and Space support.

The drawn cursor hands the surface back to native cursors on a coarse pointer and
under `forced-colors`, where a drawn cursor cannot honour the pointer size and
contrast the OS was asked for.
