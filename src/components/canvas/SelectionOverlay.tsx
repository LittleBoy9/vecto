/**
 * SelectionOverlay — selection feedback + interactive move/resize.
 *
 * Renders:
 *  1. Hover outline (dashed) — when hovering a non-selected element
 *  2. Selection borders (solid) — individual bbox for each selected element
 *  3. Union bbox fill rect — drag to MOVE all selected elements
 *  4. Corner handles — drag to RESIZE (scales around the opposite corner)
 *
 * Pointer model:
 *  - SVG itself: pointer-events:none — never intercepts casual clicks
 *  - Fill rect + corner handles: pointer-events:all — opt-in for drag
 *  - Captured events bubble up to the SVG's onPointerMove/onPointerUp
 *
 * Transform strategy (move):
 *   prepend translate(dx dy) to original transform — works universally
 *   for any existing transform (rotate, scale, matrix, etc.)
 *
 * Transform strategy (resize):
 *   translate(pivot) scale(sx sy) translate(-pivot) original
 *   where pivot = the corner opposite to the dragged handle
 *
 * Undo: temporal.pause() on drag start, resume() on pointerup
 *   → entire drag = one undo step.
 */

import { memo, useCallback, useRef } from "react";
import { useSelectionStore } from "../../store/selectionStore";
import { useDocumentStore } from "../../store/documentStore";
import { canvasRegistry } from "../../lib/canvasRegistry";
import type { BoundingBox, VectoDocument, VectoNode } from "../../types/svg";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBBoxForId(id: string): BoundingBox | null {
  const el = canvasRegistry.get(id);
  if (!el) return null;
  try {
    const b = el.getBBox();
    return b.width > 0 || b.height > 0 ? b : null;
  } catch {
    return null;
  }
}

function unionBBox(ids: string[]): BoundingBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const id of ids) {
    const b = getBBoxForId(id);
    if (!b) continue;
    found = true;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

function fmt(n: number) { return parseFloat(n.toFixed(4)).toString(); }

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

// Resize handle metadata: [corner index] → cursor + which corner is PIVOT
const RESIZE_HANDLES = [
  { cursor: "nw-resize", pivotIdx: 3 }, // top-left dragged → bottom-right is pivot
  { cursor: "ne-resize", pivotIdx: 2 }, // top-right → bottom-left pivot
  { cursor: "sw-resize", pivotIdx: 1 }, // bottom-left → top-right pivot
  { cursor: "se-resize", pivotIdx: 0 }, // bottom-right → top-left pivot
];

type DragMode = "move" | "resize-0" | "resize-1" | "resize-2" | "resize-3";

// ── Component ─────────────────────────────────────────────────────────────────

interface SelectionOverlayProps {
  document: VectoDocument;
  zoom: number;
  screenToDoc: (sx: number, sy: number) => { x: number; y: number };
}

export const SelectionOverlay = memo(function SelectionOverlay({
  document,
  zoom,
  screenToDoc,
}: SelectionOverlayProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hoveredId   = useSelectionStore((s) => s.hoveredId);
  const updateNodeAttributes = useDocumentStore((s) => s.updateNodeAttributes);

  // Drag state — all in refs, no setState during drag
  const dragRef = useRef<{
    mode: DragMode;
    startDocPos: { x: number; y: number };
    originalTransforms: Record<string, string>;
    originalBBox: BoundingBox;
    // corners at drag-start: [tl, tr, bl, br]
    corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // ── Compute bboxes synchronously every render (stays live during drag) ────

  const selectionRects = selectedIds
    .map((id) => { const b = getBBoxForId(id); return b ? { id, ...b } : null; })
    .filter(Boolean) as (BoundingBox & { id: string })[];

  const hoverRect =
    hoveredId && !selectedIds.includes(hoveredId) ? getBBoxForId(hoveredId) : null;

  const union = selectedIds.length > 0 ? unionBBox(selectedIds) : null;

  // ── Drag start helpers ────────────────────────────────────────────────────

  const beginDrag = useCallback(
    (e: React.PointerEvent<SVGElement>, mode: DragMode) => {
      e.stopPropagation();
      e.preventDefault();

      const ob = unionBBox(selectedIds);
      if (!ob) return;

      const originalTransforms: Record<string, string> = {};
      for (const id of selectedIds) {
        const n = findVectoNode(document, id);
        originalTransforms[id] = n?.attributes?.transform ?? "";
      }

      const PAD = 3 / zoom;
      dragRef.current = {
        mode,
        startDocPos: screenToDoc(e.clientX, e.clientY),
        originalTransforms,
        originalBBox: ob,
        corners: [
          { x: ob.x - PAD,            y: ob.y - PAD },             // 0 tl
          { x: ob.x + ob.width + PAD, y: ob.y - PAD },             // 1 tr
          { x: ob.x - PAD,            y: ob.y + ob.height + PAD }, // 2 bl
          { x: ob.x + ob.width + PAD, y: ob.y + ob.height + PAD }, // 3 br
        ],
      };

      // Capture on the element that received pointerdown so move/up bubble to SVG
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);

      // Snapshot pre-drag state into history BEFORE pausing so this drag
      // becomes its own undo entry (resume() alone doesn't create one).
      const { pastStates } = useDocumentStore.temporal.getState();
      useDocumentStore.temporal.setState({
        pastStates: [...pastStates, { document: useDocumentStore.getState().document }],
        futureStates: [],
      });
      useDocumentStore.temporal.getState().pause();
    },
    [selectedIds, document, zoom, screenToDoc]
  );

  // ── Pointer move ──────────────────────────────────────────────────────────

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const dr = dragRef.current;
      if (!dr) return;

      const docPos = screenToDoc(e.clientX, e.clientY);
      const dx = docPos.x - dr.startDocPos.x;
      const dy = docPos.y - dr.startDocPos.y;

      if (dr.mode === "move") {
        for (const id of selectedIds) {
          const orig = dr.originalTransforms[id];
          const t = `translate(${fmt(dx)} ${fmt(dy)})${orig ? " " + orig : ""}`;
          updateNodeAttributes(id, { transform: t });
        }
        return;
      }

      // Resize
      const handleIdx = parseInt(dr.mode.split("-")[1]);
      const pivotIdx  = RESIZE_HANDLES[handleIdx].pivotIdx;
      const pivot     = dr.corners[pivotIdx];
      const ob        = dr.originalBBox;

      // Dragged corner = original corner + delta
      const dragged = { x: dr.corners[handleIdx].x + dx, y: dr.corners[handleIdx].y + dy };

      const newW = Math.max(Math.abs(dragged.x - pivot.x), 4 / zoom);
      const newH = Math.max(Math.abs(dragged.y - pivot.y), 4 / zoom);
      const sx   = newW / ob.width;
      const sy   = newH / ob.height;

      for (const id of selectedIds) {
        const orig = dr.originalTransforms[id];
        const t = `translate(${fmt(pivot.x)} ${fmt(pivot.y)}) scale(${fmt(sx)} ${fmt(sy)}) translate(${fmt(-pivot.x)} ${fmt(-pivot.y)})${orig ? " " + orig : ""}`;
        updateNodeAttributes(id, { transform: t });
      }
    },
    [selectedIds, updateNodeAttributes, screenToDoc, zoom]
  );

  // ── Pointer up: consolidate transform to single matrix ───────────────────

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;

    // Consolidate compound transforms into a single matrix per element
    for (const id of selectedIds) {
      const el = canvasRegistry.get(id) as SVGGraphicsElement | undefined;
      if (!el) continue;
      try {
        const consolidated = el.transform.baseVal.consolidate();
        if (!consolidated) {
          updateNodeAttributes(id, { transform: "" });
          continue;
        }
        const m = consolidated.matrix;
        updateNodeAttributes(id, {
          transform: `matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})`,
        });
      } catch { /* ignore */ }
    }

    useDocumentStore.temporal.getState().resume();
  }, [selectedIds, updateNodeAttributes]);

  // ── Render ────────────────────────────────────────────────────────────────

  const nothing = selectionRects.length === 0 && !hoverRect;
  if (nothing) return null;

  const { viewBox: vb } = document;
  const vbStr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
  const PAD    = 3 / zoom;
  const HANDLE = 6 / zoom;
  const STROKE = 1 / zoom;

  // Corner positions for the union bbox (used for resize handles + move hit)
  const ub = union;
  const corners = ub
    ? ([
        [ub.x - PAD,               ub.y - PAD],
        [ub.x + ub.width + PAD,    ub.y - PAD],
        [ub.x - PAD,               ub.y + ub.height + PAD],
        [ub.x + ub.width + PAD,    ub.y + ub.height + PAD],
      ] as [number, number][])
    : [];

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
    >
      {/* ── Hover outline ─────────────────────────────────────────────── */}
      {hoverRect && (
        <rect
          x={hoverRect.x - PAD} y={hoverRect.y - PAD}
          width={hoverRect.width + PAD * 2} height={hoverRect.height + PAD * 2}
          fill="none" stroke="#0ea5e9" strokeWidth={STROKE}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`} strokeOpacity="0.6"
        />
      )}

      {/* ── Individual selection borders ──────────────────────────────── */}
      {selectionRects.map(({ id, x, y, width, height }) => (
        <rect
          key={id}
          x={x - PAD} y={y - PAD}
          width={width + PAD * 2} height={height + PAD * 2}
          fill="none" stroke="#0ea5e9" strokeWidth={STROKE}
        />
      ))}

      {/* ── Union bbox: transparent fill to drag-move ─────────────────── */}
      {ub && (
        <rect
          x={ub.x - PAD} y={ub.y - PAD}
          width={ub.width + PAD * 2} height={ub.height + PAD * 2}
          fill="transparent"
          style={{ pointerEvents: "all", cursor: "move" }}
          onPointerDown={(e) => beginDrag(e, "move")}
        />
      )}

      {/* ── Corner resize handles ──────────────────────────────────────── */}
      {corners.map(([hx, hy], i) => (
        <rect
          key={i}
          x={hx - HANDLE / 2} y={hy - HANDLE / 2}
          width={HANDLE} height={HANDLE}
          fill="#0ea5e9" stroke="#fff" strokeWidth={STROKE * 0.8}
          style={{ pointerEvents: "all", cursor: RESIZE_HANDLES[i].cursor }}
          onPointerDown={(e) => beginDrag(e, `resize-${i}` as DragMode)}
        />
      ))}
    </svg>
  );
});
