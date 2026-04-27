import { useCallback, useEffect, useRef } from "react";
import { CanvasManager } from "./CanvasManager";
import { SvgDocument } from "./SvgDocument";
import { SelectionOverlay } from "./SelectionOverlay";
import { PathEditOverlay } from "./PathEditOverlay";
import { DrawOverlay } from "./DrawOverlay";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore } from "../../store/uiStore";
import { usePathEditStore } from "../../store/pathEditStore";
import type { VectoDocument } from "../../types/svg";

const DRAW_TOOLS = new Set(["rect", "ellipse", "line", "pen"]);

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

  // Track panning state in refs — no React state, no re-renders during drag
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const document = useDocumentStore((s) => s.document);
  const setDocument = useDocumentStore((s) => s.setDocument);
  const activeTool = useUIStore((s) => s.activeTool);
  const zoom = useUIStore((s) => s.zoom);
  const setTransform = useUIStore((s) => s.setTransform);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
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
    });
    managerRef.current = mgr;
    return () => mgr.destroy();
  }, [setTransform]);

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

      // Click on blank canvas → deselect
      if (
        e.target === containerRef.current ||
        e.target === viewportRef.current
      ) {
        if (activeTool === "nodeEdit") {
          // Exit node edit mode, return to select
          stopEditing();
          useUIStore.getState().setTool("select");
        } else {
          clearSelection();
        }
      }
    },
    [activeTool, clearSelection, stopEditing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPanningRef.current || !managerRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      // Direct DOM update — no React state
      managerRef.current.applyPanDelta(dx, dy);
    },
    []
  );

  const handlePointerUp = useCallback(() => {
    if (!isPanningRef.current || !managerRef.current) return;
    isPanningRef.current = false;
    managerRef.current.commitTransform();
  }, []);

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

      {/* Zoom indicator */}
      <div className="absolute bottom-3 right-3 text-xs text-text-secondary bg-surface px-2 py-1 rounded pointer-events-none">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}
