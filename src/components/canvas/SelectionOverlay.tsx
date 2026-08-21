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

import { memo, useCallback, useRef, useState } from "react";
import { useSelectionStore } from "../../store/selectionStore";
import { useDocumentStore, beginUndoBatch, endUndoBatch } from "../../store/documentStore";
import { useUIStore } from "../../store/uiStore";
import { canvasRegistry, nodeIdForElement } from "../../lib/canvasRegistry";
import { getDocBBox as getBBoxForId, unionDocBBox as unionBBox } from "../../lib/bbox";
import type { BoundingBox, VectoDocument, VectoNode } from "../../types/svg";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return parseFloat(n.toFixed(4)).toString(); }

/**
 * Top-most *selectable* canvas node under a screen point. Walks the full hit
 * stack so the selection move-rect (and any overlay chrome) is skipped in favour
 * of the real element beneath it — this is what lets you click an element that
 * lies inside the current selection's bounding box.
 *
 * Locked and hidden nodes are skipped: SvgNode's own pointerdown respects the
 * lock, but this path bypasses it, so click-through could select a locked
 * element that is not clickable anywhere else.
 */
function topNodeUnderPoint(
  doc: VectoDocument,
  clientX: number,
  clientY: number
): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = nodeIdForElement(el);
    if (!id) continue;
    const node = findVectoNode(doc, id);
    if (node && (node.locked || !node.visible)) continue;
    return id;
  }
  return null;
}

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

type DragMode = "move" | "rotate" | "resize-0" | "resize-1" | "resize-2" | "resize-3";

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
  const select         = useSelectionStore((s) => s.select);
  const addToSelection = useSelectionStore((s) => s.addToSelection);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const updateNodeAttributes = useDocumentStore((s) => s.updateNodeAttributes);

  // Drag state — all in refs, no setState during drag
  const dragRef = useRef<{
    mode: DragMode;
    startDocPos: { x: number; y: number };
    startClient: { x: number; y: number };
    moved: boolean;          // crossed the click→drag threshold yet?
    batchStarted: boolean;   // opened an undo batch yet?
    shiftKey: boolean;
    originalTransforms: Record<string, string>;
    originalBBox: BoundingBox;
    // candidate snap lines (edges + centers of other elements + artboard)
    snapX: number[];
    snapY: number[];
    // corners at drag-start: [tl, tr, bl, br]
    corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  } | null>(null);

  // Smart-guide lines shown during a move-drag.
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

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

      // Snap targets: edges + centers of every other top-level node, plus artboard.
      const selSet = new Set(selectedIds);
      const snapX: number[] = [];
      const snapY: number[] = [];
      for (const node of document.nodes) {
        if (selSet.has(node.id)) continue;
        const bb = getBBoxForId(node.id);
        if (!bb) continue;
        snapX.push(bb.x, bb.x + bb.width / 2, bb.x + bb.width);
        snapY.push(bb.y, bb.y + bb.height / 2, bb.y + bb.height);
      }
      const avb = document.viewBox;
      snapX.push(avb.x, avb.x + avb.width / 2, avb.x + avb.width);
      snapY.push(avb.y, avb.y + avb.height / 2, avb.y + avb.height);

      // Ruler guides are snap targets too.
      for (const g of useUIStore.getState().guides) {
        if (g.axis === "x") snapX.push(g.pos);
        else snapY.push(g.pos);
      }

      const PAD = 3 / zoom;
      dragRef.current = {
        mode,
        startDocPos: screenToDoc(e.clientX, e.clientY),
        startClient: { x: e.clientX, y: e.clientY },
        moved: false,
        batchStarted: false,
        shiftKey: e.shiftKey,
        originalTransforms,
        originalBBox: ob,
        snapX,
        snapY,
        corners: [
          { x: ob.x - PAD,            y: ob.y - PAD },             // 0 tl
          { x: ob.x + ob.width + PAD, y: ob.y - PAD },             // 1 tr
          { x: ob.x - PAD,            y: ob.y + ob.height + PAD }, // 2 bl
          { x: ob.x + ob.width + PAD, y: ob.y + ob.height + PAD }, // 3 br
        ],
      };

      // Capture on the element that received pointerdown so move/up bubble to SVG
      (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);

      // Undo batch is deferred to the first real movement (onPointerMove); a
      // plain click on the move-rect reselects rather than logging an empty step.
    },
    [selectedIds, document, zoom, screenToDoc]
  );

  // ── Pointer move ──────────────────────────────────────────────────────────

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const dr = dragRef.current;
      if (!dr) return;

      // Distinguish a click from a drag: ignore sub-threshold jitter, and open
      // the undo batch only once a real drag begins.
      if (!dr.moved) {
        if (Math.hypot(e.clientX - dr.startClient.x, e.clientY - dr.startClient.y) < 4) {
          return;
        }
        dr.moved = true;
        beginUndoBatch();
        dr.batchStarted = true;
      }

      const docPos = screenToDoc(e.clientX, e.clientY);
      const dx = docPos.x - dr.startDocPos.x;
      const dy = docPos.y - dr.startDocPos.y;

      if (dr.mode === "move") {
        // Snap the moved bbox's edges/centers to nearby targets (Alt bypasses).
        let sdx = dx, sdy = dy;
        let gx: number | null = null, gy: number | null = null;
        if (!e.altKey) {
          const ob = dr.originalBBox;
          const THRESH = 6 / zoom;
          const xCand = [ob.x + dx, ob.x + dx + ob.width / 2, ob.x + dx + ob.width];
          let bestX = THRESH;
          for (const c of xCand) for (const t of dr.snapX) {
            const d2 = Math.abs(c - t);
            if (d2 < bestX) { bestX = d2; sdx = dx + (t - c); gx = t; }
          }
          const yCand = [ob.y + dy, ob.y + dy + ob.height / 2, ob.y + dy + ob.height];
          let bestY = THRESH;
          for (const c of yCand) for (const t of dr.snapY) {
            const d2 = Math.abs(c - t);
            if (d2 < bestY) { bestY = d2; sdy = dy + (t - c); gy = t; }
          }
        }
        for (const id of selectedIds) {
          const orig = dr.originalTransforms[id];
          const t = `translate(${fmt(sdx)} ${fmt(sdy)})${orig ? " " + orig : ""}`;
          updateNodeAttributes(id, { transform: t });
        }
        setGuides({ x: gx, y: gy });
        return;
      }

      if (dr.mode === "rotate") {
        const ob = dr.originalBBox;
        const cx = ob.x + ob.width / 2;
        const cy = ob.y + ob.height / 2;
        const a0 = Math.atan2(dr.startDocPos.y - cy, dr.startDocPos.x - cx);
        const a1 = Math.atan2(docPos.y - cy, docPos.x - cx);
        let deg = ((a1 - a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15; // snap to 15°
        for (const id of selectedIds) {
          const orig = dr.originalTransforms[id];
          const t = `rotate(${fmt(deg)} ${fmt(cx)} ${fmt(cy)})${orig ? " " + orig : ""}`;
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

  // ── Pointer up: reselect (click) or consolidate transform (drag) ─────────

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const dr = dragRef.current;
    if (!dr) return;
    dragRef.current = null;
    setGuides({ x: null, y: null });

    if (!dr.moved) {
      // It was a click, not a drag. For the move-rect body, fall through to the
      // element under the cursor so elements *inside* the selection bbox can be
      // picked. (Handle clicks with no drag do nothing.)
      if (dr.mode === "move") {
        const id = topNodeUnderPoint(document, e.clientX, e.clientY);
        if (id) {
          if (dr.shiftKey) addToSelection(id);
          else select([id]);
        } else {
          clearSelection();
        }
      }
      return;
    }

    // A real drag: consolidate compound transforms into a single matrix.
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

    if (dr.batchStarted) endUndoBatch();
  }, [document, selectedIds, updateNodeAttributes, select, addToSelection, clearSelection]);

  /**
   * An interrupted drag (pointercancel, or capture stolen) never reaches
   * onPointerUp. Without this the open undo batch stayed open for the rest of
   * the session — silently disabling undo — and dragRef stayed populated, so
   * the next pointer move resumed dragging from stale state.
   */
  const onPointerCancel = useCallback(() => {
    const dr = dragRef.current;
    if (!dr) return;
    dragRef.current = null;
    setGuides({ x: null, y: null });
    if (dr.batchStarted) endUndoBatch();
  }, []);

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
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
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

      {/* ── Smart guides (snap alignment lines) ────────────────────────── */}
      {guides.x !== null && (
        <line
          x1={guides.x} y1={vb.y} x2={guides.x} y2={vb.y + vb.height}
          stroke="#ec4899" strokeWidth={STROKE} style={{ pointerEvents: "none" }}
        />
      )}
      {guides.y !== null && (
        <line
          x1={vb.x} y1={guides.y} x2={vb.x + vb.width} y2={guides.y}
          stroke="#ec4899" strokeWidth={STROKE} style={{ pointerEvents: "none" }}
        />
      )}

      {/* ── Rotate handle (above top-center) ───────────────────────────── */}
      {ub && (
        <>
          <line
            x1={ub.x + ub.width / 2} y1={ub.y - PAD}
            x2={ub.x + ub.width / 2} y2={ub.y - PAD - 24 / zoom}
            stroke="#0ea5e9" strokeWidth={STROKE}
          />
          <circle
            cx={ub.x + ub.width / 2} cy={ub.y - PAD - 24 / zoom}
            r={HANDLE * 0.7}
            fill="#1e1e1e" stroke="#0ea5e9" strokeWidth={STROKE}
            style={{ pointerEvents: "all", cursor: "grab" }}
            onPointerDown={(e) => beginDrag(e, "rotate")}
          />
        </>
      )}
    </svg>
  );
});
