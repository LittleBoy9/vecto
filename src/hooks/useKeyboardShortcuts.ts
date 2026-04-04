import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUIStore } from "../store/uiStore";

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
  const deleteNodes = useDocumentStore((s) => s.deleteNodes);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

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
          break;
        case "h":
        case "H":
          setTool("pan");
          break;
        case "Delete":
        case "Backspace":
          if (selectedIds.length > 0) {
            deleteNodes(selectedIds);
            clearSelection();
          }
          break;
        case "Escape":
          clearSelection();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTool, deleteNodes, selectedIds, clearSelection]);
}
