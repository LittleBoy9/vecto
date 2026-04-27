import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUIStore } from "../store/uiStore";
import { usePathEditStore } from "../store/pathEditStore";
import { parsePath, serializePath, deleteNodesFromContours } from "../lib/pathParser";

/**
 * Global keyboard shortcut handler. Mount once in App.tsx.
 *
 * Shortcuts:
 *  V          → select tool
 *  H          → pan tool
 *  Delete / Backspace  → delete selected nodes
 *  Escape     → clear selection
 *  ⌘Z / Ctrl+Z        → undo
 *  ⌘⇧Z / Ctrl+⇧Z      → redo
 *  ⌘O / Ctrl+O        → (handled in Toolbar — no action here)
 *  ⌘S / Ctrl+S        → (handled in Toolbar — no action here)
 */
export function useKeyboardShortcuts() {
  const setTool = useUIStore((s) => s.setTool);
  const activeTool = useUIStore((s) => s.activeTool);
  const deleteNodes = useDocumentStore((s) => s.deleteNodes);
  const updateNodeAttributes = useDocumentStore((s) => s.updateNodeAttributes);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const stopEditing = usePathEditStore((s) => s.stopEditing);
  const selectedNodeIds = usePathEditStore((s) => s.selectedNodeIds);
  const editingElementId = usePathEditStore((s) => s.editingElementId);
  const clearNodeSelection = usePathEditStore((s) => s.clearNodeSelection);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip shortcuts when user is typing in a form element
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          useDocumentStore.temporal.getState().redo();
        } else {
          useDocumentStore.temporal.getState().undo();
        }
        return;
      }

      switch (e.key) {
        case "v":
        case "V":
          setTool("select");
          stopEditing();
          break;
        case "h":
        case "H":
          setTool("pan");
          stopEditing();
          break;
        case "n":
        case "N":
          setTool("nodeEdit");
          break;
        case "Delete":
        case "Backspace":
          if (activeTool === "nodeEdit" && selectedNodeIds.length > 0 && editingElementId) {
            // Delete selected anchor nodes from the path being edited
            const doc = useDocumentStore.getState().document;
            function findEl(nodes: import("../types/svg").VectoNode[]): import("../types/svg").VectoNode | null {
              for (const n of nodes) {
                if (n.id === editingElementId) return n;
                const f = findEl(n.children);
                if (f) return f;
              }
              return null;
            }
            const el = doc ? findEl(doc.nodes) : null;
            const d = el?.attributes?.d as string | undefined;
            if (d) {
              const contours = parsePath(d);
              const newContours = deleteNodesFromContours(contours, new Set(selectedNodeIds));
              updateNodeAttributes(editingElementId, { d: serializePath(newContours) });
              clearNodeSelection();
            }
          } else if (selectedIds.length > 0) {
            deleteNodes(selectedIds);
            clearSelection();
          }
          break;
        case "Escape":
          if (activeTool === "nodeEdit") {
            // Exit node edit → back to select, keep element selected
            stopEditing();
            setTool("select");
          } else {
            clearSelection();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTool, activeTool, deleteNodes, updateNodeAttributes, selectedIds, clearSelection,
      stopEditing, selectedNodeIds, editingElementId, clearNodeSelection]);
}
