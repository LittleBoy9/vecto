import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUIStore } from "../store/uiStore";
import { usePathEditStore, startNodeEditForSelectedPath } from "../store/pathEditStore";
import { parsePath, serializePath, deleteNodesFromContours } from "../lib/pathParser";
import { findNode } from "../lib/nodeUtils";
import {
  duplicateSelection, copySelection, cutSelection, pasteClipboard,
  groupSelection, ungroupSelection, reorderSelection,
} from "../lib/editActions";
import { getCanvasController } from "../lib/canvasController";

const DRAW_TOOLS = ["rect", "ellipse", "line", "pen", "text"];

/**
 * Global keyboard shortcut handler. Mount once in App.tsx.
 *
 * Tools:    V select · H pan · N node-edit · R rect · E ellipse · L line · P pen · T text
 * Edit:     ⌘D duplicate · ⌘C/⌘X/⌘V copy/cut/paste · ⌘G group · ⌘⇧G ungroup
 * Z-order:  [ / ] step back/forward · ⌘[ / ⌘] send to back / bring to front
 * Move:     arrow keys nudge (⇧ = ×10) · Delete/Backspace remove
 * History:  ⌘Z undo · ⌘⇧Z redo · Escape exit/clear
 *
 * State is read fresh via getState() inside the handler so the listener binds
 * once and never goes stale.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip shortcuts while typing in a form element
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const docStore = useDocumentStore.getState();
      const selStore = useSelectionStore.getState();
      const uiStore = useUIStore.getState();
      const pathStore = usePathEditStore.getState();
      const sel = selStore.selectedIds;
      const activeTool = uiStore.activeTool;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase(); // normalize so Shift'd combos still match

      // View shortcuts (use e.code so they're layout-independent: ⇧1 = "!" etc.)
      if (e.shiftKey && !meta) {
        if (e.code === "Digit1") { e.preventDefault(); getCanvasController()?.fitToView(); return; }
        if (e.code === "Digit2") { e.preventDefault(); getCanvasController()?.zoomToSelection(); return; }
      }

      // ── Modifier combos ─────────────────────────────────────────────────────
      if (meta) {
        switch (key) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) useDocumentStore.temporal.getState().redo();
            else useDocumentStore.temporal.getState().undo();
            return;
          case "a": {
            e.preventDefault();
            const doc = docStore.document;
            if (doc) selStore.select(doc.nodes.map((n) => n.id));
            return;
          }
          case "d": e.preventDefault(); duplicateSelection(); return;
          case "c": copySelection(); return;
          case "x": e.preventDefault(); cutSelection(); return;
          case "v": e.preventDefault(); pasteClipboard(); return;
          case "g":
            e.preventDefault();
            if (e.shiftKey) ungroupSelection(); else groupSelection();
            return;
          case "]": e.preventDefault(); reorderSelection("front"); return;
          case "[": e.preventDefault(); reorderSelection("back"); return;
        }
        // Swallow any other modifier combo so it can't fall through to tools.
        return;
      }

      // ── Plain keys ──────────────────────────────────────────────────────────
      switch (key) {
        case "v": uiStore.setTool("select"); pathStore.stopEditing(); break;
        case "h": uiStore.setTool("pan"); pathStore.stopEditing(); break;
        case "n": uiStore.setTool("nodeEdit"); startNodeEditForSelectedPath(); break;
        case "r": uiStore.setTool("rect"); pathStore.stopEditing(); break;
        case "e": uiStore.setTool("ellipse"); pathStore.stopEditing(); break;
        case "l": uiStore.setTool("line"); pathStore.stopEditing(); break;
        case "p": uiStore.setTool("pen"); pathStore.stopEditing(); break;
        case "t": uiStore.setTool("text"); pathStore.stopEditing(); break;

        case "]": reorderSelection("forward"); break;
        case "[": reorderSelection("backward"); break;

        case "arrowup":
        case "arrowdown":
        case "arrowleft":
        case "arrowright":
          if (activeTool === "select" && sel.length) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
            const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
            docStore.nudgeNodes(sel, dx, dy);
          }
          break;

        case "delete":
        case "backspace":
          if (
            activeTool === "nodeEdit" &&
            pathStore.selectedNodeIds.length > 0 &&
            pathStore.editingElementId
          ) {
            // Delete selected anchor nodes from the path being edited
            const editingId = pathStore.editingElementId;
            const el = docStore.document
              ? findNode(docStore.document.nodes, editingId)
              : null;
            const d = el?.attributes?.d;
            if (d) {
              const contours = parsePath(d);
              const next = deleteNodesFromContours(contours, new Set(pathStore.selectedNodeIds));
              docStore.updateNodeAttributes(editingId, { d: serializePath(next) });
              pathStore.clearNodeSelection();
            }
          } else if (sel.length > 0) {
            docStore.deleteNodes(sel);
            selStore.clearSelection();
          }
          break;

        case "escape":
          if (activeTool === "nodeEdit") {
            pathStore.stopEditing();
            uiStore.setTool("select");
          } else if (DRAW_TOOLS.includes(activeTool)) {
            // DrawOverlay handles cancel — just switch back to select
            uiStore.setTool("select");
          } else {
            selStore.clearSelection();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
