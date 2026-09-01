import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureFontLoaded } from '../engine/text/measure';
import { DEFAULT_TYPOGRAPHY } from '../engine/model/schema';
import { silhouetteFor, clampRadius } from '../engine/diagram/silhouette';
import {
  X,
  Check,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowLeft,
  Wand2,
  PenTool,
} from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useDebouncedValue } from '../hooks/useDeferredValue';
import {
  parseMermaidLenient,
  formatMermaid,
  DIAGRAM_THEMES,
  type DiagramThemeId,
  type FlowDirection,
  type MermaidNode,
} from '../engine/diagram/mermaid';
import { layoutGraph } from '../engine/diagram/layout';
import { diagramNodeSizes } from '../engine/diagram/build';

const TEMPLATES = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    source: `%% The basics: a shape per role, and a branch that says why.
flowchart TD
    Start([Request received]) --> Check{Payload valid?}
    Check -->|yes| Work[Process it]
    Check -->|no| Reject[/Log the reason/]
    Work --> Store[(Write to database)]
    Store --> Ok([200 OK])
    Reject --> Bad([400 Bad Request])`,
  },
  {
    id: 'shapes',
    name: 'Shape Reference',
    source: `%% Every shape, labelled with the syntax that makes it.
%% Keep this one open beside your own diagram as a cheat sheet.
flowchart LR
    subgraph Blocks ["Blocks"]
        A[Rectangle] --> B(Rounded)
        B --> C([Stadium])
        C --> D[[Subroutine]]
    end

    subgraph Decisions ["Decisions and data"]
        E{Diamond} --> F{{Hexagon}}
        F --> G[(Database)]
        G --> H((Circle))
    end

    subgraph Skewed ["Skewed and terminal"]
        I[/Parallelogram/] --> J[\\Reversed\\]
        J --> K[/Trapezoid\\]
        K --> L[\\Inverted/]
        L --> M>Flag]
        M --> N(((Double circle)))
    end

    D --> E
    H --> I`,
  },
  {
    id: 'architecture',
    name: 'Cloud Architecture',
    source: `%% Nested subgraphs, and classDef to colour a tier at a time.
flowchart TD
    subgraph Edge ["Edge"]
        Web([Browser]):::client
        Mobile([iOS / Android]):::client
    end

    subgraph Cloud ["Private network"]
        LB{{Load balancer}}

        subgraph Services ["Services"]
            Gateway[API gateway]:::svc
            Auth[Auth]:::svc
            Orders[Orders]:::svc
        end

        Cache[(Redis)]:::data
        Main[(Postgres)]:::data
    end

    Web --> LB
    Mobile --> LB
    LB --> Gateway
    Gateway --> Auth
    Gateway --> Orders
    Auth --> Cache
    Orders --> Main

    classDef client fill:#EEF2FF,stroke:#6366F1
    classDef svc fill:#ECFDF5,stroke:#059669
    classDef data fill:#FEF3C7,stroke:#D97706`,
  },
  {
    id: 'oauth',
    name: 'OAuth2 Auth Flow',
    source: `%% Solid is a request, dotted is what comes back.
%% Reading direction alone tells you which half of the round trip you are in.
flowchart TD
    User([User]) -->|1 Sign in| App[Your app]
    App -->|2 Redirect| Provider{{Identity provider}}
    Provider -.->|3 Authorization code| App
    App -->|4 Exchange code + secret| Token[/Token endpoint/]
    Token -.->|5 Access token| App
    App -->|6 Bearer request| Api[API]
    Api -.->|7 Protected resource| App`,
  },
  {
    id: 'gitflow',
    name: 'Git Branching Strategy',
    source: `%% "&" fans one arrow out to several nodes, and the loop is the point:
%% a failing check sends the work back rather than forward.
flowchart LR
    Main([main]) --> Feat1[feature/canvas]
    Main --> Feat2[feature/export]

    Feat1 & Feat2 --> Review{Review + CI}
    Review -->|passes| Staging[(staging)]
    Review -.->|fails| Fix[Fix and push]
    Fix --> Review

    Staging --> Tag[/Tag a version/]
    Tag ==> Main`,
  },
  {
    id: 'cicd',
    name: 'CI/CD Pipeline',
    source: `%% Thick arrows are the path a green build takes; dotted is the way out.
flowchart LR
    Push([Push]) ==> Install[Install]

    subgraph Checks ["Runs in parallel"]
        Lint[Typecheck + lint]
        Test[Unit tests]
        Build[Build]
    end

    Install ==> Lint
    Install ==> Test
    Install ==> Build

    Lint & Test & Build ==> Gate{All green?}
    Gate ==>|yes| Deploy[[Deploy]]
    Gate -.->|no| Report[/Report the failure/]
    Deploy ==> Live([Live])`,
  },
  {
    id: 'state',
    name: 'State Machine',
    source: `%% Self-loops for the states that retry, a double circle for the end.
flowchart LR
    Start(((Idle))) --> Queued([Queued])
    Queued --> Running{{Running}}
    Running -->|retry| Running
    Running -->|ok| Done(((Done)))
    Running -->|error| Failed[/Failed/]
    Failed -->|requeue| Queued
    Failed -->|give up| Dead((Dead letter))`,
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** The source to open with — a board read back as code, or nothing. */
  initialSource?: string;
  /** Insert or replace on the board. Returns nothing; the modal closes. */
  onApply: (
    source: string,
    options?: { theme?: DiagramThemeId; renderStyle?: 'crisp' | 'sketch' }
  ) => void;
  /** Whether applying will replace an existing diagram rather than add one. */
  replacing?: boolean;
}

/**
 * Senior-level Diagram from Code (Mermaid) Modal.
 * High-fidelity preview with theme presets, crisp/sketch modes, direction quick-switch, line-level diagnostics.
 */
/**
 * The four flow directions, in the order they read as a compass rather than as
 * an alphabet: down, right, up, left.
 */
const DIRECTIONS: ReadonlyArray<{ id: FlowDirection; Icon: typeof ArrowDown; label: string }> = [
  { id: 'TD', Icon: ArrowDown, label: 'Top to bottom' },
  { id: 'LR', Icon: ArrowRight, label: 'Left to right' },
  { id: 'BT', Icon: ArrowUp, label: 'Bottom to top' },
  { id: 'RL', Icon: ArrowLeft, label: 'Right to left' },
];

export const MermaidModal: React.FC<Props> = ({
  open,
  onClose,
  initialSource,
  onApply,
  replacing,
}) => {
  const [source, setSource] = useState(initialSource || TEMPLATES[0].source);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<DiagramThemeId>('indigo');
  const [renderStyle, setRenderStyle] = useState<'crisp' | 'sketch'>('crisp');

  const textRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useFocusTrap(open, onClose);

  // Zoom & Pan State
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (open) {
      setSource(initialSource || TEMPLATES[0].source);
      setActiveTemplate(initialSource ? null : 'flowchart');
      setScale(1);
      setPan({ x: 0, y: 0 });
    }
  }, [open, initialSource]);


  /**
   * Lenient for the picture, strict for the message.
   *
   * The preview spends most of its life looking at a half-typed document, and
   * blanking it on every incomplete line is a flicker in exactly the moment
   * the reader is trying to see the effect of what they just typed. This keeps
   * drawing the lines that do parse and still reports the ones that do not --
   * error recovery, not error suppression.
   */
  /**
   * The parse runs on pauses, not on keystrokes.
   *
   * Parsing plus a dagre layout is milliseconds on a small graph and tens of
   * them on a large one, and it was running synchronously on every character.
   * The typing itself is what suffers: the textarea cannot paint the next
   * character until the layout finishes, so the editor gets heavier exactly as
   * the diagram gets more worth previewing.
   */
  const settledSource = useDebouncedValue(source, 140);
  const { graph, error, errorLine, skippedLines } = useMemo(
    () => parseMermaidLenient(settledSource),
    [settledSource]
  );
  /** True while the preview is a keystroke or two behind the editor. */
  const previewPending = settledSource !== source;
  const activeTheme = DIAGRAM_THEMES[themeId] || DIAGRAM_THEMES.indigo;
  // `TB` is mermaid's synonym for `TD`; one button owns both.
  const currentDirection = graph?.direction === 'TB' ? 'TD' : graph?.direction;

  // Change flowchart direction in source
  const handleSetDirection = (dir: FlowDirection) => {
    setSource((prev) => {
      const trimmed = prev.trimStart();
      const match = /^(flowchart|graph)\s+([A-Za-z]{2})/i.exec(trimmed);
      if (match) {
        return prev.replace(/^(flowchart|graph)\s+[A-Za-z]{2}/i, `$1 ${dir}`);
      }
      return `flowchart ${dir}\n${prev}`;
    });
  };

  // Prettify / format code
  const handleFormatCode = () => {
    setSource((prev) => formatMermaid(prev));
  };

  /**
   * The preview, laid out by the geometry the board will use -- from the same
   * function now, rather than from a second copy of the rule.
   *
   * This block used to size its own nodes with the old character-count
   * estimate and a hard-coded height of 56, under a comment promising exactly
   * what it was not delivering. Once `build.ts` began measuring text the gap
   * became plain: a long label previewed 320x56 and built 320x93. A preview
   * that disagrees with the result is worse than no preview.
   */
  const preview = useMemo(() => {
    if (!graph) return null;
    const sizes = diagramNodeSizes(graph, renderStyle === 'sketch');
    const { nodes: placedNodes, clusters } = layoutGraph(graph, {
      originX: 20,
      originY: 20,
      sizeOf: (k) => sizes.get(k),
    });
    const at = new Map(placedNodes.map((p) => [p.key, p]));
    const clusterAt = new Map(clusters.map((c) => [c.key, c]));

    // Compute subgraph cluster boundaries
    const subgraphs = (graph.subgraphs || [])
      .map((sub) => {
        const clusterBox = clusterAt.get(sub.id);
        if (!clusterBox) return null;
        return {
          id: sub.id,
          title: sub.title,
          x: clusterBox.x,
          y: clusterBox.y,
          width: Math.max(80, clusterBox.width),
          height: Math.max(60, clusterBox.height),
        };
      })
      .filter(Boolean);

    const allX = placedNodes.map((p) => p.x + p.width);
    const allY = placedNodes.map((p) => p.y + p.height);
    const maxX = Math.max(200, ...allX, ...subgraphs.map((s) => s!.x + s!.width));
    const maxY = Math.max(150, ...allY, ...subgraphs.map((s) => s!.y + s!.height));

    return { placed: placedNodes, at, clusterAt, subgraphs, maxX, maxY };
  }, [graph, renderStyle]);

  /**
   * Whether the reader has taken the camera over.
   *
   * Declared here, above every closure that reads it: a ref used by a
   * `useCallback` whose dependency array is evaluated on render is exactly
   * how a temporal-dead-zone crash gets shipped, and this file has already
   * done that once.
   */
  const touchedRef = useRef(false);

  /**
   * The stage's own size, in CSS pixels.
   *
   * This is what makes the zoom mean anything. The SVG's `viewBox` used to be
   * the *content* box with `width: 100%`, so the browser already scaled the
   * diagram to fill the stage -- and the `<g transform="scale()">` then
   * multiplied on top of that, in viewBox units. `scale` was therefore not a
   * zoom factor at all, it was a second shrink applied to an already-fitted
   * picture, and the readout was a number with no referent. That is the "stuck
   * at 48%".
   *
   * With the viewBox equal to the stage, one viewBox unit is one pixel, the
   * transform is the only scaling, and `scale: 1` means 1:1.
   */
  /**
   * Ask for both label faces as soon as the dialog opens.
   *
   * `measureSize` in `build.ts` writes the box a label will live in *into the
   * document*, measured with whatever face is loaded at that moment. Unlike
   * the renderer, that number cannot be corrected later: it is content, shared
   * with everyone, and re-measuring it per viewer is exactly what
   * `DEFAULT_INK` warns against.
   *
   * Inter is on screen already by the time anybody opens this. Caveat is not
   * -- sketch mode is the only thing on the board that uses it -- so a diagram
   * added in sketch mode could have every box sized for the fallback face and
   * stay that way. Requesting on open gives the font the seconds somebody
   * spends typing to arrive before it matters.
   */
  useEffect(() => {
    if (!open) return;
    ensureFontLoaded(DEFAULT_TYPOGRAPHY.fontFamily);
    ensureFontLoaded('Caveat');
  }, [open]);

  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    // The SVG, not its container: the stage box includes the border, so
    // measuring it made the viewBox 502x381 for a 500x365 element -- the
    // units drifted from pixels and 100% was not quite 100%.
    const el = svgRef.current ?? stageRef.current;
    if (!open || !el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStageSize((prev) =>
        prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, preview]);

  const MIN_SCALE = 0.05;
  const MAX_SCALE = 8;
  const clampScale = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

  /** What a fitted view of the current diagram looks like. */
  const fittedView = useMemo(() => {
    if (!preview || !(stageSize.w > 0) || !(stageSize.h > 0)) return null;
    const contentW = preview.maxX + 40;
    const contentH = preview.maxY + 40;
    if (!(contentW > 0) || !(contentH > 0)) return null;

    // 0.92 leaves a margin, so the diagram is framed rather than wedged
    // against the edge. Capped at 1: a small diagram is shown at life size
    // rather than blown up to fill the panel, which would make two boxes look
    // like a poster and change size as you typed.
    const scale = clampScale(
      Math.min(stageSize.w / contentW, stageSize.h / contentH, 1) * 0.92
    );
    return {
      scale,
      pan: {
        x: (stageSize.w - contentW * scale) / 2,
        y: (stageSize.h - contentH * scale) / 2,
      },
    };
  }, [preview, stageSize.w, stageSize.h]);

  /**
   * Zoom about a point, so the pixel under the cursor stays under the cursor.
   *
   * Both pieces of state are computed from values read here rather than from
   * a `setPan` nested inside a `setScale` updater. An updater has to be pure:
   * React calls it twice under StrictMode, so the nested version applied the
   * pan twice and the view jumped on every wheel tick.
   */
  const zoomAt = (nextScale: number, cx: number, cy: number) => {
    const next = clampScale(nextScale);
    if (next === scale) return;
    touchedRef.current = true;
    setPan({
      x: cx - ((cx - pan.x) * next) / scale,
      y: cy - ((cy - pan.y) * next) / scale,
    });
    setScale(next);
  };

  /** Zoom by a step about the middle of the stage, for the buttons and keys. */
  const zoomByStep = (factor: number) => {
    zoomAt(scale * factor, stageSize.w / 2, stageSize.h / 2);
  };

  /** Frame the whole diagram. */
  const fitToView = useCallback(() => {
    touchedRef.current = false;
    if (!fittedView) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    setScale(fittedView.scale);
    setPan(fittedView.pan);
  }, [fittedView]);

  /**
   * Frame the diagram whenever it changes shape.
   *
   * The preview opened at 100% and origin, so anything taller than the stage
   * arrived showing its top-left corner -- the reader's first move was always
   * to zoom out and find the rest. Fitting on change means the picture is
   * whole by default, which is what a preview is for.
   *
   * Only while the reader has not taken over: once somebody has zoomed or
   * panned deliberately, re-framing under them on the next keystroke would be
   * the interface arguing with them.
   */
  useEffect(() => {
    if (!open || !fittedView || touchedRef.current) return;
    setScale(fittedView.scale);
    setPan(fittedView.pan);
  }, [open, fittedView]);

  useEffect(() => {
    if (!open) touchedRef.current = false;
  }, [open]);

  /**
   * Zoom from the keyboard, but never while the caret is in the editor --
   * `-` and `0` are characters somebody is trying to type, and stealing them
   * to move a picture is the kind of shortcut that gets a feature disabled.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement?.tagName;
      if (el === 'TEXTAREA' || el === 'INPUT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomByStep(1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomByStep(1 / 1.25); }
      else if (e.key === '0') { e.preventDefault(); zoomAt(1, 0, 0); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); fitToView(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;
  const subgraphCount = graph?.subgraphs?.length ?? 0;

  return (
    <div className="export-scrim" onPointerDown={onClose} role="presentation">
      <div
        ref={panelRef}
        className="mermaid-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mermaid-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="mermaid-modal__head">
          <div>
            <h2 id="mermaid-title">
              {replacing ? 'Edit diagram' : 'Diagram from code'}
            </h2>
            {/* The count belongs with the title, not in a toolbar: it is what
                was understood, not something to operate. */}
            <span className="mm-count">
              {graph
                ? `${nodeCount} ${nodeCount === 1 ? 'box' : 'boxes'} · ${edgeCount} ${
                    edgeCount === 1 ? 'connection' : 'connections'
                  }${subgraphCount ? ` · ${subgraphCount} ${subgraphCount === 1 ? 'group' : 'groups'}` : ''}`
                : 'Mermaid syntax'}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>


        <div className="mermaid-modal__body">
          {/* Left Editor Column */}
          <div className="mermaid-modal__editor">
            {/* Beside the editor, because both change the source: templates
                replace it, direction rewrites its first line. */}
            <div className="mm-bar">
              <div className="mm-bar__group">
                <label className="mermaid-modal__label" htmlFor="mermaid-source">
                  Code
                </label>
                <div className="mm-seg" role="group" aria-label="Flow direction">
                  {DIRECTIONS.map(({ id, Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      className="mm-seg__btn"
                      title={label}
                      aria-label={label}
                      aria-pressed={currentDirection === id}
                      onClick={() => handleSetDirection(id)}
                    >
                      <Icon size={12} aria-hidden />
                      {id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mm-bar__group">
                <button
                  type="button"
                  className="mm-btn"
                  onClick={handleFormatCode}
                  title="Tidy the indentation and spacing"
                >
                  <Wand2 size={12} aria-hidden /> Format
                </button>
              </div>
            </div>

            {/* Templates seed the editor, so they live over it. A row of quiet
                chips rather than a labelled strip: the label said "Templates:"
                next to five buttons that are visibly templates. */}
            <div className="mm-seg mm-templates" role="group" aria-label="Start from a template">
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  className="mm-seg__btn"
                  aria-pressed={activeTemplate === tmpl.id}
                  onClick={() => {
                    setSource(tmpl.source);
                    setActiveTemplate(tmpl.id);
                  }}
                >
                  {tmpl.name}
                </button>
              ))}
            </div>


            <textarea
              id="mermaid-source"
              ref={textRef}
              className="mermaid-modal__code"
              value={source}
              spellCheck={false}
              onChange={(e) => {
                setSource(e.target.value);
                setActiveTemplate(null);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  if (graph) {
                    onApply(source, { theme: themeId, renderStyle });
                    onClose();
                  }
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: s, selectionEnd: end, value } = el;
                  const next = `${value.slice(0, s)}    ${value.slice(end)}`;
                  setSource(next);
                  requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
                }
              }}
            />
          </div>

          {/* Right Live Preview Column */}
          <div className="mermaid-modal__preview">
            {/* Palette and style sit over the preview because that is what they
                change. They used to share a strip with the templates, which
                change the code -- one horizontally-scrolling row asking the
                reader to work out which half of it affected which half of the
                dialog. */}
            <div className="mm-bar">
              <div className="mm-bar__group">
                <span className="mermaid-modal__label">Preview</span>
              </div>

              <div className="mm-bar__group">
                <div className="mm-palette" role="group" aria-label="Palette">
                  {(Object.keys(DIAGRAM_THEMES) as DiagramThemeId[]).map((tKey) => {
                    const t = DIAGRAM_THEMES[tKey];
                    return (
                      <button
                        key={tKey}
                        type="button"
                        className="mm-swatch"
                        title={t.name}
                        aria-label={t.name}
                        aria-pressed={themeId === tKey}
                        onClick={() => setThemeId(tKey)}
                      >
                        <span
                          className="mm-swatch__dot"
                          style={{ background: t.primaryStroke }}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="mm-seg" role="group" aria-label="Drawing style">
                  <button
                    type="button"
                    className="mm-seg__btn"
                    aria-pressed={renderStyle === 'crisp'}
                    onClick={() => setRenderStyle('crisp')}
                  >
                    Crisp
                  </button>
                  <button
                    type="button"
                    className="mm-seg__btn"
                    aria-pressed={renderStyle === 'sketch'}
                    onClick={() => setRenderStyle('sketch')}
                  >
                    <PenTool size={11} aria-hidden /> Sketch
                  </button>
                </div>
              </div>
            </div>
            {/* The cluster is a *sibling* of the stage, not a child of it.
                Inside, it sat under an element whose `pointerdown` calls
                `setPointerCapture` to start a pan -- so a press on a zoom
                button could be captured by the stage and the click never
                completed. Moving it out removes the interaction entirely
                rather than patching around it with `stopPropagation`. */}
            <div className="mm-stagewrap">
            <div
              className="mermaid-modal__stage"
              ref={stageRef}
              aria-busy={previewPending}
              onPointerDown={(e) => {
                isDragging.current = true;
                lastMousePos.current = { x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!isDragging.current) return;
                const dx = e.clientX - lastMousePos.current.x;
                const dy = e.clientY - lastMousePos.current.y;
                touchedRef.current = true;
                setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
                lastMousePos.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={(e) => {
                isDragging.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={(e) => {
                isDragging.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              /**
               * The wheel zooms, with no modifier required.
               *
               * It needed Cmd/Ctrl before, which is the right rule for a whole
               * page that also scrolls and the wrong one for a stage that does
               * not: the gesture did nothing at all on its own, so the obvious
               * thing to try was the thing that failed silently.
               *
               * Multiplicative, not additive: a fixed +0.2 is a 20% change at
               * 1x and a 200% change at 0.1x, which is why additive zoom feels
               * unusable at the bottom of its range.
               */
              onWheel={(e) => {
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                zoomAt(
                  scale * Math.exp(-e.deltaY * 0.0015),
                  e.clientX - box.left,
                  e.clientY - box.top
                );
              }}
            >
              {preview && graph ? (
                <>
                  <svg
                    ref={svgRef}
                    /* The stage, not the content: see `stageSize`. */
                    viewBox={`0 0 ${stageSize.w || 1} ${stageSize.h || 1}`}
                    role="img"
                    aria-label={`${nodeCount} boxes, ${edgeCount} connections`}
                    className="mm-stage-svg"
                  >
                    <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
                      <defs>
                        <marker
                          id="mermaid-arrow-end"
                          viewBox="0 0 10 10"
                          refX="9"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 10 5 L 0 9 z" fill={activeTheme.connectorColor} />
                        </marker>
                        <marker
                          id="mermaid-arrow-start"
                          viewBox="0 0 10 10"
                          refX="1"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 10 1 L 0 5 L 10 9 z" fill={activeTheme.connectorColor} />
                        </marker>
                      </defs>

                      {/* Render Subgraph Cluster Frames */}
                      {preview.subgraphs?.map(
                        (sub) =>
                          sub && (
                            <g key={sub.id} className="mermaid-preview__subgraph">
                              <rect
                                x={sub.x}
                                y={sub.y}
                                width={sub.width}
                                height={sub.height}
                                rx={8}
                                fill={activeTheme.clusterFill}
                                stroke={activeTheme.clusterStroke}
                                strokeWidth={1.5}
                                strokeDasharray={renderStyle === 'sketch' ? '5 3' : '4 4'}
                              />
                              <text
                                x={sub.x + 10}
                                y={sub.y + 16}
                                fontSize={11}
                                fontWeight={600}
                                fill={activeTheme.textColor}
                                letterSpacing="0.02em"
                              >
                                {sub.title}
                              </text>
                            </g>
                          )
                      )}

                      {/* Render Edges */}
                      {graph.edges.map((edge, i) => {
                        const a = preview.at.get(edge.from) || preview.clusterAt.get(edge.from);
                        const b = preview.at.get(edge.to) || preview.clusterAt.get(edge.to);
                        if (!a || !b) return null;

                        const ax = a.x + a.width / 2;
                        const ay = a.y + a.height / 2;
                        const bx = b.x + b.width / 2;
                        const by = b.y + b.height / 2;
                        const midX = (ax + bx) / 2;
                        const midY = (ay + by) / 2;

                        return (
                          <g key={i}>
                            <line
                              x1={ax}
                              y1={ay}
                              x2={bx}
                              y2={by}
                              stroke={activeTheme.connectorColor}
                              strokeDasharray={edge.line === 'dotted' ? '3 4' : undefined}
                              strokeWidth={edge.line === 'thick' ? 3 : 1.75}
                              markerEnd={edge.arrow ? 'url(#mermaid-arrow-end)' : undefined}
                              markerStart={edge.bidirectional ? 'url(#mermaid-arrow-start)' : undefined}
                            />
                            {edge.label && (
                              <g transform={`translate(${midX}, ${midY})`}>
                                <rect
                                  x={-((edge.label.length * 6.5) / 2 + 6)}
                                  y={-9}
                                  width={edge.label.length * 6.5 + 12}
                                  height={18}
                                  rx={4}
                                  fill={activeTheme.clusterFill}
                                  stroke={activeTheme.clusterStroke}
                                  strokeWidth={1}
                                />
                                <text
                                  x={0}
                                  y={3.5}
                                  fontSize={10}
                                  fontWeight={500}
                                  fill={activeTheme.textColor}
                                  textAnchor="middle"
                                >
                                  {edge.label}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}

                      {/* Render Nodes */}
                      {graph.nodes.map((node, nodeIdx) => {
                        const p = preview.at.get(node.key);
                        if (!p) return null;
                        return (
                          <g key={node.key}>
                            {renderPreviewShape(node, p, activeTheme, nodeIdx, renderStyle)}
                            <text
                              x={p.x + p.width / 2}
                              y={p.y + p.height / 2 + 4}
                              fontSize={12}
                              fontWeight={500}
                              fontFamily={renderStyle === 'sketch' ? 'Caveat, cursive' : 'Inter, sans-serif'}
                              fill={node.style?.color || activeTheme.textColor}
                              textAnchor="middle"
                            >
                              {node.label.split('\n')[0].slice(0, 24)}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  </svg>

                </>
              ) : (
                <p className="mermaid-modal__empty">
                  {error ?? 'Write a flowchart on the left to see it live here.'}
                </p>
              )}
            </div>

              <div
                className="mm-seg mm-zoom"
                role="group"
                aria-label="Zoom"
              >
                <button
                  type="button"
                  className="mm-seg__btn"
                  onClick={() => zoomByStep(1 / 1.25)}
                  aria-label="Zoom out"
                  title="Zoom out  (−)"
                >
                  <ZoomOut size={13} strokeWidth={1.75} aria-hidden />
                </button>
                {/* The readout is the reset: one control, and its label is
                    the state it returns you from. */}
                <button
                  type="button"
                  className="mm-seg__btn mm-zoom__value"
                  onClick={() => zoomAt(1, 0, 0)}
                  title="Reset to 100%  (0)"
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  type="button"
                  className="mm-seg__btn"
                  onClick={() => zoomByStep(1.25)}
                  aria-label="Zoom in"
                  title="Zoom in  (+)"
                >
                  <ZoomIn size={13} strokeWidth={1.75} aria-hidden />
                </button>
                <button
                  type="button"
                  className="mm-seg__btn"
                  onClick={fitToView}
                  aria-label="Fit to view"
                  title="Fit to view  (F)"
                >
                  <Maximize size={12} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer className="mermaid-modal__foot">
          <span className={`mermaid-modal__status${error ? ' is-error' : ''}`}>
            {error ? (
              <>
                <AlertTriangle size={14} aria-hidden />
                {errorLine ? `[Line ${errorLine}] ` : ''}
                {error}
                {/* Say what the preview is showing, so a picture built from
                    less than the whole document never passes for the whole
                    document. Recovery has to be visible to be trustworthy. */}
                {graph && skippedLines.length > 0 ? (
                  <em className="mermaid-modal__status-note">
                    {' '}— previewing without{' '}
                    {skippedLines.length === 1
                      ? `line ${skippedLines[0]}`
                      : `lines ${skippedLines.join(', ')}`}
                  </em>
                ) : null}
              </>
            ) : graph ? (
              /* The count moved to the header, beside the title it describes.
                 Repeating it here said the same thing twice and got the
                 plural wrong the second time ("1 clusters"). What the footer
                 owes the reader is whether it is safe to press the button. */
              <>
                <Check size={14} aria-hidden /> Ready
              </>
            ) : (
              'Nothing yet'
            )}
          </span>
          <div className="mermaid-modal__actions">
            <button className="export__ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="export__primary"
              disabled={!graph}
              onClick={() => {
                onApply(source, { theme: themeId, renderStyle });
                onClose();
              }}
            >
              {replacing ? 'Update diagram' : 'Add to board'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

/**
 * Renders SVG silhouette matching the exact MermaidShape with active Theme palette
 */
function renderPreviewShape(
  node: MermaidNode,
  p: { x: number; y: number; width: number; height: number },
  theme: typeof DIAGRAM_THEMES.indigo,
  nodeIdx: number,
  renderStyle: 'crisp' | 'sketch'
): React.ReactNode {
  const defaultFill = theme.accentFills[nodeIdx % theme.accentFills.length] || theme.primaryFill;
  const fill = node.style?.fill || defaultFill;
  const stroke = node.style?.stroke || theme.primaryStroke;
  const strokeWidth = node.style?.strokeWidth || (renderStyle === 'sketch' ? 2 : 1.75);

  const shape = node.shape;

  /**
   * The outline comes from `silhouetteFor`, which derives it from
   * `SHAPE_SPECS` -- the same table `build.ts` uses to make canvas nodes.
   *
   * This used to be a `switch (shape)` with `case 'rect': default:` at the
   * bottom, and three of the fourteen shapes had no case: `trapezoid`,
   * `trapezoid_inv` and `flag` fell through, so the board drew a polygon and
   * the preview drew a rectangle for the same source. A preview that
   * disagrees with the result is worse than no preview.
   */
  const sil = silhouetteFor(shape);
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const paint = { fill, stroke, strokeWidth };

  if (sil.kind === 'ellipse') {
    return (
      <g>
        <ellipse cx={cx} cy={cy} rx={p.width / 2} ry={p.height / 2} {...paint} />
        {sil.ornament === 'ring' && (
          <ellipse
            cx={cx}
            cy={cy}
            rx={p.width / 2 - 4}
            ry={p.height / 2 - 4}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
          />
        )}
      </g>
    );
  }

  if (sil.kind === 'polygon') {
    return <polygon points={polygonPoints(p, sil.points)} {...paint} />;
  }

  if (sil.ornament === 'cylinder') {
    return (
      <g>
        <path
          d={`M ${p.x} ${p.y + 10} A ${p.width / 2} 10 0 0 0 ${p.x + p.width} ${p.y + 10} L ${p.x + p.width} ${p.y + p.height - 10} A ${p.width / 2} 10 0 0 1 ${p.x} ${p.y + p.height - 10} Z`}
          {...paint}
        />
        <ellipse cx={cx} cy={p.y + 10} rx={p.width / 2} ry={9} {...paint} />
      </g>
    );
  }

  const rx = clampRadius(sil.cornerRadius, p.width, p.height);
  return (
    <g>
      <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={rx} {...paint} />
      {sil.ornament === 'bars' && (
        <>
          <line x1={p.x + 8} y1={p.y} x2={p.x + 8} y2={p.y + p.height} stroke={stroke} strokeWidth={strokeWidth} />
          <line
            x1={p.x + p.width - 8}
            y1={p.y}
            x2={p.x + p.width - 8}
            y2={p.y + p.height}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </>
      )}
    </g>
  );
}

function polygonPoints(
  p: { x: number; y: number; width: number; height: number },
  sides: number
): string {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const rx = p.width / 2;
  const ry = p.height / 2;
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return `${cx + Math.cos(angle) * rx},${cy + Math.sin(angle) * ry}`;
  }).join(' ');
}
