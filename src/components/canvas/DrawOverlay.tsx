import { useCallback, useEffect, useRef, useState } from "react";
import { useUIStore } from "../../store/uiStore";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import type { VectoDocument, VectoNode, VectoNodeType } from "../../types/svg";

interface DrawOverlayProps {
  document: VectoDocument;
  zoom: number;
  screenToDoc: (sx: number, sy: number) => { x: number; y: number };
}

const FILL    = "#3b82f6";
const STROKE  = "#3b82f6";
const MIN_PX  = 4; // px — below this treat drag as a click

type Pt = { x: number; y: number };

type Preview =
  | { kind: "rect";    x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "line";    x1: number; y1: number; x2: number; y2: number }
  | { kind: "pen";     points: Pt[]; cursor: Pt }
  | null;

function uid() {
  return crypto.randomUUID().slice(0, 8);
}

function makeNode(
  tag: string,
  type: VectoNodeType,
  attrs: Record<string, string>
): VectoNode {
  return {
    id: uid(),
    type,
    tagName: tag,
    attributes: attrs,
    children: [],
    locked: false,
    visible: true,
    name: tag,
    editable: true,
  };
}

function rectFromDrag(start: Pt, end: Pt, shift: boolean) {
  let w = end.x - start.x;
  let h = end.y - start.y;
  if (shift) {
    const side = Math.min(Math.abs(w), Math.abs(h));
    w = Math.sign(w) * side;
    h = Math.sign(h) * side;
  }
  return {
    x: Math.min(start.x, start.x + w),
    y: Math.min(start.y, start.y + h),
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

function ellipseFromDrag(start: Pt, end: Pt, shift: boolean) {
  let rx = Math.abs(end.x - start.x) / 2;
  let ry = Math.abs(end.y - start.y) / 2;
  if (shift) { rx = ry = Math.min(rx, ry); }
  return { cx: (start.x + end.x) / 2, cy: (start.y + end.y) / 2, rx, ry };
}

export function DrawOverlay({ document, zoom, screenToDoc }: DrawOverlayProps) {
  const activeTool  = useUIStore((s) => s.activeTool);
  const setTool     = useUIStore((s) => s.setTool);
  const addNode     = useDocumentStore((s) => s.addNode);
  const select      = useSelectionStore((s) => s.select);

  const svgRef      = useRef<SVGSVGElement>(null);
  const dragStart   = useRef<Pt | null>(null);
  const penPoints   = useRef<Pt[]>([]);
  const [preview, setPreview] = useState<Preview>(null);

  const vb = document.viewBox;
  const sw = 1.5 / zoom;   // preview stroke width  (constant on screen)
  const da = `${4 / zoom} ${4 / zoom}`;  // preview dash array

  // ── Commit helpers ─────────────────────────────────────────────────────────

  const commit = useCallback(
    (node: VectoNode) => {
      addNode(node);
      select([node.id]);
      setTool("select");
      setPreview(null);
    },
    [addNode, select, setTool]
  );

  const commitPen = useCallback(
    (close: boolean) => {
      const pts = penPoints.current;
      if (pts.length < 2) {
        penPoints.current = [];
        setPreview(null);
        setTool("select");
        return;
      }
      let d = `M ${pts.map((p) => `${Math.round(p.x)} ${Math.round(p.y)}`).join(" L ")}`;
      if (close) d += " Z";
      commit(
        makeNode("path", "path", {
          d,
          fill: close ? FILL : "none",
          stroke: STROKE,
          "stroke-width": "2",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })
      );
      penPoints.current = [];
    },
    [commit, setTool]
  );

  // ── Keyboard (Escape / Enter) for pen ──────────────────────────────────────

  useEffect(() => {
    if (activeTool !== "pen") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        penPoints.current = [];
        setPreview(null);
        setTool("select");
      } else if (e.key === "Enter") {
        commitPen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, commitPen, setTool]);

  // ── Pointer handlers ───────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      const cur = screenToDoc(e.clientX, e.clientY);

      if (activeTool === "pen") {
        // Double-click → commit open path without adding extra point
        if (e.detail >= 2) {
          commitPen(false);
          return;
        }

        const pts = penPoints.current;

        // Click near first point → close path
        if (pts.length > 0) {
          const dist = Math.hypot(cur.x - pts[0].x, cur.y - pts[0].y);
          if (dist < 8 / zoom) {
            penPoints.current = [...pts]; // include what we have
            commitPen(true);
            return;
          }
        }

        penPoints.current = [...pts, cur];
        setPreview({ kind: "pen", points: penPoints.current, cursor: cur });
        return;
      }

      // rect / ellipse / line — start drag
      dragStart.current = cur;
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [activeTool, zoom, screenToDoc, commitPen]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const cur = screenToDoc(e.clientX, e.clientY);

      if (activeTool === "pen") {
        if (penPoints.current.length > 0) {
          setPreview({ kind: "pen", points: penPoints.current, cursor: cur });
        }
        return;
      }

      const start = dragStart.current;
      if (!start) return;

      if (activeTool === "rect") {
        const { x, y, w, h } = rectFromDrag(start, cur, e.shiftKey);
        setPreview({ kind: "rect", x, y, w, h });
      } else if (activeTool === "ellipse") {
        const { cx, cy, rx, ry } = ellipseFromDrag(start, cur, e.shiftKey);
        setPreview({ kind: "ellipse", cx, cy, rx, ry });
      } else if (activeTool === "line") {
        setPreview({ kind: "line", x1: start.x, y1: start.y, x2: cur.x, y2: cur.y });
      }
    },
    [activeTool, screenToDoc]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.stopPropagation();
      if (activeTool === "pen") return;

      const start = dragStart.current;
      dragStart.current = null;
      if (!start) return;

      const cur = screenToDoc(e.clientX, e.clientY);
      const isClick =
        Math.abs(cur.x - start.x) < MIN_PX / zoom &&
        Math.abs(cur.y - start.y) < MIN_PX / zoom;

      if (activeTool === "rect") {
        const { x, y, w, h } = isClick
          ? { x: start.x - 50, y: start.y - 50, w: 100, h: 100 }
          : rectFromDrag(start, cur, e.shiftKey);
        if (w < 1 || h < 1) { setPreview(null); return; }
        commit(
          makeNode("rect", "rect", {
            x: String(Math.round(x)),
            y: String(Math.round(y)),
            width: String(Math.round(w)),
            height: String(Math.round(h)),
            fill: FILL,
          })
        );
      } else if (activeTool === "ellipse") {
        const { cx, cy, rx, ry } = isClick
          ? { cx: start.x, cy: start.y, rx: 50, ry: 50 }
          : ellipseFromDrag(start, cur, e.shiftKey);
        if (rx < 1 || ry < 1) { setPreview(null); return; }
        const isCircle = e.shiftKey || isClick;
        const r = Math.round(Math.min(rx, ry));
        commit(
          isCircle
            ? makeNode("circle", "circle", {
                cx: String(Math.round(cx)),
                cy: String(Math.round(cy)),
                r: String(r),
                fill: FILL,
              })
            : makeNode("ellipse", "ellipse", {
                cx: String(Math.round(cx)),
                cy: String(Math.round(cy)),
                rx: String(Math.round(rx)),
                ry: String(Math.round(ry)),
                fill: FILL,
              })
        );
      } else if (activeTool === "line") {
        if (isClick) { setPreview(null); return; }
        commit(
          makeNode("line", "line", {
            x1: String(Math.round(start.x)),
            y1: String(Math.round(start.y)),
            x2: String(Math.round(cur.x)),
            y2: String(Math.round(cur.y)),
            stroke: STROKE,
            "stroke-width": "2",
            "stroke-linecap": "round",
          })
        );
      }
    },
    [activeTool, zoom, screenToDoc, commit]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <svg
      ref={svgRef}
      style={{ position: "absolute", inset: 0, overflow: "visible", cursor: "crosshair" }}
      width={vb.width * zoom}
      height={vb.height * zoom}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Transparent hit area covers the whole artboard */}
      <rect
        x={vb.x} y={vb.y}
        width={vb.width} height={vb.height}
        fill="transparent"
        style={{ pointerEvents: "all" }}
      />

      {/* Rect preview */}
      {preview?.kind === "rect" && (
        <rect
          x={preview.x} y={preview.y}
          width={preview.w} height={preview.h}
          fill={FILL} fillOpacity={0.2}
          stroke={STROKE} strokeWidth={sw} strokeDasharray={da}
        />
      )}

      {/* Ellipse preview */}
      {preview?.kind === "ellipse" && (
        preview.rx === preview.ry ? (
          <circle
            cx={preview.cx} cy={preview.cy} r={preview.rx}
            fill={FILL} fillOpacity={0.2}
            stroke={STROKE} strokeWidth={sw} strokeDasharray={da}
          />
        ) : (
          <ellipse
            cx={preview.cx} cy={preview.cy} rx={preview.rx} ry={preview.ry}
            fill={FILL} fillOpacity={0.2}
            stroke={STROKE} strokeWidth={sw} strokeDasharray={da}
          />
        )
      )}

      {/* Line preview */}
      {preview?.kind === "line" && (
        <line
          x1={preview.x1} y1={preview.y1} x2={preview.x2} y2={preview.y2}
          stroke={STROKE} strokeWidth={sw} strokeDasharray={da} strokeLinecap="round"
        />
      )}

      {/* Pen preview */}
      {preview?.kind === "pen" && (
        <>
          {preview.points.length > 1 && (
            <polyline
              points={preview.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={STROKE} strokeWidth={sw}
              strokeLinecap="round" strokeLinejoin="round"
            />
          )}
          {/* Ghost line to cursor */}
          <line
            x1={preview.points[preview.points.length - 1].x}
            y1={preview.points[preview.points.length - 1].y}
            x2={preview.cursor.x} y2={preview.cursor.y}
            stroke={STROKE} strokeWidth={sw} strokeDasharray={da} strokeLinecap="round"
          />
          {/* Anchor dots */}
          {preview.points.map((p, i) => (
            <circle
              key={i}
              cx={p.x} cy={p.y} r={3.5 / zoom}
              fill="white" stroke={STROKE} strokeWidth={1.5 / zoom}
            />
          ))}
          {/* Highlight first point as close target */}
          {preview.points.length > 1 && (
            <circle
              cx={preview.points[0].x} cy={preview.points[0].y} r={6 / zoom}
              fill="transparent" stroke={STROKE} strokeWidth={1.5 / zoom}
            />
          )}
        </>
      )}
    </svg>
  );
}
