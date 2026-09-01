import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Check,
  AlertTriangle,
  Code2,
  Sparkles,
  ZoomIn,
  ZoomOut,
  Maximize,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowLeft,
  Wand2,
  Palette,
  PenTool,
} from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
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
    source: `flowchart TD
    A([Start]) --> B{Is Input Valid?}
    B -->|Yes| C[Process Request]
    B -->|No| D[Log Validation Error]
    C --> E[(Save to Database)]
    D --> F([Return 400 Bad Request])
    E --> G([Return 200 OK])`,
  },
  {
    id: 'architecture',
    name: 'Cloud Architecture',
    source: `flowchart TD
    subgraph Client ["Client Tier"]
        Web([Web App])
        Mobile([iOS / Android])
    end

    subgraph AWS_VPC ["AWS Cloud VPC"]
        ALB{{App Load Balancer}}
        
        subgraph Mesh ["K8s Microservices"]
            Gateway[API Gateway]
            Auth[Auth Service]
            Catalog[Product Catalog]
            Orders[Order Processing]
        end

        subgraph Data ["Stateful Data Tier"]
            Redis[(Redis Cache)]
            Postgres[(PostgreSQL Cluster)]
            Kafka[[Kafka Event Stream]]
        end
    end

    Web & Mobile -->|HTTPS / TLS| ALB
    ALB --> Gateway
    Gateway --> Auth
    Gateway --> Catalog & Orders
    
    Auth --> Redis
    Catalog --> Postgres
    Orders --> Postgres
    Orders --> Kafka`,
  },
  {
    id: 'oauth2',
    name: 'OAuth2 Auth Flow',
    source: `flowchart LR
    subgraph Browser ["User Browser"]
        Client([Single Page App])
    end

    subgraph AuthServer ["OAuth2 Identity Provider"]
        LoginUI[Login & Consent Screen]
        TokenEndpoint[Token Issuer /oauth/token]
    end

    subgraph ResourceServer ["Protected API"]
        APIGateway{{API Gateway}}
        Microservice[Backend Service]
    end

    Client -->|1. Redirect Authorization Code| LoginUI
    LoginUI -->|2. Return Auth Code| Client
    Client -->|3. Exchange Code & Secret| TokenEndpoint
    TokenEndpoint -->|4. Return JWT Access Token| Client
    Client -->|5. Bearer Auth Request| APIGateway
    APIGateway -->|6. Validated Request| Microservice`,
  },
  {
    id: 'gitflow',
    name: 'Git Branching Strategy',
    source: `flowchart LR
    Main([Main Production]) -->|Branch| Release[[Release Candidate]]
    Main -->|Branch| Feature1[Feature: Canvas Workers]
    Main -->|Branch| Feature2[Feature: SVG Paste]

    Feature1 & Feature2 -->|Pull Request & Code Review| PRCheck{CI Tests Pass?}
    PRCheck -->|Yes| Staging[(Merge to Staging)]
    PRCheck -->|No| Fix[Fix Tests & Lint]
    Fix --> PRCheck

    Staging -->|Tag Version| Release
    Release -->|Deploy| Main`,
  },
  {
    id: 'cicd',
    name: 'CI/CD Pipeline',
    source: `flowchart LR
    Dev([Developer Push]) --> Git{GitHub Actions Trigger}
    
    subgraph CI ["Continuous Integration"]
        Git -->|Parallel| Lint[ESLint & TypeCheck]
        Git -->|Parallel| Build[Vite Client Build]
        Git -->|Parallel| Unit[Vitest Suite]
    end
    
    Lint & Build & Unit --> Wait(((All Tests Passed?)))
    Wait -->|Yes| Image[[Docker Container Build]]
    Wait -->|No| Slack>Notify Slack Alerts]
    
    subgraph CD ["Continuous Deployment"]
        Image --> Staging[(Deploy to Staging)]
        Staging --> E2E{Playwright E2E Tests}
        E2E -->|Pass| Prod[(Deploy to Production)]
        E2E -->|Fail| Slack
    end`,
  },
  {
    id: 'state',
    name: 'State Machine',
    source: `flowchart TD
    Init(((Checkout Started))) ==> Auth{Verify Payment Method}
    
    Auth -.->|Timeout| Retry[Retry Connection]
    Retry -.-> Auth
    
    Auth -->|Declined| Failed[/Payment Declined/]
    Failed -->|Update Card Details| Auth
    
    Auth ==>|Approved| Process[Process Ledger Transaction]
    Process <--> Bank[(Bank Settlement API)]
    
    Process --> Success(((Order Confirmed)))`,
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
  const { graph, error, errorLine, skippedLines } = useMemo(
    () => parseMermaidLenient(source),
    [source]
  );
  const activeTheme = DIAGRAM_THEMES[themeId] || DIAGRAM_THEMES.indigo;

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
        style={{ maxWidth: '1060px', width: '94vw', maxHeight: '90vh' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="mermaid-modal__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Code2 size={18} style={{ color: '#6366F1' }} aria-hidden />
            <h2 id="mermaid-title" style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
              {replacing ? 'Edit Diagram (Mermaid)' : 'Diagram from Code (Mermaid)'}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {/* Template & Palette Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '8px 16px',
            background: 'var(--surface-primary)',
            borderBottom: '1px solid var(--border-divider)',
            overflowX: 'auto',
            flexWrap: 'nowrap',
          }}
        >
          {/* Templates */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 'max-content' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Sparkles size={13} /> Templates:
            </span>
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => {
                  setSource(tmpl.source);
                  setActiveTemplate(tmpl.id);
                }}
                style={{
                  fontSize: '11.5px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: activeTemplate === tmpl.id ? '1px solid var(--border-focus)' : '1px solid var(--border-divider)',
                  background: activeTemplate === tmpl.id ? 'var(--surface-active)' : 'transparent',
                  color: activeTemplate === tmpl.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: activeTemplate === tmpl.id ? 600 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {tmpl.name}
              </button>
            ))}
          </div>

          {/* Palette Themes & Style Mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 'max-content' }}>
            {/* Theme Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Palette size={13} style={{ color: 'var(--text-secondary)' }} />
              {(Object.keys(DIAGRAM_THEMES) as DiagramThemeId[]).map((tKey) => {
                const theme = DIAGRAM_THEMES[tKey];
                const isActive = themeId === tKey;
                return (
                  <button
                    key={tKey}
                    type="button"
                    title={theme.name}
                    onClick={() => setThemeId(tKey)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: isActive ? '1px solid var(--border-focus)' : '1px solid transparent',
                      background: isActive ? 'var(--surface-active)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: theme.primaryStroke,
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isActive ? 600 : 400 }}>
                      {theme.name.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ width: '1px', height: '16px', background: 'var(--border-divider)' }} />

            {/* Crisp vs Sketch Mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--surface-subtle)', padding: '2px', borderRadius: '6px' }}>
              <button
                type="button"
                onClick={() => setRenderStyle('crisp')}
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: 'none',
                  background: renderStyle === 'crisp' ? 'var(--surface-primary)' : 'transparent',
                  color: renderStyle === 'crisp' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: renderStyle === 'crisp' ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: renderStyle === 'crisp' ? 'var(--shadow-xs)' : 'none',
                }}
              >
                Crisp
              </button>
              <button
                type="button"
                onClick={() => setRenderStyle('sketch')}
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: 'none',
                  background: renderStyle === 'sketch' ? 'var(--surface-primary)' : 'transparent',
                  color: renderStyle === 'sketch' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: renderStyle === 'sketch' ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: renderStyle === 'sketch' ? 'var(--shadow-xs)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <PenTool size={10} /> Sketch
              </button>
            </div>
          </div>
        </div>

        <div className="mermaid-modal__body">
          {/* Left Editor Column */}
          <div className="mermaid-modal__editor">
            {/* Editor Sub-toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label className="mermaid-modal__label" htmlFor="mermaid-source" style={{ margin: 0 }}>
                  Mermaid Code
                </label>
                {/* Direction switcher buttons */}
                <div style={{ display: 'flex', gap: '2px', marginLeft: '6px' }}>
                  <button
                    type="button"
                    title="Layout: Top to Bottom (TD)"
                    onClick={() => handleSetDirection('TD')}
                    style={{
                      padding: '2px 4px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      border: '1px solid var(--border-divider)',
                      background: graph?.direction === 'TD' || graph?.direction === 'TB' ? 'var(--surface-active)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ArrowDown size={11} /> TD
                  </button>
                  <button
                    type="button"
                    title="Layout: Left to Right (LR)"
                    onClick={() => handleSetDirection('LR')}
                    style={{
                      padding: '2px 4px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      border: '1px solid var(--border-divider)',
                      background: graph?.direction === 'LR' ? 'var(--surface-active)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ArrowRight size={11} /> LR
                  </button>
                  <button
                    type="button"
                    title="Layout: Bottom to Top (BT)"
                    onClick={() => handleSetDirection('BT')}
                    style={{
                      padding: '2px 4px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      border: '1px solid var(--border-divider)',
                      background: graph?.direction === 'BT' ? 'var(--surface-active)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ArrowUp size={11} /> BT
                  </button>
                  <button
                    type="button"
                    title="Layout: Right to Left (RL)"
                    onClick={() => handleSetDirection('RL')}
                    style={{
                      padding: '2px 4px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      border: '1px solid var(--border-divider)',
                      background: graph?.direction === 'RL' ? 'var(--surface-active)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ArrowLeft size={11} /> RL
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={handleFormatCode}
                  title="Auto-format / prettify Mermaid source"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-divider)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <Wand2 size={11} /> Format
                </button>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  Cmd/Ctrl + Enter
                </span>
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
            <span className="mermaid-modal__label">Live Preview</span>
            <div
              className="mermaid-modal__stage"
              onPointerDown={(e) => {
                isDragging.current = true;
                lastMousePos.current = { x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!isDragging.current) return;
                const dx = e.clientX - lastMousePos.current.x;
                const dy = e.clientY - lastMousePos.current.y;
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
              onWheel={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  const delta = e.deltaY * -0.01;
                  const newScale = Math.min(Math.max(0.1, scale + delta), 4);
                  setScale(newScale);
                }
              }}
            >
              {preview && graph ? (
                <>
                  <svg
                    viewBox={`0 0 ${preview.maxX + 40} ${preview.maxY + 40}`}
                    role="img"
                    aria-label={`${nodeCount} boxes, ${edgeCount} connections`}
                    style={{ width: '100%', height: '100%', minHeight: '260px' }}
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
                                  fill="#FFFFFF"
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

                  {/* Zoom Controls Overlay */}
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      bottom: '12px',
                      right: '12px',
                      display: 'flex',
                      gap: '2px',
                      background: 'var(--surface-primary)',
                      border: '1px solid var(--border-divider)',
                      borderRadius: 'var(--radius-md)',
                      padding: '2px',
                      boxShadow: 'var(--shadow-sm)',
                      zIndex: 10,
                    }}
                  >
                    <button
                      className="btn-icon"
                      onClick={() => setScale((s) => Math.max(0.1, s - 0.2))}
                      style={{ width: '24px', height: '24px' }}
                      aria-label="Zoom Out"
                    >
                      <ZoomOut size={14} strokeWidth={1.5} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => {
                        setScale(1);
                        setPan({ x: 0, y: 0 });
                      }}
                      style={{ width: '24px', height: '24px' }}
                      aria-label="Reset Zoom"
                    >
                      <Maximize size={12} strokeWidth={1.5} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => setScale((s) => Math.min(4, s + 0.2))}
                      style={{ width: '24px', height: '24px' }}
                      aria-label="Zoom In"
                    >
                      <ZoomIn size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </>
              ) : (
                <p className="mermaid-modal__empty">
                  {error ?? 'Write a flowchart on the left to see it live here.'}
                </p>
              )}
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
              <>
                <Check size={14} aria-hidden /> {nodeCount} {nodeCount === 1 ? 'box' : 'boxes'},{' '}
                {edgeCount} {edgeCount === 1 ? 'connection' : 'connections'}
                {subgraphCount > 0 ? `, ${subgraphCount} clusters` : ''}
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

  switch (shape) {
    case 'circle':
      return (
        <ellipse
          cx={p.x + p.width / 2}
          cy={p.y + p.height / 2}
          rx={p.width / 2}
          ry={p.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'double_circle':
      return (
        <g>
          <ellipse
            cx={p.x + p.width / 2}
            cy={p.y + p.height / 2}
            rx={p.width / 2}
            ry={p.height / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <ellipse
            cx={p.x + p.width / 2}
            cy={p.y + p.height / 2}
            rx={p.width / 2 - 4}
            ry={p.height / 2 - 4}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
          />
        </g>
      );
    case 'stadium':
      return (
        <rect
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          rx={p.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'database':
      return (
        <g>
          <path
            d={`M ${p.x} ${p.y + 10} 
                A ${p.width / 2} 10 0 0 0 ${p.x + p.width} ${p.y + 10} 
                L ${p.x + p.width} ${p.y + p.height - 10} 
                A ${p.width / 2} 10 0 0 1 ${p.x} ${p.y + p.height - 10} Z`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <ellipse
            cx={p.x + p.width / 2}
            cy={p.y + 10}
            rx={p.width / 2}
            ry={9}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </g>
      );
    case 'subroutine':
      return (
        <g>
          <rect
            x={p.x}
            y={p.y}
            width={p.width}
            height={p.height}
            rx={4}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <line
            x1={p.x + 8}
            y1={p.y}
            x2={p.x + 8}
            y2={p.y + p.height}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <line
            x1={p.x + p.width - 8}
            y1={p.y}
            x2={p.x + p.width - 8}
            y2={p.y + p.height}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </g>
      );
    case 'diamond':
      return (
        <polygon
          points={polygonPoints(p, 4)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'hexagon':
      return (
        <polygon
          points={polygonPoints(p, 6)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'parallelogram':
    case 'parallelogram_inv':
      const skew = shape === 'parallelogram' ? 12 : -12;
      return (
        <polygon
          points={`${p.x + (skew > 0 ? skew : 0)},${p.y} ${p.x + p.width - (skew < 0 ? -skew : 0)},${p.y} ${p.x + p.width - (skew > 0 ? skew : 0)},${p.y + p.height} ${p.x + (skew < 0 ? -skew : 0)},${p.y + p.height}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'round':
      return (
        <rect
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          rx={8}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'rect':
    default:
      return (
        <rect
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          rx={4}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
  }
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
