import { memo, useEffect, useState } from "react";
import { useSelectionStore } from "../../store/selectionStore";
import { canvasRegistry } from "../../lib/canvasRegistry";
import type { BoundingBox, VectoDocument } from "../../types/svg";

interface SelectionRect extends BoundingBox {
  id: string;
}

interface SelectionOverlayProps {
  document: VectoDocument;
  zoom: number;
}

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

/**
 * Renders two layers of visual feedback:
 *  1. Hover outline — dashed, shown when hoveredId is set and not already selected
 *  2. Selection rects — solid with corner handles, shown for all selectedIds
 *
 * Both use getBBox() on registered DOM elements so they are always accurate
 * regardless of transforms. Neither causes a React re-render during pan/zoom.
 */
export const SelectionOverlay = memo(function SelectionOverlay({
  document,
  zoom,
}: SelectionOverlayProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hoveredId = useSelectionStore((s) => s.hoveredId);

  const [selectionRects, setSelectionRects] = useState<SelectionRect[]>([]);
  const [hoverRect, setHoverRect] = useState<BoundingBox | null>(null);

  // Recompute selection rects when selection changes
  useEffect(() => {
    const next: SelectionRect[] = [];
    for (const id of selectedIds) {
      const b = getBBoxForId(id);
      if (b) next.push({ id, ...b });
    }
    setSelectionRects(next);
  }, [selectedIds]);

  // Recompute hover rect when hovered element changes
  useEffect(() => {
    if (!hoveredId || selectedIds.includes(hoveredId)) {
      // Don't show hover outline if the element is already selected
      setHoverRect(null);
      return;
    }
    setHoverRect(getBBoxForId(hoveredId));
  }, [hoveredId, selectedIds]);

  const nothing = selectionRects.length === 0 && !hoverRect;
  if (nothing) return null;

  const { viewBox: vb } = document;
  const vbStr = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
  // PAD and handle size are in SVG document units. Dividing by zoom keeps them
  // a consistent 3px / 6px on screen regardless of zoom level.
  const PAD = 3 / zoom;
  const HANDLE = 6 / zoom;
  const STROKE = 1 / zoom;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={vbStr}
      width={vb.width * zoom}
      height={vb.height * zoom}
      className="absolute inset-0 pointer-events-none"
      style={{ display: "block" }}
    >
      {/* ── Hover outline (dashed, no handles) ─────────────────────────── */}
      {hoverRect && (
        <rect
          x={hoverRect.x - PAD}
          y={hoverRect.y - PAD}
          width={hoverRect.width + PAD * 2}
          height={hoverRect.height + PAD * 2}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={STROKE}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          strokeOpacity="0.6"
        />
      )}

      {/* ── Selection rects (solid + corner handles) ───────────────────── */}
      {selectionRects.map(({ id, x, y, width, height }) => (
        <g key={id}>
          <rect
            x={x - PAD}
            y={y - PAD}
            width={width + PAD * 2}
            height={height + PAD * 2}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth={STROKE}
          />
          {[
            [x - PAD, y - PAD],
            [x + width + PAD, y - PAD],
            [x - PAD, y + height + PAD],
            [x + width + PAD, y + height + PAD],
          ].map(([hx, hy], i) => (
            <rect
              key={i}
              x={hx - HANDLE / 2}
              y={hy - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              fill="#0ea5e9"
              stroke="#fff"
              strokeWidth={STROKE * 0.8}
            />
          ))}
        </g>
      ))}
    </svg>
  );
});
