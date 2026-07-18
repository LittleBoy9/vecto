/**
 * PathEditOverlay — interactive path node editor.
 *
 * Features:
 *  - Drag anchors (squares) to move nodes
 *  - Drag bezier handles (circles) to reshape curves
 *  - Click on a path segment → insert new anchor at that point
 *  - Double-click an anchor → toggle smooth ↔ corner node type
 *  - Smooth nodes mirror the opposite handle when one is dragged
 *  - All drag = one undo step (temporal pause/resume)
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  parsePath,
  serializePath,
  cloneContours,
  projectOnCubicBezier,
  insertNodeInContours,
} from "../../lib/pathParser";
import type { PathContour } from "../../lib/pathParser";
import { useDocumentStore, beginUndoBatch, endUndoBatch } from "../../store/documentStore";
import { usePathEditStore } from "../../store/pathEditStore";
import type { VectoDocument, VectoNode } from "../../types/svg";

// ── Helpers ───────────────────────────────────────────────────────────────────

function findVectoNode(doc: VectoDocument, id: string): VectoNode | null {
  function walk(nodes: VectoNode[]): VectoNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = walk(n.children);
      if (f) return f;
    }
    return null;
  }
  return walk(doc.nodes);
}

type DragTarget =
  | { kind: "anchor";    ci: number; ni: number }
  | { kind: "handleIn";  ci: number; ni: number }
  | { kind: "handleOut"; ci: number; ni: number };

/** Build the SVG `d` string for a single segment (for segment hit areas). */
function segmentPath(
  x1: number, y1: number,
  ho: { x: number; y: number } | null,
  hi: { x: number; y: number } | null,
  x2: number, y2: number
): string {
  if (!ho && !hi) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const cpx1 = ho ? ho.x : x1;
  const cpy1 = ho ? ho.y : y1;
  const cpx2 = hi ? hi.x : x2;
  const cpy2 = hi ? hi.y : y2;
  return `M ${x1} ${y1} C ${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x2} ${y2}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PathEditOverlayProps {
  document: VectoDocument;
  zoom: number;
  screenToDoc: (sx: number, sy: number) => { x: number; y: number };
}

export const PathEditOverlay = memo(function PathEditOverlay({
  document,
  zoom,
  screenToDoc,
}: PathEditOverlayProps) {
  const editingElementId     = usePathEditStore((s) => s.editingElementId);
  const selectedNodeIds      = usePathEditStore((s) => s.selectedNodeIds);
  const selectNodes          = usePathEditStore((s) => s.selectNodes);
  const addNodeToSelection   = usePathEditStore((s) => s.addNodeToSelection);
  const clearNodeSelection   = usePathEditStore((s) => s.clearNodeSelection);
  const updateNodeAttributes = useDocumentStore((s) => s.updateNodeAttributes);

  const [contours, setContours] = useState<PathContour[]>([]);

  // Re-parse whenever the editing element's d attribute changes
  useEffect(() => {
    if (!editingElementId) { setContours([]); return; }
    const svgNode = findVectoNode(document, editingElementId);
    const d = svgNode?.attributes?.d as string | undefined;
    if (!d) { setContours([]); return; }
    setContours(parsePath(d));
  }, [editingElementId, document]);

  // ── Drag state (refs — no setState during drag) ───────────────────────────

  const dragRef = useRef<{
    target: DragTarget;
    lastDocPos: { x: number; y: number };
    workingContours: PathContour[];
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // ── Commit helper ─────────────────────────────────────────────────────────

  const commit = useCallback(
    (c: PathContour[]) => {
      if (!editingElementId) return;
      updateNodeAttributes(editingElementId, { d: serializePath(c) });
    },
    [editingElementId, updateNodeAttributes]
  );

  // ── Handle / anchor drag ──────────────────────────────────────────────────

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>, target: DragTarget) => {
      e.stopPropagation();
      e.preventDefault();

      const anchorId = `c${target.ci}_n${target.ni}`;
      if (e.shiftKey) addNodeToSelection(anchorId);
      else selectNodes([anchorId]);

      // Whole drag = one undo entry.
      beginUndoBatch();

      dragRef.current = {
        target,
        lastDocPos: screenToDoc(e.clientX, e.clientY),
        workingContours: cloneContours(contours),
      };
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [contours, selectNodes, addNodeToSelection, screenToDoc]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current) return;

      const docPos = screenToDoc(e.clientX, e.clientY);
      const dx = docPos.x - dragRef.current.lastDocPos.x;
      const dy = docPos.y - dragRef.current.lastDocPos.y;
      dragRef.current.lastDocPos = docPos;

      const wc = dragRef.current.workingContours;
      const { kind, ci, ni } = dragRef.current.target;
      const node = wc[ci]?.nodes[ni];
      if (!node) return;

      if (kind === "anchor") {
        node.x += dx; node.y += dy;
        if (node.handleIn)  { node.handleIn.x  += dx; node.handleIn.y  += dy; }
        if (node.handleOut) { node.handleOut.x += dx; node.handleOut.y += dy; }
      } else if (kind === "handleIn") {
        if (!node.handleIn) return;
        node.handleIn.x += dx; node.handleIn.y += dy;
        if (node.type === "smooth" && node.handleOut) {
          node.handleOut.x = 2 * node.x - node.handleIn.x;
          node.handleOut.y = 2 * node.y - node.handleIn.y;
        }
      } else {
        if (!node.handleOut) return;
        node.handleOut.x += dx; node.handleOut.y += dy;
        if (node.type === "smooth" && node.handleIn) {
          node.handleIn.x = 2 * node.x - node.handleOut.x;
          node.handleIn.y = 2 * node.y - node.handleOut.y;
        }
      }

      setContours(cloneContours(wc));
      commit(wc);
    },
    [screenToDoc, commit]
  );

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    endUndoBatch();
  }, []);

  // ── Anchor double-click: toggle smooth ↔ corner ───────────────────────────

  const onAnchorDoubleClick = useCallback(
    (e: React.MouseEvent, ci: number, ni: number) => {
      e.stopPropagation();
      const wc = cloneContours(contours);
      const node = wc[ci]?.nodes[ni];
      if (!node) return;

      if (node.type === "smooth") {
        node.type = "corner";
      } else {
        node.type = "smooth";
        // Auto-compute symmetric handles if one or both are missing
        if (node.handleOut && !node.handleIn) {
          node.handleIn = {
            x: 2 * node.x - node.handleOut.x,
            y: 2 * node.y - node.handleOut.y,
          };
        } else if (node.handleIn && !node.handleOut) {
          node.handleOut = {
            x: 2 * node.x - node.handleIn.x,
            y: 2 * node.y - node.handleIn.y,
          };
        } else if (!node.handleIn && !node.handleOut) {
          // Create default small symmetric handles (tangent along x axis)
          const len = 20 / zoom;
          node.handleIn  = { x: node.x - len, y: node.y };
          node.handleOut = { x: node.x + len, y: node.y };
        } else if (node.handleIn && node.handleOut) {
          // Mirror handleOut through anchor to make truly symmetric
          node.handleOut = {
            x: 2 * node.x - node.handleIn.x,
            y: 2 * node.y - node.handleIn.y,
          };
        }
      }

      setContours(wc);
      commit(wc);
    },
    [contours, zoom, commit]
  );

  // ── Segment click: insert node ────────────────────────────────────────────

  const onSegmentClick = useCallback(
    (e: React.MouseEvent<SVGPathElement>, ci: number, segStart: number) => {
      e.stopPropagation();
      const wc = contours;
      const nodes  = wc[ci].nodes;
      const segEnd = (segStart + 1) % nodes.length;

      const p0 = { x: nodes[segStart].x, y: nodes[segStart].y };
      const p1 = nodes[segStart].handleOut ?? p0;
      const p2 = nodes[segEnd].handleIn ?? { x: nodes[segEnd].x, y: nodes[segEnd].y };
      const p3 = { x: nodes[segEnd].x, y: nodes[segEnd].y };

      const click = screenToDoc(e.clientX, e.clientY);
      const t     = projectOnCubicBezier(click, p0, p1, p2, p3);

      const newContours = insertNodeInContours(wc, ci, segStart, t);
      setContours(newContours);
      commit(newContours);
    },
    [contours, screenToDoc, commit]
  );

  // ── Background click: deselect nodes ─────────────────────────────────────

  const onOverlayPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) clearNodeSelection();
    },
    [clearNodeSelection]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (!editingElementId || contours.length === 0) return null;

  const { viewBox: vb } = document;
  const vbStr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  const ANCHOR_HALF   = 4   / zoom;
  const HANDLE_R      = 3.5 / zoom;
  const HIT_R         = 8   / zoom;
  const STROKE_W      = 1   / zoom;
  const HANDLE_LINE_W = 0.75 / zoom;
  // Invisible segment stroke width — wide enough to click easily
  const SEG_HIT_W     = 10  / zoom;

  const selectedSet = new Set(selectedNodeIds);

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={vbStr}
      width={vb.width * zoom}
      height={vb.height * zoom}
      className="absolute inset-0"
      style={{ display: "block", pointerEvents: "none" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={onOverlayPointerDown}
    >
      {contours.map((contour, ci) => {
        const { nodes, closed } = contour;
        const segCount = closed ? nodes.length : nodes.length - 1;

        return (
          <g key={ci}>
            {/* ── Invisible segment hit areas (click to insert) ─────── */}
            {Array.from({ length: segCount }, (_, si) => {
              const segStart = si;
              const segEnd   = (si + 1) % nodes.length;
              const a = nodes[segStart];
              const b = nodes[segEnd];
              const d = segmentPath(a.x, a.y, a.handleOut, b.handleIn, b.x, b.y);
              return (
                <path
                  key={`seg-${si}`}
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={SEG_HIT_W}
                  style={{ pointerEvents: "all", cursor: "cell" }}
                  onClick={(e) => onSegmentClick(e, ci, segStart)}
                />
              );
            })}

            {/* ── Per-node: handle lines, handle circles, anchor square ─ */}
            {nodes.map((node, ni) => {
              const isSelected = selectedSet.has(node.id);
              return (
                <g key={node.id}>
                  {/* Handle lines */}
                  {node.handleIn && (
                    <line
                      x1={node.x} y1={node.y}
                      x2={node.handleIn.x} y2={node.handleIn.y}
                      stroke="#0ea5e9" strokeWidth={HANDLE_LINE_W} strokeOpacity={0.5}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  {node.handleOut && (
                    <line
                      x1={node.x} y1={node.y}
                      x2={node.handleOut.x} y2={node.handleOut.y}
                      stroke="#0ea5e9" strokeWidth={HANDLE_LINE_W} strokeOpacity={0.5}
                      style={{ pointerEvents: "none" }}
                    />
                  )}

                  {/* handleIn circle */}
                  {node.handleIn && (
                    <g style={{ pointerEvents: "all", cursor: "crosshair" }}>
                      <circle cx={node.handleIn.x} cy={node.handleIn.y} r={HIT_R}
                        fill="transparent"
                        onPointerDown={(e) => onHandlePointerDown(e, { kind: "handleIn", ci, ni })}
                      />
                      <circle cx={node.handleIn.x} cy={node.handleIn.y} r={HANDLE_R}
                        fill="#0ea5e9" stroke="#fff" strokeWidth={STROKE_W * 0.8}
                        style={{ pointerEvents: "none" }}
                      />
                    </g>
                  )}

                  {/* handleOut circle */}
                  {node.handleOut && (
                    <g style={{ pointerEvents: "all", cursor: "crosshair" }}>
                      <circle cx={node.handleOut.x} cy={node.handleOut.y} r={HIT_R}
                        fill="transparent"
                        onPointerDown={(e) => onHandlePointerDown(e, { kind: "handleOut", ci, ni })}
                      />
                      <circle cx={node.handleOut.x} cy={node.handleOut.y} r={HANDLE_R}
                        fill="#0ea5e9" stroke="#fff" strokeWidth={STROKE_W * 0.8}
                        style={{ pointerEvents: "none" }}
                      />
                    </g>
                  )}

                  {/* Anchor square */}
                  <g style={{ pointerEvents: "all", cursor: "move" }}>
                    <rect
                      x={node.x - HIT_R} y={node.y - HIT_R}
                      width={HIT_R * 2} height={HIT_R * 2}
                      fill="transparent"
                      onPointerDown={(e) => onHandlePointerDown(e, { kind: "anchor", ci, ni })}
                      onDoubleClick={(e) => onAnchorDoubleClick(e, ci, ni)}
                    />
                    {/* Diamond for smooth, square for corner */}
                    {node.type === "smooth" ? (
                      <rect
                        x={node.x - ANCHOR_HALF} y={node.y - ANCHOR_HALF}
                        width={ANCHOR_HALF * 2} height={ANCHOR_HALF * 2}
                        fill={isSelected ? "#0ea5e9" : "#1e1e1e"}
                        stroke="#0ea5e9" strokeWidth={STROKE_W}
                        transform={`rotate(45, ${node.x}, ${node.y})`}
                        style={{ pointerEvents: "none" }}
                      />
                    ) : (
                      <rect
                        x={node.x - ANCHOR_HALF} y={node.y - ANCHOR_HALF}
                        width={ANCHOR_HALF * 2} height={ANCHOR_HALF * 2}
                        fill={isSelected ? "#0ea5e9" : "#1e1e1e"}
                        stroke="#0ea5e9" strokeWidth={STROKE_W}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
});
