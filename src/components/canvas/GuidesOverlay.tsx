import { useRef } from "react";
import { useUIStore } from "../../store/uiStore";
import type { VectoDocument } from "../../types/svg";

interface GuidesOverlayProps {
  document: VectoDocument;
  zoom: number;
  screenToDoc: (sx: number, sy: number) => { x: number; y: number };
}

export function GuidesOverlay({ document, zoom, screenToDoc }: GuidesOverlayProps) {
  const guides = useUIStore((s) => s.guides);
  const updateGuide = useUIStore((s) => s.updateGuide);
  const removeGuide = useUIStore((s) => s.removeGuide);
  const dragId = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (guides.length === 0) return null;

  const vb = document.viewBox;
  const STROKE = 1 / zoom;
  const HIT = 7 / zoom;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragId.current) return;
    const g = guides.find((x) => x.id === dragId.current);
    if (!g) return;
    const p = screenToDoc(e.clientX, e.clientY);
    updateGuide(g.id, g.axis === "x" ? p.x : p.y);
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0"
      style={{ display: "block", pointerEvents: "none" }}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      width={vb.width * zoom}
      height={vb.height * zoom}
      onPointerMove={onMove}
      onPointerUp={() => { dragId.current = null; }}
    >
      {guides.map((g) => {
        const vertical = g.axis === "x";
        const props = vertical
          ? { x1: g.pos, y1: vb.y, x2: g.pos, y2: vb.y + vb.height }
          : { x1: vb.x, y1: g.pos, x2: vb.x + vb.width, y2: g.pos };
        return (
          <g key={g.id}>
            <line {...props} stroke="#22d3ee" strokeWidth={STROKE} strokeDasharray={`${3 / zoom} ${3 / zoom}`} />
            <line
              {...props}
              stroke="transparent"
              strokeWidth={HIT}
              style={{ pointerEvents: "all", cursor: vertical ? "ew-resize" : "ns-resize" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragId.current = g.id;
                svgRef.current?.setPointerCapture(e.pointerId);
              }}
              onDoubleClick={(e) => { e.stopPropagation(); removeGuide(g.id); }}
            />
          </g>
        );
      })}
    </svg>
  );
}
