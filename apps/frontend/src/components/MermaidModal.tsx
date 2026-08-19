import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, AlertTriangle, Code2 } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { parseMermaid } from '../engine/diagram/mermaid';
import { layoutGraph } from '../engine/diagram/layout';
import { SHAPE_SPECS } from '../engine/diagram/mermaid';

const STARTER = `flowchart TD
    A[Start] --> B{Ready?}
    B -->|yes| C([Ship it])
    B -->|no| D[Fix it]
    D --> B`;

interface Props {
  open: boolean;
  onClose: () => void;
  /** The source to open with — a board read back as code, or nothing. */
  initialSource?: string;
  /** Insert or replace on the board. Returns nothing; the modal closes. */
  onApply: (source: string) => void;
  /** Whether applying will replace an existing diagram rather than add one. */
  replacing?: boolean;
}

/**
 * Write a flowchart in Mermaid, get real objects.
 *
 * ## Why the preview is drawn here rather than by importing the real renderer
 *
 * The preview has to answer one question — *is this the diagram I meant* — and
 * it has to answer it on every keystroke, before anything is committed to the
 * document. Building actual canvas nodes to find out would mean writing to the
 * CRDT to preview, which every collaborator would then watch flicker.
 *
 * So the preview runs the same **parse** and the same **layout** the real thing
 * runs, and draws the result as flat SVG. The two cannot disagree about
 * structure or position, because those are the parts that are shared; only the
 * paint is approximate, and paint is not what anyone is checking here.
 */
export const MermaidModal: React.FC<Props> = ({
  open,
  onClose,
  initialSource,
  onApply,
  replacing,
}) => {
  const [source, setSource] = useState(initialSource || STARTER);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useFocusTrap(open, onClose);

  // Re-seed when reopened with different source, but never while it is open —
  // that would overwrite what the user is in the middle of typing.
  useEffect(() => {
    if (open) setSource(initialSource || STARTER);
  }, [open, initialSource]);


  const { graph, error } = useMemo(() => parseMermaid(source), [source]);

  /** The preview, laid out by the same code the board will use. */
  const preview = useMemo(() => {
    if (!graph) return null;
    const sizes = new Map(
      graph.nodes.map((n) => {
        const longest = n.label.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
        const square = Boolean(SHAPE_SPECS[n.shape].square);
        const w = Math.max(96, Math.min(320, longest * 8.4 + 36));
        const h = 56;
        return [n.key, square ? { width: Math.max(w, h), height: Math.max(w, h) } : { width: w, height: h }];
      })
    );
    const placed = layoutGraph(graph, {
      originX: 0,
      originY: 0,
      sizeOf: (k) => sizes.get(k),
    });
    const at = new Map(placed.map((p) => [p.key, p]));
    const maxX = Math.max(1, ...placed.map((p) => p.x + p.width));
    const maxY = Math.max(1, ...placed.map((p) => p.y + p.height));
    return { placed, at, maxX, maxY };
  }, [graph]);

  if (!open) return null;

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;

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
          <Code2 size={16} aria-hidden />
          <h2 id="mermaid-title">{replacing ? 'Edit diagram' : 'Diagram from code'}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="mermaid-modal__body">
          <div className="mermaid-modal__editor">
            <label className="mermaid-modal__label" htmlFor="mermaid-source">
              Mermaid
            </label>
            <textarea
              id="mermaid-source"
              ref={textRef}
              className="mermaid-modal__code"
              value={source}
              spellCheck={false}
              onChange={(e) => setSource(e.target.value)}
              // Tab indents rather than leaving the field. In a code editor the
              // key means indent, and a two-line diagram is not worth losing
              // your place in to satisfy the default.
              onKeyDown={(e) => {
                if (e.key !== 'Tab') return;
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: end, value } = el;
                const next = `${value.slice(0, s)}    ${value.slice(end)}`;
                setSource(next);
                requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
              }}
            />
          </div>

          <div className="mermaid-modal__preview">
            <span className="mermaid-modal__label">Preview</span>
            <div className="mermaid-modal__stage">
              {preview && graph ? (
                <svg
                  viewBox={`-12 -12 ${preview.maxX + 24} ${preview.maxY + 24}`}
                  role="img"
                  aria-label={`${nodeCount} boxes, ${edgeCount} connections`}
                >
                  {graph.edges.map((edge, i) => {
                    const a = preview.at.get(edge.from);
                    const b = preview.at.get(edge.to);
                    if (!a || !b) return null;
                    return (
                      <line
                        key={i}
                        x1={a.x + a.width / 2}
                        y1={a.y + a.height / 2}
                        x2={b.x + b.width / 2}
                        y2={b.y + b.height / 2}
                        className="mermaid-preview__edge"
                        strokeDasharray={edge.line === 'dotted' ? '3 5' : undefined}
                        strokeWidth={edge.line === 'thick' ? 3 : 1.5}
                      />
                    );
                  })}
                  {graph.nodes.map((node) => {
                    const p = preview.at.get(node.key);
                    if (!p) return null;
                    const spec = SHAPE_SPECS[node.shape];
                    const rx =
                      spec.cornerRadius === undefined
                        ? 3
                        : Math.min(spec.cornerRadius, p.height / 2);
                    return (
                      <g key={node.key}>
                        {spec.kind === 'ellipse' ? (
                          <ellipse
                            cx={p.x + p.width / 2}
                            cy={p.y + p.height / 2}
                            rx={p.width / 2}
                            ry={p.height / 2}
                            className="mermaid-preview__node"
                          />
                        ) : spec.kind === 'polygon' ? (
                          <polygon
                            points={polygonPoints(p, spec.points ?? 4)}
                            className="mermaid-preview__node"
                          />
                        ) : (
                          <rect
                            x={p.x}
                            y={p.y}
                            width={p.width}
                            height={p.height}
                            rx={rx}
                            className="mermaid-preview__node"
                          />
                        )}
                        <text
                          x={p.x + p.width / 2}
                          y={p.y + p.height / 2}
                          className="mermaid-preview__text"
                          dominantBaseline="middle"
                          textAnchor="middle"
                        >
                          {node.label.split('\n')[0].slice(0, 22)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <p className="mermaid-modal__empty">
                  {error ?? 'Write a flowchart on the left to see it here.'}
                </p>
              )}
            </div>
          </div>
        </div>

        <footer className="mermaid-modal__foot">
          <span className={`mermaid-modal__status${error ? ' is-error' : ''}`}>
            {error ? (
              <>
                <AlertTriangle size={13} aria-hidden /> {error}
              </>
            ) : graph ? (
              <>
                <Check size={13} aria-hidden /> {nodeCount} {nodeCount === 1 ? 'box' : 'boxes'},{' '}
                {edgeCount} {edgeCount === 1 ? 'connection' : 'connections'}
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
                onApply(source);
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

/** A regular polygon inscribed in the node's box, point-up. */
function polygonPoints(
  p: { x: number; y: number; width: number; height: number },
  sides: number
): string {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const rx = p.width / 2;
  const ry = p.height / 2;
  return Array.from({ length: sides }, (_, i) => {
    // Rotated so a four-sided polygon stands on its point — which is what makes
    // it read as mermaid's decision rhombus rather than as a tilted square.
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return `${cx + Math.cos(angle) * rx},${cy + Math.sin(angle) * ry}`;
  }).join(' ');
}
