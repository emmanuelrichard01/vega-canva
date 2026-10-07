/** One starter diagram offered by the diagram editor. */
export interface MermaidTemplate {
  id: string;
  name: string;
  kind: 'flow' | 'sequence' | 'pie';
  source: string;
}

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
export const MERMAID_TEMPLATES: ReadonlyArray<MermaidTemplate> = [
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

    %% Mermaid 11 named shapes. These have no bracket spelling at all, which
    %% is why the "@{ shape: ... }" form exists. Most accept several names:
    %% "doc" and "document" are the same shape, as are "tri" and "triangle".
    subgraph Named ["Named shapes (@{ shape: ... })"]
        O@{ shape: doc, label: "Document" } --> P@{ shape: win-pane, label: "Internal storage" }
        P --> Q@{ shape: delay, label: "Delay" }
        Q --> R@{ shape: manual-input, label: "Manual input" }
        R --> S@{ shape: notch-rect, label: "Card" }
        S --> T@{ shape: tri, label: "Extract" }
    end

    D --> E
    H --> I
    N --> O`,
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
