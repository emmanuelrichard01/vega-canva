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
  LayoutTemplate,
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
import {
  looksLikeSequence,
  parseSequence,
  layoutSequence,
  SEQ_TYPE,
  SELF_REACH,
  SELF_DROP,
} from '../engine/diagram/sequence';
import { sequenceMeasurer } from '../engine/diagram/sequenceMeasure';
import {
  looksLikePie,
  parsePie,
  layoutPie,
  wedgePath,
  PIE_LEGEND_SIZE,
  PIE_SLICE_SIZE,
} from '../engine/diagram/pie';
import { diagramNodeSizes } from '../engine/diagram/build';

/**
 * The starting points, and what each one is for.
 *
 * A template is the fastest honest answer to "what can this thing do", so the
 * set is chosen to *span* the feature rather than to repeat it: two engines
 * (flowchart, sequence and pie), every shape, subgraphs, class styling, all
 * four arrow weights, notes, self-messages, and every block form — `loop`,
 * `alt`/`else`, `opt` and `par`. Somebody who clicks through all of them has
 * seen the whole vocabulary without reading any documentation.
 *
 * Each one is a real artefact rather than a demonstration of syntax -- an
 * OAuth exchange that is actually correct, a pipeline that actually branches
 * the way pipelines do. A template that is obviously a toy teaches that the
 * feature is a toy.
 *
 * The `kind` groups the picker, because "which of these draws a timeline"
 * is the first thing to know and the names alone do not say — Checkout and
 * CI/CD could each be either.
 */
const TEMPLATES: ReadonlyArray<{
  id: string;
  name: string;
  kind: 'flow' | 'sequence' | 'pie';
  source: string;
}> = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    kind: 'flow',
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
    kind: 'flow',
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
    kind: 'flow',
    source: `%% Nested subgraphs for the trust boundaries, classDef to colour a
%% tier at a time, and thick arrows for the path a request actually takes.
flowchart TD
    subgraph Edge ["Public edge"]
        Web([Browser]):::client
        Mobile([iOS / Android]):::client
        CDN{{CDN + WAF}}:::edge
    end

    subgraph Cloud ["Private network"]
        LB{{Load balancer}}:::edge

        subgraph Services ["Services"]
            Gateway[API gateway]:::svc
            Auth[[Auth]]:::svc
            Orders[[Orders]]:::svc
            Search[[Search]]:::svc
        end

        subgraph Async ["Work that outlives the request"]
            Queue[/Job queue/]:::queue
            Worker[Workers]:::svc
        end

        Cache[(Redis)]:::data
        Main[(Postgres)]:::data
        Blob[(Object store)]:::data
    end

    Web & Mobile ==> CDN
    CDN ==> LB
    LB ==> Gateway
    Gateway ==> Auth & Orders & Search
    Auth --> Cache
    Orders ==> Main
    Orders -.->|receipt, email, webhook| Queue
    Queue --> Worker
    Worker --> Blob
    Worker -.->|retry| Queue
    Search --> Cache

    classDef client fill:#EEF2FF,stroke:#6366F1
    classDef edge fill:#F5F3FF,stroke:#7C3AED
    classDef svc fill:#ECFDF5,stroke:#059669
    classDef queue fill:#FFF7ED,stroke:#EA580C
    classDef data fill:#FEF3C7,stroke:#D97706`,
  },
  {
    id: 'gitflow',
    name: 'Git Branching Strategy',
    kind: 'flow',
    source: `%% "&" fans one arrow out to several nodes, and the loops are the
%% point: a failing check sends work back rather than forward.
flowchart LR
    Main([main]) --> Feat1[feature/canvas]
    Main --> Feat2[feature/export]
    Main --> Hot[/hotfix/]

    Feat1 & Feat2 --> Review{Review + CI}
    Review -->|approved| Squash[[Squash merge]]
    Review -.->|changes requested| Fix[Fix and push]
    Fix --> Review

    Squash --> Staging[(staging)]
    Staging --> Soak{Soak 24h}
    Soak -.->|regression| Revert>Revert]
    Revert --> Main
    Soak -->|clean| Tag[/Tag a version/]
    Tag ==> Main
    Hot ==>|straight to prod| Tag`,
  },
  {
    id: 'cicd',
    name: 'CI/CD Pipeline',
    kind: 'flow',
    source: `%% Thick arrows are the path a green build takes; dotted is the way
%% out. Everything inside the group runs at once.
flowchart LR
    Push([Push]) ==> Install[Install + cache]

    subgraph Checks ["Runs in parallel"]
        Lint[Typecheck + lint]
        Test[Unit tests]
        Build[Build]
        Scan[Dependency audit]
    end

    Install ==> Lint & Test & Build & Scan
    Lint & Test & Build & Scan ==> Gate{All green?}

    Gate -.->|no| Report[/Annotate the failing lines/]
    Report -.-> Push
    Gate ==>|yes| Canary[[Deploy 5%]]
    Canary --> Watch{Error rate steady?}
    Watch -.->|no| Roll>Roll back]
    Watch ==>|yes| Full[[Deploy 100%]]
    Full ==> Live(((Live)))`,
  },
  {
    id: 'state',
    name: 'State Machine',
    kind: 'flow',
    source: `%% An order's whole life. Self-loops for the states that retry, a
%% double circle for the ones you can never leave.
flowchart LR
    New(((Draft))) --> Placed([Placed])
    Placed --> Pay{Payment}
    Pay -->|authorised| Picking{{Picking}}
    Pay -.->|declined| Held[/On hold/]
    Held -->|new card| Pay
    Held -->|48h| Cancelled(((Cancelled)))

    Picking -->|short stock| Picking
    Picking --> Shipped([Shipped])
    Shipped --> Delivered(((Delivered)))
    Shipped -.->|lost| Claim[Claim]
    Claim --> Refunded(((Refunded)))
    Delivered -.->|30 days| Returned[Return]
    Returned --> Refunded`,
  },
  {
    id: 'pipeline',
    name: 'Data Pipeline',
    kind: 'flow',
    source: `%% Where the data comes from, what happens to it, and what happens
%% when a batch is bad. Dotted arrows are the failure paths.
flowchart LR
    subgraph Sources ["Sources"]
        App[(App events)]:::src
        Crm[(CRM export)]:::src
        Files[/Partner CSVs/]:::src
    end

    App & Crm & Files ==> Land[(Landing zone)]
    Land ==> Validate{Schema valid?}

    Validate -.->|no| Quarantine[[Quarantine]]:::bad
    Quarantine -.-> Alert>Page the owner]

    Validate ==>|yes| Clean[Dedupe + normalise]
    Clean ==> Enrich[Join reference data]
    Enrich ==> Warehouse[(Warehouse)]

    subgraph Serving ["Serving"]
        Marts[Marts]:::out
        Dash[Dashboards]:::out
        Model[Feature store]:::out
    end

    Warehouse ==> Marts ==> Dash
    Warehouse ==> Model
    Model -.->|drift detected| Enrich

    classDef src fill:#EEF2FF,stroke:#6366F1
    classDef bad fill:#FEE2E2,stroke:#DC2626
    classDef out fill:#ECFDF5,stroke:#059669`,
  },
  {
    id: 'oauth',
    name: 'OAuth 2.0 (PKCE)',
    kind: 'sequence',
    source: `%% OAuth is a conversation, so it is drawn as one. Solid arrows are
%% requests, dotted are the replies -- and the vertical order is the only
%% thing that says which step comes first.
sequenceDiagram
    actor User as User
    participant App as Single-page app
    participant IdP as Identity provider
    participant API as Resource API

    Note over App: Generates code_verifier
    App->>App: Hash it into code_challenge
    User->>App: Click "Sign in"
    App->>IdP: Authorize + code_challenge
    IdP->>User: Show consent screen
    User->>IdP: Approve
    IdP-->>App: Authorization code
    App->>IdP: Exchange code + code_verifier
    IdP-->>App: Access token + refresh token
    Note over App,API: The token never leaves the browser tab
    App->>API: GET /me with bearer token
    API-->>App: Profile
    App-)IdP: Refresh in the background`,
  },
  {
    id: 'checkout',
    name: 'Checkout & Payment',
    kind: 'sequence',
    source: `%% Where the money is is where the failure cases matter, so they are
%% drawn: "-x" is a message that does not arrive, and the async arrow is work
%% that outlives the request.
sequenceDiagram
    actor Buyer as Buyer
    participant Store as Storefront
    participant Cart as Cart service
    participant PSP as Payment provider
    participant Bank as Issuing bank
    participant Mail as Email worker

    Buyer->>Store: Confirm order
    Store->>Cart: Reserve stock
    Cart-->>Store: Reserved for 15 min
    Store->>PSP: Authorize
    PSP->>Bank: Request funds
    Bank-->>PSP: 3-D Secure required
    PSP-->>Store: Challenge URL
    Store->>Buyer: Redirect to the bank
    Buyer->>Bank: Approve
    Bank-->>PSP: Authorized
    PSP-->>Store: Payment captured
    Note over Store,Cart: Reservation becomes a real allocation
    Store->>Cart: Commit
    Store-)Mail: Queue the receipt
    Store-->>Buyer: Order confirmed
    Mail-xBuyer: Bounced address, retried later`,
  },
  {
    id: 'incident',
    name: 'Incident Response',
    kind: 'sequence',
    source: `%% A postmortem timeline, drawn while it is still fresh. Notes carry
%% the things that are true of a span rather than of one message.
sequenceDiagram
    participant Alert as Alerting
    actor Oncall as On-call
    participant Svc as Checkout service
    participant DB as Primary database
    actor Lead as Incident lead
    participant Status as Status page

    Alert->>Oncall: p99 latency over budget
    Oncall->>Svc: Read the dashboards
    Svc-->>Oncall: Connection pool saturated
    Oncall->>DB: Check active queries
    DB-->>Oncall: One unindexed scan, 40s
    Note over Oncall,Lead: Declared a Sev-2 at 14:12
    Oncall->>Lead: Page the incident lead
    Lead->>Status: Post "investigating"
    Oncall->>DB: Kill the query
    DB-->>Svc: Pool recovers
    Svc-->>Alert: Latency back under budget
    Note over Lead,Status: Monitored for 30 minutes before closing
    Lead->>Status: Post "resolved"
    Lead-)Oncall: Schedule the postmortem`,
  },
  {
    id: 'retry',
    name: 'Retry with Backoff',
    kind: 'sequence',
    source: `%% What a resilient client actually does. "loop" frames the range
%% it repeats, "alt" the branch it takes, "opt" the step it may skip —
%% each is a box around the messages inside it, not a message of its own.
sequenceDiagram
    actor Caller as Caller
    participant Client as SDK client
    participant Api as Payments API
    participant Bus as Event bus

    Caller->>Client: charge(order)
    loop up to 3 attempts
        Client->>Api: POST /charges
        alt accepted
            Api-->>Client: 201 Created
        else rate limited
            Api-->>Client: 429 Retry-After
            Note over Client: Sleeps, then doubles the wait
        else server error
            Api--xClient: 503
        end
    end

    opt every attempt failed
        Client-->>Caller: PaymentUnavailable
    end

    Client-)Bus: Emit charge.attempted
    Client-->>Caller: Receipt`,
  },
  {
    id: 'trace',
    name: 'Distributed Trace',
    kind: 'sequence',
    source: `%% One request across four services, with the parallel fan-out
%% drawn as what it is: "par" frames work that happens at the same time.
sequenceDiagram
    participant Edge as Edge proxy
    participant Web as Web app
    participant Cart as Cart
    participant Stock as Inventory
    participant Price as Pricing

    Edge->>Web: GET /checkout
    Web->>Cart: Load basket
    Cart-->>Web: 4 items

    par fan out
        Web->>Stock: Reserve all four
    and
        Web->>Price: Quote with promotions
    end

    Stock-->>Web: 3 reserved, 1 short
    Price-->>Web: Total with discount

    alt everything in stock
        Web-->>Edge: 200 with the full basket
    else something is short
        Note over Web,Cart: Basket is split, not failed
        Web->>Cart: Move the short item to saved
        Web-->>Edge: 200 with a warning
    end`,
  },
  {
    id: 'sprint',
    name: 'Where the Sprint Went',
    kind: 'pie',
    source: `%% A pie is a title and a list of shares. The numbers are whatever
%% unit you like — they are normalised, so these are hours.
pie title Where the sprint actually went
    "Shipping the roadmap" : 34
    "Reviewing each other's code" : 18
    "Production incidents" : 15
    "Meetings that were emails" : 21
    "Fighting the build" : 12`,
  },
  {
    id: 'bundle',
    name: 'Bundle Budget',
    kind: 'pie',
    source: `%% "showData" prints the raw number beside each share, which is what
%% you want when the units mean something. These are kilobytes gzipped.
pie showData title What is in the 480 kB bundle
    "Framework" : 128
    "Canvas engine" : 96
    "Icons and fonts" : 74
    "Collaboration (CRDT)" : 71
    "Charts" : 58
    "Everything else" : 53`,
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
  /**
   * Which kind of diagram is in the editor.
   *
   * Decided from the source rather than from a mode the reader has to set,
   * because mermaid already says so on its first line and asking twice is a
   * way for the two answers to disagree. `sequence.ts` explains why the two
   * take different paths from here: a flowchart is a graph and goes to dagre,
   * a sequence diagram is a timeline and is laid out as a table.
   */
  const isSequence = looksLikeSequence(settledSource);
  const isPie = !isSequence && looksLikePie(settledSource);
  const flow = useMemo(() => parseMermaidLenient(settledSource), [settledSource]);
  const seq = useMemo(
    () => (isSequence ? parseSequence(settledSource) : null),
    [settledSource, isSequence]
  );
  const pie = useMemo(() => (isPie ? parsePie(settledSource) : null), [settledSource, isPie]);
  const pieLayout = useMemo(
    () =>
      pie?.chart
        ? layoutPie(pie.chart, {
            originX: 20,
            originY: 20,
            // The same measurer the insert uses, so the card is the same size
            // in the preview as on the board.
            measure: sequenceMeasurer(renderStyle === 'sketch'),
          })
        : null,
    [pie, renderStyle]
  );

  const seqLayout = useMemo(
    () =>
      seq?.diagram
        ? layoutSequence(seq.diagram, {
            originX: 20,
            originY: 20,
            // The same measurer the insert uses, so the preview breaks its
            // lines exactly where the board will.
            measure: sequenceMeasurer(renderStyle === 'sketch'),
          })
        : null,
    [seq, renderStyle]
  );

  const graph = isSequence || isPie ? null : flow.graph;
  const error = isSequence ? seq?.error ?? null : isPie ? pie?.error ?? null : flow.error;
  const errorLine = isSequence ? seq?.errorLine : isPie ? pie?.errorLine : flow.errorLine;
  const skippedLines =
    (isSequence ? seq?.skippedLines : isPie ? pie?.skippedLines : flow.skippedLines) ?? [];
  /** Something parsed that the button could insert -- of any of the three kinds. */
  const ready = Boolean(graph || seqLayout || pieLayout);
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
    /**
     * A sequence diagram has its own geometry and none of the flowchart's, so
     * it reports only the bounds the stage needs to fit and leaves every
     * flowchart collection empty -- the `map`s below then draw nothing without
     * a branch of their own.
     */
    if (seqLayout || pieLayout) {
      const box = seqLayout ?? pieLayout!;
      return {
        placed: [],
        at: new Map(),
        clusterAt: new Map(),
        subgraphs: [],
        maxX: box.width + 60,
        maxY: box.height + 60,
      };
    }
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
  }, [graph, seqLayout, pieLayout, renderStyle]);

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

  // A sequence diagram counts participants and messages; the words differ
  // because the things do, and "3 boxes" for three lifelines would be wrong.
  const nodeCount = pieLayout
    ? pieLayout.wedges.length
    : seqLayout
      ? seqLayout.lanes.length
      : graph?.nodes.length ?? 0;
  const edgeCount = seqLayout
    ? seqLayout.steps.filter((st) => st.kind === 'arrow').length
    : graph?.edges.length ?? 0;
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
          {/* The title block takes the slack, so the close button lands at the
              far right of the header rather than tucked against the heading.
              `h2 { flex: 1 }` could not do it: the h2 is nested one level
              down, so it was growing inside this wrapper while the wrapper
              itself stayed shrink-to-fit. */}
          <div className="mermaid-modal__title">
            <h2 id="mermaid-title">
              {replacing ? 'Edit diagram' : 'Diagram from code'}
            </h2>
            {/* The count belongs with the title, not in a toolbar: it is what
                was understood, not something to operate. */}
            <span className="mm-count">
              {pieLayout
                ? `${nodeCount} ${nodeCount === 1 ? 'slice' : 'slices'}`
                : seqLayout
                ? `${nodeCount} ${nodeCount === 1 ? 'participant' : 'participants'} · ${edgeCount} ${
                    edgeCount === 1 ? 'message' : 'messages'
                  }`
                : graph
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
                {/*
                  Nine templates as one control, not as nine chips.

                  The chips were a wrapping strip two rows deep above a code
                  editor — the largest block of chrome in the dialog, spent on
                  something used once at the start and never again. A menu is
                  the same nine choices in one row's height, and it puts the
                  space back where the work is.

                  Native, for the reason `EndPicker` is: the platform draws an
                  overlay that escapes this column, `optgroup` labels the two
                  engines properly — better than the hairline the strip needed
                  to say the same thing — and keyboard and type-ahead come free.
                */}
                <span className="mm-template-picker">
                  <LayoutTemplate size={12} aria-hidden />
                  <select
                    className="mm-template-picker__select"
                    value={activeTemplate ?? ''}
                    aria-label="Start from a template"
                    onChange={(e) => {
                      const chosen = TEMPLATES.find((t) => t.id === e.target.value);
                      if (!chosen) return;
                      setSource(chosen.source);
                      setActiveTemplate(chosen.id);
                    }}
                  >
                    {/* Present only until one is picked: it is the empty state,
                        not a way back to it — there is nothing to return to. */}
                    {!activeTemplate && <option value="">Template</option>}
                    <optgroup label="Flowcharts">
                      {TEMPLATES.filter((t) => t.kind === 'flow').map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Sequence diagrams">
                      {TEMPLATES.filter((t) => t.kind === 'sequence').map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Pie charts">
                      {TEMPLATES.filter((t) => t.kind === 'pie').map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </span>
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
                  if (ready) {
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
              {preview && ready ? (
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

                      {/*
                        The sequence layer.

                        Drawn in the order it is read: lifelines first so the
                        heads and notes sit on top of them, then the heads,
                        then the messages. It mirrors what `buildSequence.ts`
                        puts on the board rather than approximating it -- a
                        preview that arranges things differently from the
                        insert is worse than no preview, because it is only
                        found out once somebody has trusted it.
                      */}
                      {pieLayout && (
                        <g className="mermaid-preview__pie">
                          {/* The legend card, under its rows: it is what gives
                              the labels a surface to read against on any
                              board. See `legendCard`. */}
                          <rect
                            x={pieLayout.legendCard.x}
                            y={pieLayout.legendCard.y}
                            width={pieLayout.legendCard.width}
                            height={pieLayout.legendCard.height}
                            rx={8}
                            fill={activeTheme.clusterFill}
                            stroke={activeTheme.canvasInk}
                            strokeWidth={1}
                          />
                          {pieLayout.titleBox && (
                            <text
                              x={pieLayout.titleBox.x + pieLayout.titleBox.width / 2}
                              y={pieLayout.titleBox.y + 22}
                              textAnchor="middle"
                              fontSize={20}
                              fontWeight={600}
                              fill={activeTheme.canvasInk}
                            >
                              {pieLayout.title}
                            </text>
                          )}
                          {/* The same path the insert builds, from the same
                              geometry — a preview that drew its own arcs could
                              disagree with the wedge you are about to get. */}
                          {pieLayout.wedges.map((wedge, i) => (
                            <path
                              key={"wedge-" + i}
                              d={wedgePath(wedge)}
                              fill={
                                activeTheme.accentFills[i % activeTheme.accentFills.length] ||
                                activeTheme.primaryFill
                              }
                              stroke={activeTheme.primaryStroke}
                              strokeWidth={1.5}
                            />
                          ))}
                          {/* The share on each wedge with room for it. On the
                              wedge's own fill, so `textColor` is the right ink
                              here even though it is wrong on the bare board. */}
                          {pieLayout.wedges.map((wedge, i) =>
                            wedge.sliceLabel ? (
                              <text
                                key={"share-" + i}
                                x={wedge.centroid.x}
                                y={wedge.centroid.y}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize={PIE_SLICE_SIZE}
                                fontWeight={600}
                                fill={activeTheme.textColor}
                              >
                                {wedge.sliceLabel}
                              </text>
                            ) : null
                          )}
                          {pieLayout.wedges.map((wedge, i) => {
                            const swatch = 14;
                            return (
                              <g key={"legend-" + i}>
                                <rect
                                  x={wedge.legend.x}
                                  y={wedge.legend.y + (wedge.legend.height - swatch) / 2}
                                  width={swatch}
                                  height={swatch}
                                  rx={3}
                                  fill={
                                    activeTheme.accentFills[i % activeTheme.accentFills.length] ||
                                    activeTheme.primaryFill
                                  }
                                  stroke={activeTheme.primaryStroke}
                                  strokeWidth={1}
                                />
                                {/* The lines the layout decided on. Composing
                                    the string here too would be a second
                                    opinion about how wide the card has to be. */}
                                <text
                                  x={wedge.legend.x + swatch + 10}
                                  y={
                                    wedge.legend.y +
                                    wedge.legend.height / 2 -
                                    ((wedge.legendLines.length - 1) * PIE_LEGEND_SIZE * 1.35) / 2
                                  }
                                  dominantBaseline="central"
                                  fontSize={PIE_LEGEND_SIZE}
                                  fill={activeTheme.textColor}
                                >
                                  {wedge.legendLines.map((line, li) => (
                                    <tspan
                                      key={li}
                                      x={wedge.legend.x + swatch + 10}
                                      dy={li === 0 ? 0 : PIE_LEGEND_SIZE * 1.35}
                                    >
                                      {line}
                                    </tspan>
                                  ))}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      )}

                      {seqLayout && (
                        <g className="mermaid-preview__sequence">
                          {/* Frames first: they are the background of
                              everything inside them, and outermost first so a
                              nested alt reads as being inside its loop. */}
                          {[...seqLayout.frames]
                            .sort((a, b) => a.depth - b.depth)
                            .map((frame, fi) => (
                              <g key={"frame-" + fi}>
                                {/* Outline only, as mermaid draws it. A tinted
                                    frame washes every arrow and lifeline
                                    inside it, and a nested one washes them
                                    twice. */}
                                <rect
                                  x={frame.x}
                                  y={frame.y}
                                  width={frame.width}
                                  height={frame.height}
                                  rx={4}
                                  fill="none"
                                  stroke={activeTheme.canvasInk}
                                  strokeWidth={1.25}
                                />
                                <text
                                  x={frame.x + 8}
                                  y={frame.y + 14}
                                  fontSize={SEQ_TYPE.message}
                                  fontWeight={600}
                                  fill={activeTheme.canvasInk}
                                >
                                  {frame.label ? frame.block + " " + frame.label : frame.block}
                                </text>
                                {frame.sections.map((section, si) => (
                                  <g key={"section-" + si}>
                                    <line
                                      x1={frame.x}
                                      y1={section.y}
                                      x2={frame.x + frame.width}
                                      y2={section.y}
                                      stroke={activeTheme.canvasInk}
                                      strokeWidth={1}
                                      strokeDasharray="4 4"
                                    />
                                    <text
                                      x={frame.x + 8}
                                      y={section.y + 13}
                                      fontSize={SEQ_TYPE.message}
                                      fill={activeTheme.canvasInk}
                                    >
                                      {("else " + section.label).trim()}
                                    </text>
                                  </g>
                                ))}
                              </g>
                            ))}
                          {seqLayout.lanes.map((lane) => (
                            <line
                              key={"life-" + lane.key}
                              x1={lane.centreX}
                              y1={lane.lineTop}
                              x2={lane.centreX}
                              y2={lane.lineBottom}
                              stroke={activeTheme.canvasInk}
                              strokeWidth={1.5}
                              strokeDasharray="4 5"
                              strokeLinecap="round"
                            />
                          ))}
                          {/* Head and foot, the same box twice: mermaid names
                              the cast at both ends so a reader at the bottom of
                              a long exchange can still tell the columns apart. */}
                          {seqLayout.lanes.flatMap((lane, i) =>
                            [lane.y, lane.footY].map((top, half) => (
                            <g key={"head-" + lane.key + "-" + half}>
                              <rect
                                x={lane.x}
                                y={top}
                                width={lane.width}
                                height={lane.height}
                                /* An actor is a pill, a participant is a box --
                                   the same distinction the build makes, by the
                                   same means. */
                                rx={lane.actor ? lane.height / 2 : 8}
                                fill={
                                  activeTheme.accentFills[i % activeTheme.accentFills.length] ||
                                  activeTheme.primaryFill
                                }
                                stroke={activeTheme.primaryStroke}
                                strokeWidth={1.75}
                              />
                              {/* The lines the layout decided on, not a
                                  re-wrap: SVG cannot wrap text at all, and the
                                  box was sized for these exact breaks. */}
                              <text
                                x={lane.centreX}
                                y={
                                  top +
                                  lane.height / 2 -
                                  ((lane.lines.length - 1) * SEQ_TYPE.head * 1.35) / 2
                                }
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize={SEQ_TYPE.head}
                                fontWeight={600}
                                fill={activeTheme.textColor}
                              >
                                {lane.lines.map((line, li) => (
                                  <tspan
                                    key={li}
                                    x={lane.centreX}
                                    dy={li === 0 ? 0 : SEQ_TYPE.head * 1.35}
                                  >
                                    {line}
                                  </tspan>
                                ))}
                              </text>
                            </g>
                            ))
                          )}
                          {seqLayout.steps.map((step, i) => {
                            if (step.kind === 'note') {
                              return (
                                <g key={"note-" + i}>
                                  <rect
                                    x={step.x}
                                    y={step.y}
                                    width={step.width}
                                    height={step.height}
                                    rx={4}
                                    fill={activeTheme.clusterFill}
                                    stroke={activeTheme.clusterStroke}
                                    strokeWidth={1.25}
                                  />
                                  <text
                                    x={step.x + step.width / 2}
                                    y={
                                      step.y +
                                      step.height / 2 -
                                      ((step.lines.length - 1) * SEQ_TYPE.note * 1.35) / 2
                                    }
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fontSize={SEQ_TYPE.note}
                                    fill={activeTheme.textColor}
                                  >
                                    {step.lines.map((line, li) => (
                                      <tspan
                                        key={li}
                                        x={step.x + step.width / 2}
                                        dy={li === 0 ? 0 : SEQ_TYPE.note * 1.35}
                                      >
                                        {line}
                                      </tspan>
                                    ))}
                                  </text>
                                </g>
                              );
                            }
                            const fromLane = seqLayout.lanes.find((l) => l.key === step.from);
                            const toLane = seqLayout.lanes.find((l) => l.key === step.to);
                            if (!fromLane || !toLane) return null;
                            const dash = step.line === 'dotted' ? '6 4' : undefined;
                            /* An open head is mermaid's `->`, which genuinely
                               draws no arrowhead at all. */
                            const marker =
                              step.head === 'open' ? undefined : 'url(#mermaid-arrow-end)';
                            if (step.self) {
                              const out = SELF_REACH;
                              const x = fromLane.centreX;
                              const d = [
                                'M' + x + ' ' + step.y,
                                'L' + (x + out) + ' ' + step.y,
                                'L' + (x + out) + ' ' + (step.y + SELF_DROP),
                                'L' + x + ' ' + (step.y + SELF_DROP),
                              ].join(' ');
                              return (
                                <g key={"msg-" + i}>
                                  <path
                                    d={d}
                                    fill="none"
                                    stroke={activeTheme.connectorColor}
                                    strokeWidth={2}
                                    strokeDasharray={dash}
                                    markerEnd={marker}
                                  />
                                  {step.label && (
                                    <text
                                      x={x + out + 8}
                                      y={step.y + SELF_DROP / 2}
                                      fontSize={SEQ_TYPE.message}
                                      dominantBaseline="central"
                                      fill={activeTheme.textColor}
                                    >
                                      {step.label}
                                    </text>
                                  )}
                                </g>
                              );
                            }
                            return (
                              <g key={"msg-" + i}>
                                <line
                                  x1={fromLane.centreX}
                                  y1={step.y}
                                  x2={toLane.centreX}
                                  y2={step.y}
                                  stroke={activeTheme.connectorColor}
                                  strokeWidth={2}
                                  strokeDasharray={dash}
                                  markerEnd={marker}
                                />
                                {step.label && (
                                  <text
                                    x={(fromLane.centreX + toLane.centreX) / 2}
                                    y={step.y - 8}
                                    textAnchor="middle"
                                    fontSize={11}
                                    fill={activeTheme.textColor}
                                  >
                                    {step.label}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      )}

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
                      {graph?.edges.map((edge, i) => {
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
                      {graph?.nodes.map((node, nodeIdx) => {
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
                {ready && skippedLines.length > 0 ? (
                  <em className="mermaid-modal__status-note">
                    {' '}— previewing without{' '}
                    {skippedLines.length === 1
                      ? `line ${skippedLines[0]}`
                      : `lines ${skippedLines.join(', ')}`}
                  </em>
                ) : null}
              </>
            ) : ready ? (
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
              disabled={!ready}
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
