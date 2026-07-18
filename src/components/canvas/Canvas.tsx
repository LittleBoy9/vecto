import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasManager } from "./CanvasManager";
import { SvgDocument } from "./SvgDocument";
import { SelectionOverlay } from "./SelectionOverlay";
import { PathEditOverlay } from "./PathEditOverlay";
import { DrawOverlay } from "./DrawOverlay";
import { Rulers, type RulersHandle } from "./Rulers";
import { GuidesOverlay } from "./GuidesOverlay";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore } from "../../store/uiStore";
import { usePathEditStore } from "../../store/pathEditStore";
import { useThemeStore } from "../../store/themeStore";
import { getDocBBox, unionDocBBox, rectsIntersect } from "../../lib/bbox";
import { setCanvasController } from "../../lib/canvasController";
import { nodeIdAtPoint } from "../../lib/canvasRegistry";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { selectionContextItems } from "../../lib/editActions";
import type { BoundingBox, VectoDocument } from "../../types/svg";

const DRAW_TOOLS = new Set(["rect", "ellipse", "line", "pen", "text"]);

function blankDocument(): VectoDocument {
  return {
    id: crypto.randomUUID(),
    viewBox: { x: 0, y: 0, width: 800, height: 600 },
    width: "800",
    height: "600",
    nodes: [],
  };
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<CanvasManager | null>(null);
  const rulersRef = useRef<RulersHandle | null>(null);

  // Track panning state in refs — no React state, no re-renders during drag
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  // Marquee (rubber-band) select state
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeShiftRef = useRef(false);
  const [marquee, setMarquee] = useState<BoundingBox | null>(null);

  const document = useDocumentStore((s) => s.document);
  const setDocument = useDocumentStore((s) => s.setDocument);
  const activeTool = useUIStore((s) => s.activeTool);
  const zoom = useUIStore((s) => s.zoom);
  const rulersVisible = useUIStore((s) => s.rulersVisible);
  const theme = useThemeStore((s) => s.theme);
  const setTransform = useUIStore((s) => s.setTransform);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const select = useSelectionStore((s) => s.select);
  const addToSelection = useSelectionStore((s) => s.addToSelection);
  const stopEditing = usePathEditStore((s) => s.stopEditing);

  // Auto-create a blank document when a drawing tool is activated with nothing open
  useEffect(() => {
    if (DRAW_TOOLS.has(activeTool) && !document) {
      setDocument(blankDocument());
    }
  }, [activeTool, document, setDocument]);

  // Stable screenToDoc callback threaded into PathEditOverlay
  const screenToDoc = useCallback(
    (sx: number, sy: number) =>
      managerRef.current?.screenToDoc(sx, sy) ?? { x: sx, y: sy },
    []
  );

  // ── Create / destroy CanvasManager ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !viewportRef.current) return;
    const mgr = new CanvasManager(containerRef.current, viewportRef.current, {
      onTransformCommit: setTransform,
      onViewportChange: (z, px, py) => rulersRef.current?.draw(z, px, py),
    });
    managerRef.current = mgr;
    return () => mgr.destroy();
  }, [setTransform]);

  // Keep rulers in sync on zoom-commit / document load / toggle.
  useEffect(() => {
    const { zoom: z, panX, panY } = useUIStore.getState();
    rulersRef.current?.draw(z, panX, panY);
  }, [zoom, document?.id, rulersVisible, theme]);

  // Zoom / fit helpers (used by the zoom control + the global keyboard hook).
  const setZoom = useCallback((z: number) => {
    const t = managerRef.current?.zoomTo(z);
    if (t) setTransform(t.zoom, t.panX, t.panY);
  }, [setTransform]);

  const fitToView = useCallback(() => {
    const doc = useDocumentStore.getState().document;
    const mgr = managerRef.current;
    if (!doc || !mgr) return;
    const t = mgr.fitToView(doc.viewBox.width, doc.viewBox.height);
    setTransform(t.zoom, t.panX, t.panY);
  }, [setTransform]);

  const zoomToSelection = useCallback(() => {
    const mgr = managerRef.current;
    if (!mgr) return;
    const sel = useSelectionStore.getState().selectedIds;
    const box = sel.length ? unionDocBBox(sel) : null;
    if (!box) { fitToView(); return; }
    const pad = Math.max(box.width, box.height) * 0.1 + 1;
    const t = mgr.fitRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2, 4);
    setTransform(t.zoom, t.panX, t.panY);
  }, [setTransform, fitToView]);

  // Expose fit / zoom-to-selection to the global keyboard hook.
  useEffect(() => {
    setCanvasController({ fitToView, zoomToSelection });
    return () => setCanvasController(null);
  }, [fitToView, zoomToSelection]);

  const openZoomMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    useContextMenuStore.getState().openMenu(r.right - 170, r.top, [
      { label: "Zoom to fit", shortcut: "⇧1", onClick: fitToView },
      { label: "Zoom to selection", shortcut: "⇧2", onClick: zoomToSelection },
      { separator: true },
      { label: "50%", onClick: () => setZoom(0.5) },
      { label: "100%", onClick: () => setZoom(1) },
      { label: "200%", onClick: () => setZoom(2) },
    ]);
  }, [fitToView, zoomToSelection, setZoom]);

  // ── Fit view when a new document loads ──────────────────────────────────────
  useEffect(() => {
    if (!document || !managerRef.current) return;
    // Small delay to let the SVG render so the container has its size
    const id = setTimeout(() => {
      const t = managerRef.current!.fitToView(
        document.viewBox.width,
        document.viewBox.height
      );
      setTransform(t.zoom, t.panX, t.panY);
    }, 50);
    return () => clearTimeout(id);
  }, [document?.id, setTransform]);

  // ── Pointer handlers (select / pan tool) ────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const mgr = managerRef.current;
      if (!mgr) return;

      // Drawing tools capture events in DrawOverlay — skip Canvas handler
      if (DRAW_TOOLS.has(activeTool)) return;

      const isPanTool = activeTool === "pan" || e.button === 1;

      if (isPanTool) {
        e.preventDefault();
        isPanningRef.current = true;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        containerRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // Anything other than blank canvas is handled by the element (SvgNode).
      const onBlank =
        e.target === containerRef.current || e.target === viewportRef.current;
      if (!onBlank) return;

      if (activeTool === "nodeEdit") {
        // Exit node edit mode, return to select
        stopEditing();
        useUIStore.getState().setTool("select");
        return;
      }

      // Select tool on blank canvas → begin a marquee (rubber-band) selection.
      if (activeTool === "select") {
        marqueeStartRef.current = mgr.screenToDoc(e.clientX, e.clientY);
        marqueeShiftRef.current = e.shiftKey;
        setMarquee({ x: marqueeStartRef.current.x, y: marqueeStartRef.current.y, width: 0, height: 0 });
        containerRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [activeTool, stopEditing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const mgr = managerRef.current;
      if (!mgr) return;

      if (isPanningRef.current) {
        const dx = e.clientX - lastPointerRef.current.x;
        const dy = e.clientY - lastPointerRef.current.y;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        mgr.applyPanDelta(dx, dy);
        return;
      }

      if (marqueeStartRef.current) {
        const start = marqueeStartRef.current;
        const cur = mgr.screenToDoc(e.clientX, e.clientY);
        setMarquee({
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y),
        });
      }
    },
    []
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!document) return;
      e.preventDefault();
      const id = nodeIdAtPoint(e.clientX, e.clientY);
      const selNow = useSelectionStore.getState().selectedIds;
      if (id && !selNow.includes(id)) select([id]);
      const hasSel = !!id || selNow.length > 0;
      useContextMenuStore.getState().openMenu(e.clientX, e.clientY, selectionContextItems(hasSel));
    },
    [document, select]
  );

  const handlePointerUp = useCallback(() => {
    if (isPanningRef.current && managerRef.current) {
      isPanningRef.current = false;
      managerRef.current.commitTransform();
      return;
    }

    if (marqueeStartRef.current) {
      const rect = marquee;
      marqueeStartRef.current = null;
      setMarquee(null);

      const doc = useDocumentStore.getState().document;
      // Tiny rect = a click, not a drag → clear selection.
      if (!rect || (rect.width < 2 / zoom && rect.height < 2 / zoom) || !doc) {
        if (!marqueeShiftRef.current) clearSelection();
        return;
      }
      // Select top-level nodes whose box intersects the marquee.
      const hits: string[] = [];
      for (const node of doc.nodes) {
        if (node.locked || !node.visible) continue;
        const b = getDocBBox(node.id);
        if (b && rectsIntersect(b, rect)) hits.push(node.id);
      }
      if (marqueeShiftRef.current) hits.forEach((id) => addToSelection(id));
      else select(hits);
    }
  }, [marquee, zoom, clearSelection, select, addToSelection]);

  // ── Cursor ──────────────────────────────────────────────────────────────────
  const cursor =
    activeTool === "pan"
      ? "grab"
      : isPanningRef.current
      ? "grabbing"
      : activeTool === "nodeEdit" || DRAW_TOOLS.has(activeTool)
      ? "crosshair"
      : "default";

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-canvas select-none"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      {/* Dot-grid background */}
      <div className="absolute inset-0 pointer-events-none canvas-grid" />

      {/*
        Viewport — CSS translate only (pan). No scale here.
        Zoom is expressed as SVG width/height so the browser re-renders
        vectors at the correct resolution (no pixelation at high zoom).
        willChange is intentionally omitted — it would rasterize the SVG
        into a GPU texture at the original size and then scale that bitmap.
      */}
      <div ref={viewportRef} className="absolute top-0 left-0">
        {document && (
          <div
            className="relative"
            style={{
              width: document.viewBox.width * zoom,
              height: document.viewBox.height * zoom,
            }}
          >
            {/* Artboard shadow (scales with the artboard) */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ boxShadow: "0 0 0 1px #333, 0 8px 48px rgba(0,0,0,0.6)" }}
            />
            {/* SVG document — zoom via width/height, not CSS scale */}
            <SvgDocument document={document} zoom={zoom} />
            {/* Selection overlay — hidden in node edit mode */}
            {activeTool !== "nodeEdit" && (
              <SelectionOverlay document={document} zoom={zoom} screenToDoc={screenToDoc} />
            )}
            {/* Path node editor overlay */}
            {activeTool === "nodeEdit" && (
              <PathEditOverlay
                document={document}
                zoom={zoom}
                screenToDoc={screenToDoc}
              />
            )}
            {/* Drawing overlay — rect / ellipse / line / pen tools */}
            {DRAW_TOOLS.has(activeTool) && (
              <DrawOverlay
                document={document}
                zoom={zoom}
                screenToDoc={screenToDoc}
              />
            )}
            {/* Ruler guides (document space) */}
            <GuidesOverlay document={document} zoom={zoom} screenToDoc={screenToDoc} />
            {/* Marquee (rubber-band) selection rectangle */}
            {marquee && activeTool === "select" && (
              <svg
                className="absolute inset-0"
                style={{ display: "block", pointerEvents: "none" }}
                viewBox={`${document.viewBox.x} ${document.viewBox.y} ${document.viewBox.width} ${document.viewBox.height}`}
                width={document.viewBox.width * zoom}
                height={document.viewBox.height * zoom}
              >
                <rect
                  x={marquee.x} y={marquee.y}
                  width={marquee.width} height={marquee.height}
                  fill="#0ea5e9" fillOpacity={0.1}
                  stroke="#0ea5e9" strokeWidth={1 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!document && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <p className="text-text-secondary text-sm">
            Type a prompt below to generate SVG
          </p>
          <p className="text-text-muted text-xs">
            or open an existing file with{" "}
            <kbd className="px-1 py-0.5 bg-surface rounded text-text-secondary">
              ⌘O
            </kbd>
          </p>
        </div>
      )}

      {/* Rulers (overlay the top/left edges; redrawn imperatively) */}
      {rulersVisible && <Rulers ref={rulersRef} screenToDoc={screenToDoc} />}

      {/* Zoom control */}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 bg-panel border border-border rounded-md shadow-lg text-text-secondary text-xs overflow-hidden">
        <button
          onClick={() => setZoom(zoom / 1.2)}
          title="Zoom out"
          className="w-6 h-6 flex items-center justify-center hover:text-text-primary hover:bg-surface transition-colors"
        >−</button>
        <button
          onClick={openZoomMenu}
          title="Zoom presets"
          className="min-w-[46px] h-6 flex items-center justify-center tabular-nums hover:text-text-primary hover:bg-surface transition-colors"
        >{Math.round(zoom * 100)}%</button>
        <button
          onClick={() => setZoom(zoom * 1.2)}
          title="Zoom in"
          className="w-6 h-6 flex items-center justify-center hover:text-text-primary hover:bg-surface transition-colors"
        >+</button>
      </div>
    </div>
  );
}
